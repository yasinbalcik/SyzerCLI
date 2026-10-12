'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/compact');

const est = (msgs) => msgs.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0) + (m.tool_calls ? 20 * m.tool_calls.length : 0), 0);
const big = (n, ch = 'x') => ch.repeat(n);

// system, then `turns` x (user, assistant(tool_call), tool)
function convo(turns, toolSize = 5000) {
  const m = [{ role: 'system', content: 'SYS' }];
  for (let i = 0; i < turns; i++) {
    m.push({ role: 'user', content: `task ${i}` });
    m.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
    m.push({ role: 'tool', tool_call_id: `c${i}`, content: `${i}:` + big(toolSize) });
  }
  m.push({ role: 'assistant', content: 'done' });
  return m;
}

function pairingOk(msgs) {
  const calls = new Set();
  const results = new Set();
  msgs.forEach((m) => { (m.tool_calls || []).forEach((c) => calls.add(c.id)); if (m.role === 'tool') results.add(m.tool_call_id); });
  return [...results].every((id) => calls.has(id)) && [...calls].every((id) => results.has(id));
}

test('trim: keeps recent N tool results, trims older large ones, pairing intact', () => {
  const msgs = convo(10);
  const r = C.trimToolResults(msgs);
  assert.strictEqual(r.trimmed, 4);
  assert.strictEqual(r.messages.length, msgs.length);
  assert.ok(pairingOk(r.messages));
  const tools = r.messages.filter((m) => m.role === 'tool');
  assert.ok(tools.slice(0, 4).every((m) => /…\[trimmed \d+ chars\]…/.test(m.content) && m.content.length < 1100));
  assert.ok(tools.slice(4).every((m) => m.content.length > 4000));
  assert.deepStrictEqual(r.messages[0], msgs[0]);
  assert.ok(msgs[3].content.length > 4000, 'input not mutated');
});

test('trim: head 600 + tail 300 and marker reports the cut size', () => {
  const content = big(3000, 'a');
  const r = C.trimToolResults([{ role: 'tool', tool_call_id: 'x', content }], { keep: 0 });
  assert.strictEqual(r.messages[0].content, `${big(600, 'a')}\n…[trimmed 2100 chars]…\n${big(300, 'a')}`);
});

test('trim: small outputs and latest user message untouched; idempotent', () => {
  const msgs = convo(10, 1500);
  assert.strictEqual(C.trimToolResults(msgs).trimmed, 0);
  const big10 = convo(10);
  big10.splice(big10.length - 1, 0, { role: 'user', content: big(9000, 'u') });
  const once = C.trimToolResults(big10);
  const twice = C.trimToolResults(once.messages);
  assert.strictEqual(twice.trimmed, 0);
  assert.deepStrictEqual(twice.messages, once.messages);
  assert.strictEqual(once.messages[once.messages.length - 2].content.length, 9000);
});

test('pickCut: lands on a user boundary near the half, never splits tool pairs, keeps latest user', () => {
  const msgs = convo(8);
  const cut = C.pickCut(msgs, est);
  assert.strictEqual(msgs[cut].role, 'user');
  assert.ok(cut >= 2 && cut <= msgs.map((m) => m.role).lastIndexOf('user'));
  const head = msgs.slice(0, cut);
  const tail = msgs.slice(cut);
  assert.ok(pairingOk(head) && pairingOk(tail));
  const total = est(msgs.slice(1));
  assert.ok(Math.abs(est(msgs.slice(1, cut)) - total / 2) < total / 4);
  assert.strictEqual(C.pickCut([{ role: 'system', content: 's' }, { role: 'user', content: 'only' }], est), null);
});

test('summarizePass: replaces oldest half with one summary message', async () => {
  const msgs = convo(8);
  let seen = '';
  const r = await C.summarizePass(msgs, { est, summarize: async (tr) => { seen = tr; return 'goals: X; files: a.js'; } });
  assert.ok(r.summarized > 0);
  assert.strictEqual(r.messages[0].content, 'SYS');
  assert.strictEqual(r.messages[1].role, 'user');
  assert.ok(r.messages[1].content.startsWith('[Conversation summary]'));
  assert.ok(pairingOk(r.messages));
  assert.strictEqual(r.messages[r.messages.length - 1].content, 'done');
  assert.ok(seen.includes('USER: task 0'));
  assert.ok(r.messages.length < msgs.length);
});

