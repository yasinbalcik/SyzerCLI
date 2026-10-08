'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Dock } = require('../src/dock');

function mk(getTree) {
  let buf = '';
  const out = { isTTY: true, columns: 100, rows: 30, write(s) { buf += s; } };
  const input = { on() {}, off() {}, removeListener() {}, setRawMode() {}, resume() {}, pause() {} };
  const d = new Dock({ editor: { items: [], cur: 0 }, input, out });
  d.active = true; d.rows = 30;
  d.agents = [{ id: 1, no: 1, kind: 'explorer', label: 'x', t0: Date.now(), steps: 1, tokens: 0 }];
  d.h = d.need();
  d.getTree = getTree;
  return { d, get: () => buf };
}

test('dock draws tree rows from getTree', () => {
  const snap = { main: { model: 'm', effort: 'e' }, log: [], nodes: [
    { id: 1, kind: 'explorer', label: 'x', status: 'running', steps: 1, tokens: 0, t0: Date.now() },
    { id: 2, kind: 'explorer', label: 'y', status: 'done', steps: 1, tokens: 0, t0: Date.now() },
  ] };
  const { d, get } = mk(() => snap);
  d.draw();
  assert.match(get(), /explorer/);
  assert.match(get(), /[├└]/);
  assert.doesNotMatch(get(), /○/);
});

test('dock falls back to old rows when getTree throws', () => {
  const { d, get } = mk(() => { throw new Error('x'); });
  assert.doesNotThrow(() => d.draw());
  assert.match(get(), /○/);
});

const node = (id, kind, label) => ({ id, kind, label, status: 'running', steps: 1, tokens: 0, t0: Date.now() });
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b[78]/g, '');
const rowsOf = (buf) => buf.split('\x1b[2K').map(strip);

test('marked row follows dock.agents order, extra store nodes not drawn', () => {
  const snap = { main: {}, log: [], nodes: [node(3, 'worker', 'ccc'), node(9, 'ghost', 'zzz'), node(2, 'reviewer', 'bbb'), node(1, 'explorer', 'aaa')] };
  const { d, get } = mk(() => snap);
  d.agents = [1, 2, 3].map((id) => ({ id, no: id, kind: 'k', label: 'l', t0: Date.now(), steps: 0, tokens: 0 }));
  d.h = d.need();
  d.sel = 2;
  d.draw();
  const marked = rowsOf(get()).filter((r) => r.includes('❯') && !r.startsWith('❯'));
  assert.strictEqual(marked.length, 1);
  assert.match(marked[0], /reviewer/);
  assert.doesNotMatch(get(), /ghost/);
});

test('more row never carries the mark', () => {
  const nodes = [];
  for (let i = 1; i <= 8; i++) nodes.push(node(i, 'kind' + i, 'l' + i));
  const { d, get } = mk(() => ({ main: {}, log: [], nodes }));
  d.agents = nodes.map((n) => ({ id: n.id, no: n.id, kind: n.kind, label: 'l', t0: Date.now(), steps: 0, tokens: 0 }));
  d.h = d.need();
  d.sel = 8;
  d.draw();
  const rows = rowsOf(get());
  assert.strictEqual(rows.filter((r) => /[├└]/.test(r)).length, 7);
  assert.ok(rows.some((r) => /└/.test(r) && !/kind/.test(r)));
  assert.ok(!rows.some((r) => /└/.test(r) && !/kind/.test(r) && r.includes('❯')));
});
