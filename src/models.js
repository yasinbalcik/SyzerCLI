'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const providers = require('./providers');
const { getJson, errorFrom } = require('./api');

const TTL = 60 * 60 * 1000;
const CHECK_TTL = 24 * 60 * 60 * 1000;

const cacheFile = (p) => path.join(config.DIR, `models-cache.${p.id}.json`);
const checkFile = (p) => path.join(config.DIR, `models-check.${p.id}.json`);

// NVIDIA /models listesinde sohbet dışı modeller de var (embedding, güvenlik, görü…)
const NOT_CHAT = /embed|rerank|safety|guard|content-safety|topic-control|parse|clip|vlm|vision|vila|neva|paligemma|fuyu|kosmos|riva|cosmos|audio|speech|retriev|bge|gliner|shield|reward|deplot|diffusion|detector|calibration/i;

async function allModels({ refresh = false, cacheOnly = false } = {}) {
  const p = providers.current();
  if (!refresh) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile(p), 'utf8'));
      if (cacheOnly || Date.now() - c.ts < TTL) return c.data; // cacheOnly: bayat olsa da ağa çıkma
    } catch { /* önbellek yok */ }
  }
  if (cacheOnly) throw new Error('no cache');
  const data = (await getJson('/models', null, 20000, p)).data;
  try {
    fs.mkdirSync(config.DIR, { recursive: true });
    fs.writeFileSync(cacheFile(p), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* önbellek yazılamadı: sorun değil */ }
  return data;
}

const isFree = (m) => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;

// ---------- NVIDIA: modelin bu hesapta gerçekten çalışıp çalışmadığı ----------

function readChecks(p) {
  try { const c = JSON.parse(fs.readFileSync(checkFile(p), 'utf8')); return c; } catch { return null; }
}

// Aday sohbet modellerini 1 token'lık istekle dener. Sonuç: ok | gone (404/410) | overloaded (5xx) | slow (zaman aşımı)
async function checkModels(key, { onProgress, force = false, concurrency = 3 } = {}) {
  const p = providers.current();
  const prev = readChecks(p);
  if (!force && prev && Date.now() - prev.ts < CHECK_TTL) return prev.results;

  const ids = (await allModels()).map((m) => m.id).filter((id) => !NOT_CHAT.test(id));
  const results = {};
  let done = 0;
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const res = await fetch(`${p.base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) results[id] = 'ok';
        else if (res.status === 404 || res.status === 410) results[id] = 'gone';
        else if (res.status === 429) results[id] = 'ok'; // var ama hız sınırına takıldı
        else if (res.status >= 500) results[id] = 'overloaded';
        else { const e = await errorFrom(res); results[id] = res.status === 401 || res.status === 403 ? 'auth' : `err:${e.status}`; }
      } catch (e) { results[id] = e.name === 'TimeoutError' ? 'slow' : 'overloaded'; }
      done++;
      onProgress && onProgress(done, ids.length, id, results[id]);
      await new Promise((r) => setTimeout(r, 1500 / concurrency)); // ~40 istek/dk sınırının altında kal
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  try { fs.writeFileSync(checkFile(p), JSON.stringify({ ts: Date.now(), results })); } catch { /* önemsiz */ }
  return results;
}

// ---------- ortak arayüz ----------

// OpenRouter: ücretsiz modeller. NVIDIA: sohbet modelleri (doğrulama varsa yalnızca çalışanlar; all=true hepsi).
async function freeModels(query = '', opts = {}) {
  const p = providers.current();
  const q = query.toLowerCase();
  const raw = await allModels(opts);
  let list;
  if (p.id === 'nvidia') {
    const checks = (readChecks(p) || {}).results || {};
    list = raw
      .filter((m) => !NOT_CHAT.test(m.id))
      .map((m) => ({
        id: m.id,
        name: m.id,
        ctx: m.context_length || 0,
        tools: null, // NVIDIA bu bilgiyi listede vermiyor
        reasoning: /nemotron-3|reason|think|gpt-oss|r1/i.test(m.id) ? true : null,
        status: checks[m.id] || 'unknown',
      }))
      .filter((m) => opts.all || m.status !== 'gone');
  } else {
    list = raw.filter(isFree).map((m) => ({
      id: m.id,
      name: m.name,
      ctx: m.context_length,
      tools: (m.supported_parameters || []).includes('tools'),
      reasoning: (m.supported_parameters || []).includes('reasoning'),
      status: 'ok',
    }));
  }
  return list
    .filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// true/false; model listede yoksa ya da sağlayıcı bilgi vermiyorsa null
async function supportsImages(id) {
  if (providers.current().id !== 'openrouter') return null;
  try {
    const m = (await allModels()).find((x) => x.id === id);
    if (!m) return null;
    return (m.architecture?.input_modalities || []).includes('image');
  } catch { return null; }
}

async function supportsReasoning(id, { cacheOnly = false } = {}) {
  if (providers.current().id !== 'openrouter') return /nemotron-3|reason|think|gpt-oss|r1/i.test(id) ? true : null;
  try {
    const m = (await allModels({ cacheOnly })).find((x) => x.id === id);
    if (!m) return null;
    const sp = m.supported_parameters || [];
    return sp.includes('reasoning') || sp.includes('reasoning_effort');
  } catch { return null; }
}

// Yedek zinciri: 'off' | 'auto' | [id...]
async function fallbackChain(cfg, current) {
  if (cfg.fallback === 'off') return [];
  if (Array.isArray(cfg.fallback)) return cfg.fallback.filter((id) => id !== current);
  try {
    if (providers.current().id === 'nvidia') {
      const checks = (readChecks(providers.current()) || {}).results || {};
      return Object.keys(checks).filter((id) => checks[id] === 'ok' && id !== current).slice(0, 2);
    }
    const vendor = current.split('/')[0];
    return (await freeModels(''))
      .filter((m) => m.tools && m.id !== current && !/safety|guard/i.test(m.id))
      .sort((a, b) => (b.id.startsWith(vendor) - a.id.startsWith(vendor)) || (b.ctx - a.ctx))
      .slice(0, 2).map((m) => m.id);
  } catch { return []; }
}

module.exports = { allModels, freeModels, isFree, supportsImages, supportsReasoning, fallbackChain, checkModels, readChecks };
