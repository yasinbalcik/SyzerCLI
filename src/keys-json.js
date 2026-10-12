'use strict';

// Makine okunur key yönetimi (Orca ayarlar sayfası ve diğer araçlar için): `syzer key <list|add|remove|use> --json`
const config = require('./config');
const providers = require('./providers');
const { mask, usable, addKeys } = require('./keys');
const { validateKey } = require('./api');

const stateOf = (e) => (e.disabled ? 'off' : e.blockedUntil > Date.now() ? 'wait' : 'ready');

function listAll() {
  return {
    providers: providers.list().map((p) => {
      const st = config.loadKeys(p.id);
      return {
        id: p.id, name: p.name, hint: p.keyHint,
        keys: st.keys.map((e, i) => ({ index: i + 1, key: mask(e.key), state: stateOf(e), ready: usable(e), reason: e.reason || null, until: e.blockedUntil > Date.now() ? e.blockedUntil : null, active: i === (st.active | 0) })),
      };
    }),
  };
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
async function test(provider, validate = validateKey) {
  const out = [];
  for (const id of ids(provider)) {
    const st = config.loadKeys(id);
    const p = providers.PROVIDERS[id];
    await Promise.all(st.keys.map(async (e) => {
      try {
        await validate(p, e.key);
        if (e.disabled && /^(401|403)/.test(String(e.reason || ''))) { delete e.disabled; delete e.reason; }
      } catch (err) {
        const why = `${err.status || ''} ${err.message}`.trim();
        if (/^(401|403)/.test(why)) { e.disabled = true; e.reason = why.slice(0, 3); }
      }
    }));
    if (st.keys.length) config.saveKeys(id, st);
    out.push({ id, keys: st.keys.map((e, i) => ({ index: i + 1, state: stateOf(e), reason: e.reason || null })) });
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

module.exports = { listAll, add, remove, use, test, prune, stateOf };
