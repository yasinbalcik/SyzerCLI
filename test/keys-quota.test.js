'use strict';
// `syzer key list|usage --json`: önbellekten kota eşleme (ağ yok), toplamlar, yaş sınırı, bütçe aktarımı.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-quota-'));
const config = require('../src/config');
const kj = require('../src/keys-json');
const us = require('../src/usage-summary');
const providers = require('../src/providers');

const K = ['sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaa', 'sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbb', 'sk-or-v1-cccccccccccccccccccccccc', 'sk-or-v1-dddddddddddddddddddddddd'];
const seed = () => config.saveKeys('openrouter', { active: 0, keys: K.map((key) => ({ key })) });
const NOW = 1_800_000_000_000;
const orRow = (r) => r.providers.find((p) => p.id === 'openrouter');

test('listAll maps free/credit/checked_at from cache, sums totals, ignores entries older than 24h', () => {
  seed();
  const cache = {
    [us.fingerprint(K[0])]: { at: NOW - 1000, data: { free_model_daily_requests: { used: 10, remaining: 40, limit: 50 }, usage: 1.5, limit: 10, limit_remaining: 8.5 } },
    [us.fingerprint(K[1])]: { at: NOW - 5000, data: { free_model_daily_requests: { used: 50, remaining: 0, limit: 50 }, limit: null } },
    [us.fingerprint(K[2])]: { at: NOW - 25 * 3600e3, data: { free_model_daily_requests: { used: 0, remaining: 50, limit: 50 } } }, // bayat
  };
  const p = orRow(kj.listAll({ readCache: () => cache, now: NOW }));
  assert.deepStrictEqual(p.keys[0].free, { remaining: 40, limit: 50, used: 10 });
  assert.deepStrictEqual(p.keys[0].credit, { remaining: 8.5, limit: 10, usage: 1.5 });
  assert.strictEqual(p.keys[0].checked_at, NOW - 1000);
  assert.strictEqual(p.keys[1].credit, null);
  assert.strictEqual(p.keys[2].free, null);
  assert.strictEqual(p.keys[3].checked_at, null);
  assert.deepStrictEqual(p.totals, { keys_total: 4, ready: 4, keys_with_data: 2, free_remaining: 40, free_limit: 100, oldest_check_at: NOW - 5000, newest_check_at: NOW - 1000 });
});

test('listAll: providers without usage API get free:null and zeroed totals even if cache matches', () => {
  seed();
  config.saveKeys('nvidia', { active: 0, keys: [{ key: 'nvapi-' + 'x'.repeat(40) }] });
  const nv = providers.PROVIDERS.nvidia;
  assert.ok(nv && !nv.hasUsageApi);
  const cache = { [us.fingerprint('nvapi-' + 'x'.repeat(40))]: { at: NOW, data: { free_model_daily_requests: { used: 1, remaining: 2, limit: 3 } } } };
  const p = kj.listAll({ readCache: () => cache, now: NOW }).providers.find((x) => x.id === 'nvidia');
  assert.strictEqual(p.keys[0].free, null);
  assert.strictEqual(p.totals.keys_with_data, 0);
  assert.strictEqual(p.totals.oldest_check_at, null);
});

test('usage: budget plumbing, refreshed/total counts, result reflects fresh cache', async () => {
  seed();
  fs.rmSync(path.join(config.DIR, 'usage-key-cache.json'), { force: true });
  let calls = 0;
  const fetchKey = async (k) => { calls++; return { data: { free_model_daily_requests: { used: 1, remaining: 49, limit: 50 } } }; };
  const r = await kj.usage('openrouter', { all: true, fetchKey });
  assert.strictEqual(calls, 4);
  assert.deepStrictEqual([r.refreshed, r.total], [4, 4]);
  const p = orRow(r);
  assert.strictEqual(p.totals.keys_with_data, 4);
  assert.strictEqual(p.totals.free_remaining, 196);
  assert.strictEqual(r.providers.length, 1); // --provider süzer

  // dar bütçe: yavaş fetchKey ile tüm key'ler yenilenemez
  fs.rmSync(path.join(config.DIR, 'usage-key-cache.json'), { force: true });
  config.saveKeys('openrouter', { active: 0, keys: Array.from({ length: 60 }, (_, i) => ({ key: 'sk-or-v1-' + String(i).padStart(24, '0') })) });
  const r2 = await kj.usage('openrouter', { budgetMs: 1, fetchKey: async () => { await new Promise((x) => setTimeout(x, 40)); return { data: {} }; } });
  assert.ok(r2.refreshed < 60 && r2.total === 60);
});

test('refreshKeyUsage: exhausted budget skips queries and returns counts', async () => {
  seed();
  fs.rmSync(path.join(config.DIR, 'usage-key-cache.json'), { force: true });
  let calls = 0;
  const r = await us.refreshKeyUsage(K.map((key) => ({ key })), { budgetMs: -1, fetchKey: async () => { calls++; return { data: {} }; } });
  assert.deepStrictEqual(r, { refreshed: 0, total: 4 });
  assert.strictEqual(calls, 0);
});
