'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { vlen, strip } = require('../src/ui');
const { setLang } = require('../src/i18n');
const { createStore, renderTree, renderCompact } = require('../src/agent-tree');

setLang('en');

function mk(n, extra) {
  const s = createStore(() => 1000);
  s.setMain({ model: 'a/main-model', effort: 'high' });
  for (let i = 1; i <= n; i++) {
    s.start(i, Object.assign({ kind: 'explore', label: 'task ' + i }, extra));
    s.run(i);
  }
  return s;
}
const all = (lines) => strip(lines.join('\n'));

test('store lifecycle', () => {
  const s = createStore(() => 5000);
  s.start(1, { kind: 'k', label: 'l' });
  assert.equal(s.snapshot().nodes[0].status, 'queued');
  s.run(1);
  assert.equal(s.snapshot().nodes[0].status, 'running');
  s.update(1, { action: 'read', steps: 3, tokens: 99 });
  const n = s.snapshot().nodes[0];
  assert.equal(n.action, 'read'); assert.equal(n.steps, 3); assert.equal(n.tokens, 99);
  s.finish(1, { ok: true, model: 'm' });
  assert.equal(s.snapshot().nodes[0].status, 'done');
  assert.equal(s.snapshot().nodes[0].t1, 5000);
  s.start(2, { kind: 'k', label: 'l' });
  s.finish(2, { ok: false });
  assert.equal(s.snapshot().nodes[1].status, 'failed');
});

test('newTurn clears nodes but keeps log', () => {
  const s = mk(2);
  s.event('hello', 1);
  s.newTurn();
  assert.equal(s.snapshot().nodes.length, 0);
  assert.equal(s.snapshot().log.length, 1);
});

test('log is capped at 200', () => {
  const s = createStore();
  for (let i = 0; i < 250; i++) s.event('e' + i);
  const log = s.snapshot().log;
  assert.equal(log.length, 200);
  assert.equal(log[199].text, 'e249');
});

test('renderCompact marks statuses', () => {
  const s = createStore(() => 1000);
  s.setMain({ model: 'm', effort: 'low' });
  for (let i = 1; i <= 4; i++) s.start(i, { kind: 'k' + i, label: 'x' });
  s.run(2); s.run(3); s.finish(3, { ok: true }); s.run(4); s.finish(4, { ok: false });
  const out = renderCompact(s.snapshot(), { width: 80, now: 1000 });
  const t = out.map(strip);
  assert.ok(t[0].includes('main'));
  assert.ok(t[1].includes('…') && t[1].includes('├'));
  assert.ok(t[2].includes('●'));
  assert.ok(t[3].includes('✓'));
  assert.ok(t[4].includes('✖') && t[4].includes('└'));
  const big = renderCompact(mk(8).snapshot(), { width: 80, now: 1000 }).map(strip);
  assert.equal(big.length, 1 + 6 + 1);
  assert.ok(big[big.length - 1].includes('+2'));
});

test('renderTree wide', () => {
  const s = mk(5);
  s.update(1, { action: 'grep foo' });
  const out = renderTree(s.snapshot(), { width: 100, rows: 40, now: 3000 });
  assert.ok(all(out).includes('┌'));
  assert.ok(out.every((l) => vlen(l) <= 100));
  const txt = all(out);
  assert.ok(txt.includes('explore'));
  assert.ok(txt.includes('main-model'));
});

test('renderTree narrow', () => {
  const out = renderTree(mk(4).snapshot(), { width: 36, rows: 30, now: 3000 });
  assert.ok(!all(out).includes('┌'));
  assert.ok(out.every((l) => vlen(l) <= 36));
});

test('renderTree empty', () => {
  const s = createStore();
  const out = renderTree(s.snapshot(), { width: 80, rows: 20, now: 1 });
  assert.ok(all(out).includes('no subagents yet'));
});

test('renderTree long label', () => {
  for (const label of ['x'.repeat(200), '日本語'.repeat(40)]) {
    const s = createStore(() => 1000);
    s.setMain({ model: 'm', effort: 'e' });
    s.start(1, { kind: 'k', label }); s.run(1);
    s.update(1, { action: label });
    s.event(label, 1);
    for (const width of [36, 60, 100]) {
      const out = renderTree(s.snapshot(), { width, rows: 30, now: 2000 });
      assert.ok(out.every((l) => vlen(l) <= width), 'width ' + width);
      const c = renderCompact(s.snapshot(), { width, now: 2000 });
      assert.ok(c.every((l) => vlen(l) <= width));
    }
  }
});

test('renderTree log tail', () => {
  const s = mk(10);
  for (let i = 0; i < 30; i++) s.event('ev' + i, 1);
  const out = renderTree(s.snapshot(), { width: 100, rows: 20, now: 2000 });
  assert.ok(out.length <= 20);
  const txt = all(out);
  assert.ok(txt.includes('ev29'));
  assert.ok(!txt.includes('ev0 ') && !txt.includes('ev1 '));
});

test('orca node label', () => {
  const s = mk(1, { orca: true });
  assert.ok(all(renderTree(s.snapshot(), { width: 100, rows: 20, now: 2000 })).includes('Orca'));
  assert.ok(all(renderTree(s.snapshot(), { width: 40, rows: 20, now: 2000 })).includes('Orca'));
});
