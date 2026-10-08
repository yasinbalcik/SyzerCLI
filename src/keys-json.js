'use strict';

// Makine okunur key yönetimi (Orca ayarlar sayfası ve diğer araçlar için): `syzer key <list|add|remove|use> --json`
const config = require('./config');
const providers = require('./providers');
const { mask, usable, addKeys } = require('./keys');

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

module.exports = { listAll, add, remove, use };
