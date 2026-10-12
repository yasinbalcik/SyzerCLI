'use strict';

// Makine okunur key yönetimi (Orca ayarlar sayfası ve diğer araçlar için): `syzer key <list|add|remove|use> --json`
const config = require('./config');
const providers = require('./providers');
const { mask, usable, addKeys } = require('./keys');
const { validateKey } = require('./api');
const { mapLimit, retry429, DEFAULT_CONCURRENCY } = require('./pool');

const stateOf = (e) => (e.disabled ? 'off' : e.blockedUntil > Date.now() ? 'wait' : 'ready');

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// Ağ yok: kota verisi usage-key-cache.json'dan (24 saatten eski kayıt yok sayılır). opts.readCache / opts.now test için enjekte edilebilir.
function listAll(opts = {}) {
  const us = require('./usage-summary');
  const now = opts.now || Date.now();
  const cache = (opts.readCache || us.readKeyCache)() || {};
  return {
    providers: providers.list().filter((p) => !opts.provider || p.id === opts.provider).map((p) => {
      const st = config.loadKeys(p.id);
      const tot = { keys_total: st.keys.length, ready: 0, keys_with_data: 0, free_remaining: 0, free_limit: 0, oldest_check_at: null, newest_check_at: null };
      const keys = st.keys.map((e, i) => {
        const ready = usable(e);
        if (ready) tot.ready++;
        let free = null, credit = null, checked = null;
        const c = p.hasUsageApi ? cache[us.fingerprint(e.key)] : null;
        if (c && c.data && typeof c.at === 'number' && now - c.at < us.MAX_AGE_MS) {
          const d = c.data, f = d.free_model_daily_requests;
          checked = c.at;
          if (f && typeof f === 'object') free = { remaining: num(f.remaining), limit: num(f.limit), used: num(f.used) };
          if (d.limit != null || d.limit_remaining != null) credit = { remaining: num(d.limit_remaining), limit: num(d.limit), usage: num(d.usage) };
          tot.keys_with_data++;
          if (free) { tot.free_remaining += free.remaining || 0; tot.free_limit += free.limit || 0; }
          if (tot.oldest_check_at === null || checked < tot.oldest_check_at) tot.oldest_check_at = checked;
          if (tot.newest_check_at === null || checked > tot.newest_check_at) tot.newest_check_at = checked;
        }
        return { index: i + 1, key: mask(e.key), state: stateOf(e), ready, reason: e.reason || null, until: e.blockedUntil > now ? e.blockedUntil : null, active: i === (st.active | 0), free, credit, checked_at: checked };
      });
      return { id: p.id, name: p.name, hint: p.keyHint, keys, totals: tot };
    }),
  };
}

// Önbelleği yeniler (usage API'si olan sağlayıcılar; varsayılan bütçe 25 sn, all = tam tarama), sonra listAll ile aynı şekli döndürür.
async function usage(provider, opts = {}) {
  const us = require('./usage-summary');
  const budgetMs = opts.all ? Infinity : (opts.budgetMs > 0 ? opts.budgetMs : 25000);
  let refreshed = 0, total = 0;
  for (const id of ids(provider)) {
    const p = providers.PROVIDERS[id];
    if (!p.hasUsageApi) continue;
    const keys = config.loadKeys(id).keys;
    if (!keys.length) continue;
    providers.setCurrent(id);
    const r = await us.refreshKeyUsage(keys, { budgetMs, now: opts.now, fetchKey: opts.fetchKey });
    refreshed += r.refreshed; total += r.total;
  }
  return { ...listAll({ provider, readCache: opts.readCache, now: opts.now }), refreshed, total };
}

async function add(text) {
  const cfg = config.load();
  const r = await addKeys(cfg, String(text || ''), { check: true });
  config.save(cfg);
  return { added: r.added.length, exists: r.exists.length, invalid: r.invalid.length + r.badFormat.length, found: r.found, errors: [...r.invalid.map((x) => `${x.provider}: ${x.why}`), ...r.badFormat.map(() => 'bad format')].slice(0, 5) };
}

function remove(provider, n) {
  const st = config.loadKeys(provider);
  const i = parseInt(n, 10);
  if (!providers.PROVIDERS[provider] || !i || i < 1 || i > st.keys.length) return { ok: false, error: 'bad provider or index' };
  st.keys.splice(i - 1, 1);
  if (st.active > i - 1) st.active--;
  st.active = Math.max(0, Math.min(st.active | 0, st.keys.length - 1));
  config.saveKeys(provider, st);
  return { ok: true };
}