test('summarizePass: failure / empty summary returns null (history untouched)', async () => {
  const msgs = convo(8);
  assert.strictEqual(await C.summarizePass(msgs, { est, summarize: async () => { throw new Error('boom'); } }), null);
  assert.strictEqual(await C.summarizePass(msgs, { est, summarize: async () => '  ' }), null);
});

test('summarizePass: summary capped', async () => {
  const r = await C.summarizePass(convo(8), { est, summarize: async () => big(10000, 's') });
  assert.ok(r.messages[1].content.length < 3300);
});

test('compactMessages auto: under threshold is a no-op; over threshold trims then summarizes only if needed', async () => {
  const msgs = convo(10);
  const calls = [];
  const deps = { est, persist: (m) => { calls.push('persist'); return 'f.json'; }, summarize: async () => { calls.push('sum'); return 'S'; } };
  const noop = await C.compactMessages(msgs, { mode: 'auto', threshold: 1e9, deps });
  assert.strictEqual(noop.messages, msgs);
  assert.deepStrictEqual(calls, []);
  // trim alone gets below threshold -> no summary
  const t1 = await C.compactMessages(msgs, { mode: 'auto', threshold: 40000, deps });
  assert.ok(t1.trimmed > 0 && t1.summarized === 0 && t1.after < t1.before);
  assert.deepStrictEqual(calls, ['persist']);
  // still above after trim -> summary
  calls.length = 0;
  const t2 = await C.compactMessages(msgs, { mode: 'auto', threshold: 5000, deps });
  assert.ok(t2.trimmed > 0 && t2.summarized > 0);
  assert.deepStrictEqual(calls, ['persist', 'sum']);
  assert.ok(pairingOk(t2.messages));
  assert.ok(/^compacted: ~[\d,]+ → ~[\d,]+ tokens \(trimmed \d+ tool outputs, summarized \d+ messages\)$/.test(C.line(t2)));
});

test('compactMessages: trim mode never calls summarizer; failing summarizer keeps step-1 result', async () => {
  const msgs = convo(10);
  let n = 0;
  const t = await C.compactMessages(msgs, { mode: 'trim', deps: { est, summarize: async () => { n++; return 'S'; } } });
  assert.strictEqual(n, 0);
  assert.ok(t.trimmed > 0 && t.summarized === 0);
  const f = await C.compactMessages(msgs, { mode: 'force', deps: { est, summarize: async () => { throw new Error('x'); } } });
  assert.ok(f.summaryFailed && f.trimmed > 0 && f.summarized === 0);
  assert.strictEqual(f.messages.length, msgs.length);
  assert.ok(pairingOk(f.messages));
});

test('persistPrecompact writes the full pre-compaction transcript', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-pc-'));
  try {
    const msgs = convo(4);
    const r = await C.compactMessages(msgs, {
      mode: 'force', deps: { est, summarize: async () => 'S', persist: (m) => C.persistPrecompact(path.join(dir, 'sess'), m, () => 123) },
    });
    assert.ok(r.summarized > 0);
    assert.strictEqual(r.file, path.join(dir, 'sess', 'precompact-123.json'));
    const saved = JSON.parse(fs.readFileSync(r.file, 'utf8'));
    assert.strictEqual(saved.messages.length, msgs.length);
    assert.ok(saved.messages[3].content.length > 4000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('persist failure aborts compaction (nothing lost)', async () => {
  await assert.rejects(C.compactMessages(convo(10), { mode: 'force', deps: { est, summarize: async () => 'S', persist: () => { throw new Error('disk'); } } }));
});

test('threshold resolution: env > config > 70% window > 60k', () => {
  assert.strictEqual(C.resolveThreshold({ cfg: {}, env: {}, win: 100000 }), 70000);
  assert.strictEqual(C.resolveThreshold({ cfg: {}, env: {}, win: null }), 60000);
  assert.strictEqual(C.resolveThreshold({ cfg: { compact: { threshold: '50%' } }, env: {}, win: 100000 }), 50000);
  assert.strictEqual(C.resolveThreshold({ cfg: { compact: { threshold: 30000 } }, env: { SYZER_COMPACT_TOKENS: '20k' }, win: 100000 }), 20000);
  assert.strictEqual(C.resolveThreshold({ cfg: {}, env: { SYZER_COMPACT_TOKENS: 'off' }, win: 100000 }), Infinity);
  assert.strictEqual(C.resolveThreshold({ cfg: {}, env: { SYZER_COMPACT_TOKENS: 'junk' }, win: 100000 }), 70000);
});
