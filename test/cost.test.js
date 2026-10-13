'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-cost-'));

const cost = require('../src/cost');
const B = require('../src/budget');
const ext = require('../src/ext/cost');

const callOf = (model, index, total, extra = {}) => ({ model, index, res: { usage: { total_tokens: total, prompt_tokens: total - 10, completion_tokens: 10, ...extra } } });

test('cost: empty session reports "no information" and no budget', () => {
  const out = cost.report({ sessionId: 's0' });
  assert.match(out, /no information/);
  assert.match(out, /Budget: no limits set/);
  assert.match(ext.commands.cost.run('', { session: { sessionId: 's0' } }), /Session cost/);
  assert.doesNotThrow(() => cost.report(undefined));
});

test('cost: per-model tokens, keys, turns, subagent line, verification, budget', () => {
  const root = { sessionId: 's1', model: 'm-main', budget: B.createTracker({ tokens: 1000 }) };
  root.budget.addTokens(500);
  const sub = { agentName: 'explore', parentSession: root, model: 'm-sub' };
  cost.record(root, callOf('m-main', 0, 100));
  cost.record(root, callOf('m-main', 1, 50));
  cost.record(sub, callOf('m-sub', 0, 30));
  cost.noteTurn(root, { ms: 65000, verifyTries: 2, verifyFailed: true });
  const out = cost.report(root);
  assert.match(out, /m-main: 150 tokens, 2 calls/);
  assert.match(out, /m-sub: 30 tokens, 1 calls/);
  assert.match(out, /Total: 180 tokens, 3 model calls/);
  assert.match(out, /Turns: 1, active time 1m 05s/);
  assert.match(out, /Keys used: 2 \(#1:2 #2:1\)/);
  assert.match(out, /Subagents: 30 tokens in 1 calls .*explore 30/);
  assert.match(out, /Verification: 2 retry attempt\(s\) over 1 turn\(s\), 1 gave up/);
  assert.match(out, /Budget \(current task\): 500\/1,000 tokens/);
});

test('cost: ledger resets when the session id changes (/new)', () => {
  const s = { sessionId: 'a' };
  cost.record(s, callOf('m', 0, 10));
  assert.match(cost.report(s), /Total: 10 tokens/);
  s.sessionId = 'b';
  assert.match(cost.report(s), /no information/);
});

test('cost: tolerates missing usage and malformed calls', () => {
  const s = { sessionId: 'c' };
  assert.doesNotThrow(() => { cost.record(s, { model: 'm', res: {} }); cost.record(s, null); cost.noteTurn(s); });
  assert.match(cost.report(s), /m: 0 tokens, 1 calls/);
});
