'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const providers = require('./providers');

const FILE = path.join(config.DIR, 'stats.json');
const day = () => new Date().toISOString().slice(0, 10); // UTC günü (free limit de UTC'de sıfırlanır)

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }

// Her API çağrısı için bir kayıt. Key sayacı sağlayıcıya göre ayrılır: "nvidia#2".
function record({ model, keyIndex, tokens, usage, cwd, provider = providers.current().id }) {
  const all = load();
  const d = (all[day()] ||= { requests: 0, tokens: 0, models: {}, keys: {}, providers: {} });
  d.requests++;
  d.tokens += tokens || 0;
  // ayrıntı: model başına ve gün başına girdi/çıktı/önbellek/akıl yürütme token'ları
  const u = usage || {};
  const inT = u.prompt_tokens || 0;
  const outT = u.completion_tokens || 0;
  const cache = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  const reason = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
  d.in = (d.in || 0) + inT; d.out = (d.out || 0) + outT; d.cache = (d.cache || 0) + cache; d.reasoning = (d.reasoning || 0) + reason;
  d.modelStats = d.modelStats || {};
  const ms = (d.modelStats[model] ||= { requests: 0, tokens: 0, in: 0, out: 0, cache: 0, reasoning: 0, provider });
  ms.requests++; ms.tokens += tokens || 0; ms.in += inT; ms.out += outT; ms.cache += cache; ms.reasoning += reason;
  if (cwd) { // (model × proje) kırılımı: Orca analitiği için
    d.mp = d.mp || {};
    const mk = `${model}${String.fromCharCode(1)}${cwd}`;
    const e = (d.mp[mk] ||= { requests: 0, tokens: 0, in: 0, out: 0, cache: 0, reasoning: 0 });
    e.requests++; e.tokens += tokens || 0; e.in += inT; e.out += outT; e.cache += cache; e.reasoning += reason;
  }
  if (cwd) { d.projects = d.projects || {}; const pj = (d.projects[cwd] ||= { requests: 0, tokens: 0 }); pj.requests++; pj.tokens += tokens || 0; }
  d.models[model] = (d.models[model] || 0) + 1;
  const k = `${provider}#${keyIndex + 1}`;
  d.keys[k] = (d.keys[k] || 0) + 1;
  d.providers = d.providers || {};
  d.providers[provider] = (d.providers[provider] || 0) + 1;
  // yalnızca son 30 gün
  for (const old of Object.keys(all).sort().slice(0, -30)) delete all[old];
  try { fs.mkdirSync(config.DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(all)); } catch { /* önemsiz */ }
}

function recent(n = 7) {
  const all = load();
  return Object.keys(all).sort().slice(-n).reverse().map((date) => ({ date, ...all[date] }));
}

// Bugün bu sağlayıcıda key başına yapılan istek sayısı: { 1: 12, 2: 3 }
function todayKeyCounts(provider) {
  const d = load()[day()];
  const out = {};
  if (!d) return out;
  for (const [k, n] of Object.entries(d.keys || {})) {
    const m = k.match(/^(.+)#(\d+)$/);
    if (m && m[1] === provider) out[Number(m[2])] = n;
    else if (!m && provider === 'openrouter') out[Number(k.replace('#', ''))] = n; // eski biçim
  }
  return out;
}

module.exports = { record, recent, todayKeyCounts };
