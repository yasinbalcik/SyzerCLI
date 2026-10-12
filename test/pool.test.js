'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapLimit, retry429, retryResult, isRateLimited } = require('../src/pool');

const noSleep = () => Promise.resolve();
const err = (status, message = 'x') => Object.assign(new Error(message), { status });

test('mapLimit never exceeds the limit and keeps input order', async () => {
  let live = 0; let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5 + (n % 3)));
    live--;
    return n * 2;
  });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.ok(peak <= 3, `peak ${peak}`);
});

test('mapLimit handles empty input', async () => {
  assert.deepStrictEqual(await mapLimit([], 4, async () => 1), []);
});

test('retry429 backs off on 429 and then succeeds', async () => {
  let calls = 0; const waits = [];
  const v = await retry429(async () => { if (++calls < 3) throw err(429, 'Rate limit exceed'); return 'ok'; }, { sleep: async (ms) => { waits.push(ms); }, rand: () => 0 });
  assert.strictEqual(v, 'ok');
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(waits, [800, 1600]);
});

test('retry429 does not retry non-429 errors and rethrows after the last try', async () => {
  let calls = 0;
  await assert.rejects(retry429(async () => { calls++; throw err(401, 'bad key'); }, { sleep: noSleep }), /bad key/);
  assert.strictEqual(calls, 1);
  calls = 0;
  await assert.rejects(retry429(async () => { calls++; throw err(429); }, { tries: 3, sleep: noSleep }), (e) => e.status === 429);
  assert.strictEqual(calls, 3);
});

test('retryResult retries only result objects with status 429', async () => {
  let calls = 0;
  const r = await retryResult(async () => (++calls < 2 ? { ok: false, status: 429, error: 'Rate limit exceed' } : { ok: true, data: 1 }), { sleep: noSleep });
  assert.deepStrictEqual(r, { ok: true, data: 1 });
  calls = 0;
  const r2 = await retryResult(async () => { calls++; return { ok: false, status: 401 }; }, { sleep: noSleep });
  assert.strictEqual(r2.status, 401);
  assert.strictEqual(calls, 1);
});

test('isRateLimited recognises status and message', () => {
  assert.ok(isRateLimited(err(429)));
  assert.ok(isRateLimited(err(500, 'Rate limit exceeded')));
  assert.ok(!isRateLimited(err(401, 'nope')));
  assert.ok(!isRateLimited(null));
});

test('keys-json test() marks keys it could not verify and does not disable them', async () => {
  const config = require('../src/config');
  const kj = require('../src/keys-json');
  const providers = require('../src/providers');
  const id = providers.list()[0].id;
  const orig = { load: config.loadKeys, save: config.saveKeys };
  const store = { active: 0, keys: [{ key: 'sk-a' }, { key: 'sk-b' }, { key: 'sk-c' }] };
  config.loadKeys = () => store;
  config.saveKeys = () => {};
  try {
    const validate = async (p, key) => {
      if (key === 'sk-b') throw err(401, 'invalid');
      if (key === 'sk-c') throw err(429, 'Rate limit exceed');
    };
    const r = await kj.test(id, validate, { concurrency: 2, retry: { tries: 2, sleep: noSleep }, pause: async () => {} });
    const p = r.providers[0];
    assert.strictEqual(p.unverified, 1);
    assert.strictEqual(p.keys[1].state, 'off');          // 401 -> disabled
    assert.strictEqual(p.keys[2].state, 'ready');        // 429 -> left alone ...
    assert.strictEqual(p.keys[2].verified, false);       // ... but reported as unverified
    assert.strictEqual(p.keys[0].verified, true);
  } finally { config.loadKeys = orig.load; config.saveKeys = orig.save; }
});
