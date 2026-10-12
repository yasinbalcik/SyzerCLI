'use strict';

// Sağlayıcı başına özet kullanım: tüm key'lerin toplam kalan hakkı üzerinden yüzde.
// Orca gibi harici araçlar için: `syzer usage --summary --json`
const config = require('./config');
const providers = require('./providers');
const { getJson } = require('./api');
const { mapLimit, retry429, DEFAULT_CONCURRENCY } = require('./pool');
const { usable, nextUtcMidnight } = require('./keys');
const stats = require('./stats');

const pct = (used, limit) => (limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null);

// Orca durum çubuğu bu çıktıyı sık sık ister; çok key'li havuzda her çağrıda hepsini sorgulamamak için kısa süreli önbellek.
// OpenRouter /key uç noktası ~4-5 istek/sn'de sınırlanır: 679 key'lik havuzu tam taramak ~2.5 dk sürer. Bu yüzden anahtar başına
// önbellek tutulur; her çağrı en eski kayıtları zaman bütçesi dahilinde yeniler, geri kalanı önbellekten okur (yüzde oranı
// bir alt kümeden de doğru çıkar). Böylece durum çubuğu hızlı kalır, havuz birkaç çağrıda tamamen taranmış olur.
const FRESH_MS = 120000;       // bu süreden yeni kayıt yeniden sorgulanmaz
const MAX_AGE_MS = 24 * 3600e3; // bundan eski kayıt kullanılmaz
const fp = (key) => require('crypto').createHash('sha1').update(String(key)).digest('hex').slice(0, 12);
const cachePath = () => require('path').join(config.DIR, 'usage-key-cache.json');
function readCache() {
  try { const c = JSON.parse(require('fs').readFileSync(cachePath(), 'utf8')); return c && c.keys && typeof c.keys === 'object' ? c.keys : {}; } catch { return {}; }
}
function writeCache(map) {
  try { require('fs').writeFileSync(cachePath(), JSON.stringify({ keys: map })); } catch { /* önemsiz */ }
}

// budgetMs: yeni sorgulara ayrılan süre (aşılınca kalan key'ler önbellekten okunur). Tam tarama için Infinity.
const defaultFetchKey = (k) => retry429(() => getJson('/key', k));

// Önbelleği zaman bütçesi dahilinde yeniler (en eski önce). Bellekteki cache nesnesini günceller; yazmaz.
async function refreshInto(cache, keys, { budgetMs, now, fetchKey }) {
  const deadline = now + budgetMs;
  let refreshed = 0;
  const todo = keys
    .map((e) => ({ e, id: fp(e.key), at: (cache[fp(e.key)] || {}).at || 0 }))
    .filter((x) => now - x.at >= FRESH_MS)
    .sort((a, b) => a.at - b.at); // hiç sorgulanmamış / en eski önce
  await mapLimit(todo, DEFAULT_CONCURRENCY, async (x) => {
    if (Date.now() > deadline) return;
    try { cache[x.id] = { at: Date.now(), data: (await fetchKey(x.e.key)).data }; refreshed++; } catch { /* eski kayıt korunur */ }
  });
  return refreshed;
}

// Harici kullanım (Orca `key usage`): önbelleği yeniler ve yazar; budgetMs Infinity = tam tarama. Diğer sağlayıcıların kayıtlarına dokunmaz.
async function refreshKeyUsage(keys, { budgetMs = 10000, now = Date.now(), fetchKey = defaultFetchKey } = {}) {
  const cache = readCache();
  const refreshed = await refreshInto(cache, keys, { budgetMs, now, fetchKey });
  if (refreshed) writeCache(cache);
  return { refreshed, total: keys.length };
}

async function openrouter(keys, { budgetMs = 10000, now = Date.now(), fetchKey = defaultFetchKey } = {}) {
  const cache = readCache();
  const live = new Set(Object.keys(cache));
  await refreshInto(cache, keys, { budgetMs, now, fetchKey });
  const ids = new Set(keys.map((e) => fp(e.key)));
  for (const id of live) if (!ids.has(id)) delete cache[id]; // silinmiş key'leri temizle
  writeCache(cache);
  const infos = keys.map((e) => { const c = cache[fp(e.key)]; return c && Date.now() - c.at < MAX_AGE_MS ? c.data : null; });
  return summarize(infos);
}

function summarize(infos) {
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
    const store = config.loadKeys(p.id);
    const keys = store.keys;
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
    out.push({ provider: p.id, name: p.name, percent_used: percentUsed, percent_remaining: percentUsed == null ? null : 100 - percentUsed, basis: info.basis || 'keys_ready', used: info.used, limit: info.limit, keys_ready: ready, keys_total: keys.length, active_key: Math.min(store.active | 0, keys.length - 1) + 1, resets_at: info.resets_at });
  }
  const tot = out.reduce((a, r) => ({ ready: a.ready + r.keys_ready, total: a.total + r.keys_total }), { ready: 0, total: 0 });
  const withPct = out.filter((r) => r.percent_used != null);
  const overall = withPct.length ? Math.round(withPct.reduce((a, r) => a + r.percent_used, 0) / withPct.length) : null;
  return { providers: out, percent_used: overall, keys_ready: tot.ready, keys_total: tot.total, updated_at: new Date().toISOString() };
}

module.exports = { summary, fingerprint: fp, readKeyCache: readCache, refreshKeyUsage, MAX_AGE_MS };
