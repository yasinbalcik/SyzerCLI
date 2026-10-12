'use strict';

const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/budget');

const clock = () => { let t = 1000; const f = () => t; f.adv = (ms) => { t += ms; }; return f; };

test('parseLimit validates', () => {
  assert.strictEqual(B.parseLimit('400000'), 400000);
  assert.strictEqual(B.parseLimit(30), 30);
  assert.strictEqual(B.parseLimit('off'), null);
  assert.strictEqual(B.parseLimit(null), null);
  assert.strictEqual(B.parseLimit('-5'), undefined);
  assert.strictEqual(B.parseLimit('abc'), undefined);
  assert.strictEqual(B.parseLimit('NaN'), undefined);
});

test('normalize drops invalid / negative values to off', () => {
  assert.deepStrictEqual(B.normalize({ tokens: -1, turns: 'x', minutes: 5 }), { tokens: null, turns: null, minutes: 5 });
  assert.deepStrictEqual(B.normalize(undefined), { tokens: null, turns: null, minutes: null });
});

test('resolve: env wins over flags and saved config', () => {
  const r = B.resolve({ tokens: 100, turns: 10 }, { SYZER_BUDGET_TOKENS: '500' }, { tokens: '300', turns: '20' });
  assert.deepStrictEqual(r, { tokens: 500, turns: 20, minutes: null });
  assert.strictEqual(B.resolve({ tokens: 100 }, { SYZER_BUDGET_TOKENS: 'bad' }, {}).tokens, 100);
});

test('all off by default: never warns or exceeds', () => {
  const tr = B.createTracker(null);
  assert.strictEqual(tr.active(), false);
  tr.addTokens(1e9); tr.addTurn();
  const c = tr.check();
  assert.deepStrictEqual(c.warn, []);
  assert.strictEqual(c.exceeded, null);
});

test('tokens: warn once at 80%, exceed at 100%', () => {
  const tr = B.createTracker({ tokens: 1000 });
  tr.addTokens(799);
  assert.strictEqual(tr.check().warn.length, 0);
  tr.addTokens(1);
  const w = tr.check();
  assert.strictEqual(w.warn.length, 1);
  assert.strictEqual(w.warn[0].dim, 'tokens');
  assert.strictEqual(tr.check().warn.length, 0); // once
  assert.strictEqual(tr.check().exceeded, null);
  tr.addTokens(200);
  assert.strictEqual(tr.check().exceeded.dim, 'tokens');
});

test('turns and minutes are independent dimensions', () => {
  const now = clock();
  const tr = B.createTracker({ turns: 5, minutes: 10 }, now);
  for (let i = 0; i < 4; i++) tr.addTurn();
  assert.deepStrictEqual(tr.check().warn.map((w) => w.dim), ['turns']);
  now.adv(8 * 60000);
  assert.deepStrictEqual(tr.check().warn.map((w) => w.dim), ['minutes']);
  assert.strictEqual(tr.exceeded(), null);
  now.adv(2 * 60000);
  assert.strictEqual(tr.exceeded().dim, 'minutes');
});

test('reset per task clears counters, clock and warnings', () => {
  const now = clock();
  const tr = B.createTracker({ tokens: 100, minutes: 1 }, now);
  tr.addTokens(100); now.adv(120000);
  assert.ok(tr.exceeded());
  tr.reset();
  assert.strictEqual(tr.exceeded(), null);
  assert.strictEqual(tr.used().tokens, 0);
  tr.addTokens(85);
  assert.strictEqual(tr.check().warn.length, 1);
});

test('onResponse: uses API usage, else chars/4 estimate; counts turns only with tool calls', () => {
  const tr = B.createTracker({ tokens: 1000, turns: 3 });
  const warns = [];
  B.onResponse(tr, { usage: { total_tokens: 300 }, toolCalls: [{}] }, [], (m) => warns.push(m));
  assert.strictEqual(tr.used().tokens, 300);
  assert.strictEqual(tr.used().turns, 1);
  B.onResponse(tr, { content: 'x'.repeat(40), toolCalls: [] }, [{ content: 'y'.repeat(360) }], (m) => warns.push(m));
  assert.strictEqual(tr.used().tokens, 400); // (360+40)/4 = 100
  assert.strictEqual(tr.used().turns, 1);
  B.onResponse(tr, { usage: { total_tokens: 450 }, toolCalls: [{}] }, [], (m) => warns.push(m));
  assert.strictEqual(warns.length, 1); // 850/1000 crossed 80%
  assert.match(warns[0], /tokens/);
});

test('stopReason: null when under, text and message when over; null tracker is safe', () => {
  const tr = B.createTracker({ turns: 2 });
  const warns = [];
  B.onResponse(tr, { usage: { total_tokens: 1 }, toolCalls: [{}] }, [], (m) => warns.push(m));
  assert.strictEqual(B.stopReason(tr, (m) => warns.push(m)), null);
  B.onResponse(tr, { usage: { total_tokens: 1 }, toolCalls: [{}] }, [], (m) => warns.push(m));
  const r = B.stopReason(tr, (m) => warns.push(m));
  assert.match(r, /tool turns limit reached \(2\/2 tool turns\)/);
  assert.match(B.stopMessage(r), /Reply to continue/);
  assert.strictEqual(B.stopReason(null, () => {}), null);
});
