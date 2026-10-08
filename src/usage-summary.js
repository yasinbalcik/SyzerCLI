'use strict';

// Sağlayıcı başına özet kullanım: tüm key'lerin toplam kalan hakkı üzerinden yüzde.
// Orca gibi harici araçlar için: `syzer usage --summary --json`
const config = require('./config');
const providers = require('./providers');
const { getJson } = require('./api');
const { usable, nextUtcMidnight } = require('./keys');
const stats = require('./stats');

const pct = (used, limit) => (limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null);

async function openrouter(keys) {
  const infos = await Promise.all(keys.map(async (e) => {
    try { return (await getJson('/key', e.key)).data; } catch { return null; }
  }));
  let used = 0, limit = 0, cUsed = 0, cLimit = 0, reachable = 0;
  for (const d of infos) {
    if (!d) continue;
    reachable++;
    const f = d.free_model_daily_requests;
    if (f) { used += f.used; limit += f.limit; }
    if (d.limit != null) { cUsed += d.usage || 0; cLimit += d.limit; }
  }
  // Önce günlük free istek hakkı; yoksa kredi limiti üzerinden hesapla
  const percent = limit > 0 ? pct(used, limit) : pct(cUsed, cLimit);
  return { percent_used: percent, basis: limit > 0 ? 'free_requests' : cLimit > 0 ? 'credit' : null, used: limit > 0 ? used : cUsed, limit: limit > 0 ? limit : cLimit, reachable, resets_at: new Date(nextUtcMidnight()).toISOString() };
}

async function summary(only) {
  const out = [];
  for (const p of providers.list()) {
    if (only && p.id !== only) continue;
    const keys = config.loadKeys(p.id).keys;
    if (!keys.length) continue;
    providers.setCurrent(p.id);
    const ready = keys.filter(usable).length;
    let info = { percent_used: null, basis: null, used: null, limit: null, resets_at: null };
    if (p.hasUsageApi) info = { ...info, ...(await openrouter(keys)) };
    else {
      const counts = stats.todayKeyCounts(p.id);
      info.used = Object.values(counts).reduce((a, b) => a + b, 0); // yerel istek sayısı (kota bilinmiyor)
      info.basis = 'local_requests';
    }
    // Kota bilinmiyorsa (NVIDIA) yüzde, hazır olmayan key oranından türetilir
    const percentUsed = info.percent_used != null ? info.percent_used : pct(keys.length - ready, keys.length);
    out.push({ provider: p.id, name: p.name, percent_used: percentUsed, percent_remaining: percentUsed == null ? null : 100 - percentUsed, basis: info.basis || 'keys_ready', used: info.used, limit: info.limit, keys_ready: ready, keys_total: keys.length, resets_at: info.resets_at });
  }
  const tot = out.reduce((a, r) => ({ ready: a.ready + r.keys_ready, total: a.total + r.keys_total }), { ready: 0, total: 0 });
  const withPct = out.filter((r) => r.percent_used != null);
  const overall = withPct.length ? Math.round(withPct.reduce((a, r) => a + r.percent_used, 0) / withPct.length) : null;
  return { providers: out, percent_used: overall, keys_ready: tot.ready, keys_total: tot.total, updated_at: new Date().toISOString() };
}

module.exports = { summary };
