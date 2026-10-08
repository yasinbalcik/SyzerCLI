'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Dock } = require('../src/dock');
require('../src/i18n').setLang('en');

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

function mkTree(nodes) {
  const r = mk(() => ({ main: { model: 'm', effort: 'e' }, log: [], nodes }));
  r.d.agents = nodes.map((n) => ({ id: n.id, no: n.id, kind: n.kind, label: 'l', t0: Date.now(), steps: 0, tokens: 0 }));
  r.d.h = r.d.need();
  r.d.out.write = ((w) => (s) => w(s))(r.d.out.write);
  return r;
}

test('openTree shows main and agent kind, esc closes', () => {
  const { d } = mkTree([node(1, 'explorer', 'aaa')]);
  try {
    d.openTree();
    assert.strictEqual(d.viewing.kind, 'tree');
    const txt = strip(d.viewLines(98).join('\n'));
    assert.match(txt, /main/);
    assert.match(txt, /explorer/);
    d.handleKey('', { name: 'escape' });
    assert.strictEqual(d.viewing, null);
  } finally { clearInterval(d.viewTimer); if (d.viewing) d.closeView(); }
});

test('enter on selected agent opens agent view', () => {
  const { d } = mkTree([node(1, 'explorer', 'aaa'), node(2, 'worker', 'bbb')]);
  try {
    d.openTree();
    d.handleKey('', { name: 'down' });
    d.handleKey('', { name: 'return' });
    assert.strictEqual(d.viewing.kind, 'agent');
    assert.strictEqual(d.viewing.id, 2);
  } finally { clearInterval(d.viewTimer); if (d.viewing) d.closeView(); }
});

test('openTree with empty snapshot does not throw', () => {
  const { d } = mkTree([]);
  d.agents = [];
  try {
    assert.doesNotThrow(() => d.openTree());
    assert.match(strip(d.viewLines(98).join('\n')), /no subagents yet/);
  } finally { clearInterval(d.viewTimer); if (d.viewing) d.closeView(); }
});

test('submit /tree runs live, not queued', () => {
  const { d } = mk(() => ({ main: {}, log: [], nodes: [] }));
  let called = null;
  d.live = (l) => { called = l; return Promise.resolve(); };
  d.submit({ text: '/tree' });
  assert.strictEqual(called, '/tree');
  assert.strictEqual(d.queue.length, 0);
});

test('tree -> agent -> close installs and restores write hooks once', () => {
  const { d } = mkTree([node(1, 'explorer', 'aaa')]);
  const errW = process.stderr.write;
  const sink = [];
  const realW = d.out.write;
  d.out.write = (s) => sink.push(s);
  try {
    d.openTree();
    d.handleKey('', { name: 'return' });
    assert.strictEqual(d.viewing.kind, 'agent');
    d.handleKey('', { name: 'escape' });
    assert.strictEqual(d.viewing, null);
    assert.strictEqual(d._origOut, null);
    assert.strictEqual(process.stderr.write, errW);
    d.out.write('hello');
    assert.ok(sink.includes('hello'));
  } finally { clearInterval(d.viewTimer); if (d.viewing) d.closeView(); d.out.write = realW; }
});

test('tree selection is clamped when agents shrink', () => {
  const { d } = mkTree([node(1, 'a', 'x'), node(2, 'b', 'y'), node(3, 'c', 'z')]);
  try {
    d.openTree();
    d.viewing.sel = 2;
    d.agents = d.agents.slice(0, 1);
    d.handleKey('', { name: 'up' });
    assert.ok(d.viewing.sel >= 0 && d.viewing.sel <= 0);
    d.agents = [];
    d.handleKey('', { name: 'up' });
    assert.strictEqual(d.viewing.sel, -1);
  } finally { clearInterval(d.viewTimer); if (d.viewing) d.closeView(); }
});

test('closeView (used by confirm before prompting) clears viewing', () => {
  const { d } = mkTree([node(1, 'a', 'x')]);
  d.openTree();
  d.closeView();
  assert.strictEqual(d.viewing, null);
});
