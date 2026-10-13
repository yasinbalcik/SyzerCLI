'use strict';

// Sağlayıcı tanımları. Hepsi OpenAI uyumlu /chat/completions konuşur; farklar burada toplanır.
const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keySource: '(?<![A-Za-z0-9_-])sk-or-v1-[a-f0-9]{64}(?![A-Za-z0-9_-])',
    keyExact: /^sk-or-v1-[a-f0-9]{64}$/,
    keyPrefix: /^sk-/i,
    keyHint: 'sk-or-v1- + 64 hex',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    defaultFallback: 'auto',
    hasUsageApi: true, // GET /key günlük free istek ve kredi bilgisini verir
    headers: () => ({ 'X-Title': 'SyzerCLI' }),
    // effort → istek gövdesine eklenecek alanlar
    reasoning: (effort) => (effort === 'off' ? { reasoning: { effort: 'none' } } : { reasoning: { effort } }),
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    base: 'https://integrate.api.nvidia.com/v1',
    keySource: '(?<![A-Za-z0-9_-])nvapi-[A-Za-z0-9_-]{64}(?![A-Za-z0-9_-])',
    keyExact: /^nvapi-[A-Za-z0-9_-]{64}$/,
    keyPrefix: /^nvapi-/i,
    keyHint: 'nvapi- + 64 karakter',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    defaultFallback: ['nvidia/nemotron-3-super-120b-a12b'],
    hasUsageApi: false, // kalan kota sorgulanamaz; yaklaşık 40 istek/dk sınırı vardır
    rpm: 40,
    validateModel: 'nvidia/nemotron-3-super-120b-a12b',
    headers: () => ({}),
    reasoning: (effort) => (effort === 'off' ? { chat_template_kwargs: { enable_thinking: false } } : { reasoning_effort: effort }),
  },
};

const BUILTIN = new Set(Object.keys(PROVIDERS));

// ---------- kullanıcının eklediği sağlayıcılar (~/.syzercli/providers.json) ----------
// Her biri OpenAI uyumlu bir uç nokta: Ollama, vLLM, LM Studio, kendi sunucun, başka bir API…
const fs = require('fs');
const path = require('path');
const os = require('os');
const customFile = () => path.join(process.env.SYZER_HOME || path.join(os.homedir(), '.syzercli'), 'providers.json');
const NEVER = /(?!)/; // key biçimi bilinmez: yapıştırılan metinden otomatik tanınmaz
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,30}$/;

function makeCustom(d) {
  return {
    id: d.id,
    name: d.name || d.id,
    base: String(d.base).replace(/\/+$/, ''),
    custom: true,
    keySource: '(?!)',
    keyExact: NEVER,
    keyPrefix: NEVER,
    keyHint: d.keyless ? 'key gerekmez' : 'API key',
    keyless: !!d.keyless,
    simple: !!d.simple, // sade mod: kısa istem + temel araçlar
    defaultModel: d.model || '',
    defaultFallback: 'off',
    hasUsageApi: false,
    rpm: d.rpm || null,
    headers: () => ({ ...(d.headers || {}) }),
    reasoning: (effort) => (d.reasoning === false || effort === 'off' ? {} : { reasoning_effort: effort }),
    def: d,
  };
}

function readCustom() {
  try { const j = JSON.parse(fs.readFileSync(customFile(), 'utf8')); return Array.isArray(j.providers) ? j.providers : []; } catch { return []; }
}

function writeCustom(list) {
  fs.mkdirSync(path.dirname(customFile()), { recursive: true });
  require('./atomic-json').writeJsonAtomic(customFile(), { providers: list }, { space: 2, mode: 0o600 });
}

function loadCustom() {
  for (const id of Object.keys(PROVIDERS)) if (!BUILTIN.has(id)) delete PROVIDERS[id];
  for (const d of readCustom()) if (d && ID_RE.test(d.id) && !BUILTIN.has(d.id) && d.base) PROVIDERS[d.id] = makeCustom(d);
}

// Doğrular, kaydeder ve kayıt nesnesini döner. Hata durumunda Error fırlatır.
function addCustom(d) {
  const id = String(d.id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error('bad id');
  if (BUILTIN.has(id)) throw new Error('builtin');
  let url;
  try { url = new URL(String(d.base || '').trim()); } catch { throw new Error('bad url'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('bad url');
  const rec = { id, name: String(d.name || id).trim() || id, base: url.href.replace(/\/+$/, ''), model: String(d.model || '').trim(), keyless: !!d.keyless };
  if (d.reasoning === false) rec.reasoning = false;
  if (d.simple) rec.simple = true;
  const list = readCustom().filter((x) => x.id !== id);
  list.push(rec);
  writeCustom(list);
  loadCustom();
  return rec;
}

function removeCustom(id) {
  if (BUILTIN.has(id)) throw new Error('builtin');
  const list = readCustom();
  if (!list.some((x) => x.id === id)) return false;
  writeCustom(list.filter((x) => x.id !== id));
  loadCustom();
  return true;
}

loadCustom();

let currentId = 'openrouter';

const current = () => PROVIDERS[currentId];
const setCurrent = (id) => { if (PROVIDERS[id]) currentId = id; };
const list = () => Object.values(PROVIDERS);

// Bir token hangi sağlayıcıya ait? (null = hiçbiri)
function detect(token) {
  return list().find((p) => p.keyExact.test(token) || p.keyPrefix.test(token)) || null;
}

const keyRegex = (p) => new RegExp(p.keySource, 'g');

// Kayıtlı özel sağlayıcının sade modunu açar/kapatır
function setSimple(id, on) {
  const d = readCustom().find((x) => x.id === id);
  if (!d) throw new Error('not custom');
  return addCustom({ ...d, simple: !!on });
}

module.exports = { setSimple, PROVIDERS, BUILTIN, current, setCurrent, list, detect, keyRegex, addCustom, removeCustom, loadCustom, readCustom, customFile };
