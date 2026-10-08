'use strict';

const config = require('./config');
const { KeyError, validateKey } = require('./api');
const providers = require('./providers');
const { t } = require('./i18n');

const mask = (k) => (k.length > 14 ? `${k.slice(0, 10)}…${k.slice(-4)}` : '***');

function nextUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

const usable = (e) => !e.disabled && (!e.blockedUntil || e.blockedUntil <= Date.now());

// Metinden (satır, boşluk, virgül, tırnak… fark etmez) tüm sağlayıcıların geçerli key'lerini
// ve biçimi bozuk key adaylarını ayırır. Sağlayıcı key'in biçiminden otomatik tanınır.
function parseKeys(text) {
  text = String(text);
  const valid = []; // { provider, key }
  let rest = text;
  for (const p of providers.list()) {
    for (const k of new Set(text.match(providers.keyRegex(p)) || [])) valid.push({ provider: p.id, key: k });
    rest = rest.replace(providers.keyRegex(p), ' ');
  }
  const invalid = [...new Set(rest.split(/[\s,;"'`]+/).filter((tok) =>
    /^sk-/i.test(tok) || providers.list().some((p) => p.keyPrefix.test(tok)) || (tok.length >= 24 && /^[A-Za-z0-9_-]+$/.test(tok))))];
  return { valid, invalid };
}

const isValidFormat = (k) => providers.list().some((p) => p.keyExact.test(k));

// Toplu ekleme. Biçim + tekrar kontrolü + (check=true ise) canlı doğrulama.
// Her key kendi sağlayıcısının dosyasına yazılır (keys.<sağlayıcı>.json).
async function addKeys(cfg, text, { check = true } = {}) {
  const { valid, invalid: badFormat } = parseKeys(text);
  const report = { added: [], exists: [], badFormat, invalid: [], notes: [], found: valid.length + badFormat.length };

  // Sağlayıcı başına key deposu: mevcut sağlayıcı cfg üzerinde, diğerleri dosyadan
  const stores = {};
  const storeOf = (id) => {
    if (id === cfg.provider) return cfg;
    return (stores[id] ||= config.loadKeys(id));
  };

  const fresh = [];
  for (const { provider, key } of valid) {
    const store = storeOf(provider);
    const idx = store.keys.findIndex((e) => e.key === key);
    if (idx >= 0) report.exists.push({ provider, key, index: idx + 1 });
    else fresh.push({ provider, key });
  }

  const results = await Promise.all(fresh.map(async ({ provider, key }) => {
    if (!check) return { provider, key, ok: true };
    try {
      const r = await validateKey(providers.PROVIDERS[provider], key);
      return { provider, key, ok: true, note: r.note };
    } catch (e) { return { provider, key, ok: false, why: `${e.status || ''} ${e.message}`.trim() }; }
  }));

  for (const r of results) {
    if (!r.ok) { report.invalid.push({ provider: r.provider, key: r.key, why: r.why }); continue; }
    storeOf(r.provider).keys.push({ key: r.key });
    report.added.push({ provider: r.provider, key: r.key });
    if (r.note) report.notes.push({ provider: r.provider, key: r.key, note: r.note });
  }

  if (report.added.length) {
    config.save(cfg); // mevcut sağlayıcının key dosyası
    for (const [id, store] of Object.entries(stores)) config.saveKeys(id, store);
  }
  return report;
}

// Aktif key'ten başlayarak sırayla dener. Başka key'e yalnızca mevcut key'in limiti dolunca
// (402/403/429) veya key geçersizse geçilir. 5xx (sunucu yoğun) durumunda aynı key bekleyip tekrar denenir.
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(id); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

function ordered(cfg, spread) {
  const n = cfg.keys.length;
  const a = Math.min(Math.max(cfg.active | 0, 0), n - 1);
  const list = Array.from({ length: n }, (_, i) => cfg.keys[(a + i) % n]);
  // Paralel alt ajanlar: işleri kullanılabilir key'lere dağıt (dakika limitine takılmamak için)
  if (spread != null) {
    const ok = list.filter(usable);
    if (ok.length > 1) { const first = ok[spread % ok.length]; return [first, ...list.filter((e) => e !== first)]; }
  }
  return list;
}

async function withRotation(cfg, fn, { onSwitch, onRetry, signal, spread = null } = {}) {
  if (!cfg.keys.length) throw new Error(t('no_keys'));
  const tried = new Set();
  while (true) {
    const entry = ordered(cfg, spread).find((e) => usable(e) && !tried.has(e.key));
    if (!entry) {
      const waits = cfg.keys.filter((e) => !e.disabled && e.blockedUntil > Date.now()).map((e) => e.blockedUntil);
      const hint = waits.length ? t('earliest', new Date(Math.min(...waits)).toLocaleTimeString()) : '';
      throw new Error(t('no_usable', hint));
    }
    tried.add(entry.key);
    try {
      let result;
      for (let attempt = 0; ; attempt++) {
        try { result = await fn(entry); break; }
        catch (err) {
          if (err instanceof KeyError && err.status >= 500 && attempt < 2) {
            const delay = 2 * (attempt + 1);
            onRetry && onRetry(err.status, delay);
            await sleep(delay * 1000, signal);
            continue;
          }
          throw err;
        }
      }
      const index = cfg.keys.indexOf(entry);
      if (spread == null && cfg.active !== index) { cfg.active = index; config.save(cfg); }
      return { result, index };
    } catch (err) {
      if (!(err instanceof KeyError)) throw err;
      const s = err.status;
      const msg = err.message || '';
      if (s === 401) { entry.disabled = true; entry.reason = '401'; }
      else if (s === 402 || s === 403) { entry.blockedUntil = nextUtcMidnight(); entry.reason = String(s); }
      else if (s === 429) {
        const daily = /per[- ]day|daily|free-models/i.test(msg);
        entry.blockedUntil = daily ? nextUtcMidnight() : Date.now() + 60_000;
        entry.reason = daily ? '429 daily' : '429';
      } else throw err; // 5xx (denemeler bitti), 400, 404 ...: key değiştirmek çözmez
      config.save(cfg);
      onSwitch && onSwitch(mask(entry.key), s, msg);
    }
  }
}

module.exports = { mask, usable, nextUtcMidnight, parseKeys, isValidFormat, addKeys, withRotation };
