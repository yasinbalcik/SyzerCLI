'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const providers = require('./providers');

const FILE = path.join(config.DIR, 'stats.json');
const day = () => new Date().toISOString().slice(0, 10); // UTC günü (free limit de UTC'de sıfırlanır)

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }

// Her API çağrısı için bir kayıt. Key sayacı sağlayıcıya göre ayrılır: "nvidia#2".
function record({ model, keyIndex, tokens, provider = providers.current().id }) {
  const all = load();
  const d = (all[day()] ||= { requests: 0, tokens: 0, models: {}, keys: {}, providers: {} });
  d.requests++;
  d.tokens += tokens || 0;
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