function use(provider, n) {
  const st = config.loadKeys(provider);
  const i = parseInt(n, 10);
  if (!providers.PROVIDERS[provider] || !i || i < 1 || i > st.keys.length) return { ok: false, error: 'bad provider or index' };
  st.active = i - 1;
  config.saveKeys(provider, st);
  return { ok: true };
}

const ids = (provider) => (provider ? [provider] : providers.list().map((p) => p.id)).filter((id) => providers.PROVIDERS[id]);

// Canlı doğrulama: 401/403 => key kapatılır (disabled + reason); başarılıysa daha önce 401/403 ile kapatılmış key tekrar açılır.
// Geçici hatalar (429/5xx/ağ) key'i değiştirmez. Çıktı: { providers: [{ id, keys: [{ index, state, reason }] }] }
async function test(provider, validate = validateKey, opts = {}) {
  const out = [];
  for (const id of ids(provider)) {
    const st = config.loadKeys(id);
    const p = providers.PROVIDERS[id];
    // Sınırlı eşzamanlılık + 429'da geri çekilme: 679 key'i aynı anda göndermek sağlayıcıyı 429'a düşürüp testi anlamsız kılıyordu.
    const unverified = new Set();
    const check = async (e) => {
      try {
        await retry429(() => validate(p, e.key), opts.retry);
        unverified.delete(e);
        if (e.disabled && /^(401|403)/.test(String(e.reason || ''))) { delete e.disabled; delete e.reason; }
      } catch (err) {
        const why = `${err.status || ''} ${err.message}`.trim();
        if (/^(401|403)/.test(why)) { unverified.delete(e); e.disabled = true; e.reason = why.slice(0, 3); } else unverified.add(e); // 429 (geri çekilmeye rağmen)/5xx/ağ: doğrulanamadı
      }
    };
    await mapLimit(st.keys, opts.concurrency || DEFAULT_CONCURRENCY, check);
    // doğrulanamayanlar için ikinci tur: kısa bekleme + düşük eşzamanlılık (sağlayıcının sınır penceresi açılmış olur)
    if (unverified.size) {
      await (opts.pause || ((ms) => new Promise((r) => setTimeout(r, ms))))(3000);
      await mapLimit([...unverified], 2, check);
    }
    if (st.keys.length) config.saveKeys(id, st);
    out.push({ id, unverified: unverified.size, keys: st.keys.map((e, i) => ({ index: i + 1, state: stateOf(e), reason: e.reason || null, verified: !unverified.has(e) })) });
  }
  return { providers: out };
}

// state != ready olan key'leri siler (tek yazımda; aktif işaretçi doğru key'i izler).
function prune(provider) {
  const out = []; let removed = 0;
  for (const id of ids(provider)) {
    const st = config.loadKeys(id);
    const act = Math.min(st.active | 0, Math.max(0, st.keys.length - 1));
    const keep = st.keys.filter((e) => stateOf(e) === 'ready');
    const n = st.keys.length - keep.length;
    if (n) {
      const ak = st.keys[act];
      let na = keep.indexOf(ak);
      if (na < 0) na = Math.max(0, Math.min(st.keys.slice(0, act).filter((e) => stateOf(e) === 'ready').length, keep.length - 1));
      st.keys = keep; st.active = na;
      config.saveKeys(id, st);
      removed += n;
    }
    out.push({ id, removed: n, left: st.keys.length });
  }
  return { ok: true, removed, providers: out };
}

// Key sağlık istatistikleri (key-health.json): son 20 sonuç, hata oranı, soğuma süresi. health: test için enjekte edilebilir.
function stats(provider, health = require('./key-health')) {
  return {
    providers: ids(provider).map((id) => ({
      id,
      keys: config.loadKeys(id).keys.map((e, i) => {
        const fp = mask(e.key), s = health.stats(id, fp);
        return { index: i + 1, key: fp, state: stateOf(e), samples: s.samples, counts: s.counts, failRate: Math.round(s.rate * 100) / 100,
          cooldownSec: Math.ceil(s.coolLeft / 1000), streak: s.streak, last: s.last };
      }),
    })),
  };
}

function statsText(r) {
  const lines = [];
  for (const p of r.providers) {
    lines.push(`${p.id}`);
    if (!p.keys.length) lines.push('  (no keys)');
    for (const k of p.keys) {
      const c = Object.entries(k.counts).map(([o, n]) => `${o}:${n}`).join(' ') || '-';
      lines.push(`  #${k.index} ${k.key}  ${k.state}  n=${k.samples}  fail=${Math.round(k.failRate * 100)}%  cooldown=${k.cooldownSec ? `${k.cooldownSec}s` : '-'}  [${c}]`);
    }
  }
  return lines.join('\n');
}

module.exports = { listAll, usage, add, remove, use, test, prune, stats, statsText, stateOf };
