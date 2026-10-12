'use strict';
// `syzer key test|prune --json`: canlı doğrulama sonucu key durumları ve toplu silme.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-keys-'));
const config = require('../src/config');
const kj = require('../src/keys-json');

const seed = () => config.saveKeys('openrouter', { active: 1, keys: [
  { key: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaa' },
  { key: 'sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbb' },
  { key: 'sk-or-v1-cccccccccccccccccccccccc', disabled: true, reason: '401' },
  { key: 'sk-or-v1-dddddddddddddddddddddddd', blockedUntil: Date.now() + 3600e3, reason: '429 daily' },
] });

test('test: 401 disables, 429 leaves key untouched, success re-enables an auth-disabled key', async () => {
  seed();
  const fake = async (p, key) => {
    if (key.includes('bbbb')) throw Object.assign(new Error('bad key'), { status: 401 });
    if (key.includes('aaaa')) throw Object.assign(new Error('slow down'), { status: 429 });
    return { ok: true };
  };
  const r = await kj.test('openrouter', fake);
  const keys = r.providers.find((p) => p.id === 'openrouter').keys;
  assert.deepStrictEqual(keys.map((k) => k.state), ['ready', 'off', 'ready', 'wait']);
  assert.strictEqual(keys[1].reason, '401');
  assert.strictEqual(keys[2].reason, null);
  assert.strictEqual(config.loadKeys('openrouter').keys[1].disabled, true);
});

test('prune: removes non-ready keys and keeps the active pointer on the same key', () => {
  seed();
  config.saveKeys('openrouter', { active: 1, keys: config.loadKeys('openrouter').keys });
  const r = kj.prune('openrouter');
  assert.strictEqual(r.removed, 2);
  const st = config.loadKeys('openrouter');
  assert.strictEqual(st.keys.length, 2);
  assert.strictEqual(st.active, 1);
  assert.ok(st.keys[1].key.includes('bbbb'));
});
