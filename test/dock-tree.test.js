'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.FORCE_COLOR = '1'; delete process.env.NO_COLOR; // colors on before ui.js loads (selection test)
const { Dock } = require('../src/dock');
require('../src/i18n').setLang('en');

function mk(getTree) {
  let buf = '';
  const out = { isTTY: true, columns: 100, rows: 24, write(s) { buf += s; } };
  const input = { on() {}, off() {}, removeListener() {}, setRawMode() {}, resume() {}, pause() {} };
  const d = new Dock({ editor: { items: [], cur: 0 }, input, out });
  d.active = true; d.rows = 24; // < 28 rows: compact path (panel mode tests use mkPanel)
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
    assert.ok(typeof process.stderr.write === "function" && !String(process.stderr.write).includes("_buf"));
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

// ---- panel mode ----
const { panelHeight } = require('../src/agent-tree');
function mkPanel(n, rows, columns = 100, q = 0) {
  const nodes = [];
  for (let i = 1; i <= n; i++) nodes.push(node(i, 'kind' + i, 'lab' + i));
  const r = mk(() => ({ main: { model: 'mainmodel', effort: 'e' }, log: [], nodes }));
  r.d.out.rows = rows; r.d.out.columns = columns; r.d.rows = rows;
  r.d.agents = nodes.map((x) => ({ id: x.id, no: x.id, kind: x.kind, label: 'l', t0: Date.now(), steps: 0, tokens: 0 }));
  for (let i = 0; i < q; i++) r.d.queue.push({ text: 'q' });
  r.d.h = r.d.need();
  return r;
}

test('panel mode threshold', () => {
  assert.strictEqual(mkPanel(1, 27).d.panelMode(), false);
  assert.strictEqual(mkPanel(1, 28, 69).d.panelMode(), false);
  assert.strictEqual(mkPanel(1, 28, 70).d.panelMode(), true);
  const e = mkPanel(1, 30); e.d.agents = [];
  assert.strictEqual(e.d.panelMode(), false);
});

test('need uses panelHeight in panel mode, old formula outside', () => {
  const a = mkPanel(3, 30);
  assert.strictEqual(panelHeight(3, 30), 9);
  assert.strictEqual(a.d.need(), 4 + 9);
  const b = mkPanel(7, 36);
  assert.strictEqual(panelHeight(7, 36), 16);
  assert.strictEqual(b.d.need(), 4 + 16);
  assert.strictEqual(mkPanel(3, 30, 100, 1).d.need(), 4 + 1 + 9);
  assert.strictEqual(mkPanel(3, 27).d.need(), 4 + 1 + 3 + 1);
});

test('draw panel shows box and model, no tree glyphs; rows 27 keeps tree', () => {
  const p = mkPanel(2, 30);
  p.d.draw();
  assert.match(p.get(), /╭/);
  assert.match(p.get(), /mainmodel/);
  assert.doesNotMatch(p.get(), /[├└]/);
  const c = mkPanel(2, 27);
  c.d.draw();
  assert.match(c.get(), /[├└]/);
});

test('draw panel fills exactly this.h lines and cuts nothing', () => {
  for (const [n, rows] of [[3, 30], [7, 36], [9, 30]]) {
    const p = mkPanel(n, rows, 100, 1);
    p.d.draw();
    const drawn = p.get().split('\x1b[2K').length - 1;
    assert.strictEqual(drawn, p.d.h);
    assert.strictEqual(p.d.h, p.d.need());
    const txt = strip(p.get());
    const bottoms = (txt.match(/╰/g) || []).length;
    const tops = (txt.match(/╭/g) || []).length;
    assert.strictEqual(tops, bottoms);
  }
});

test('draw panel highlights the selected card edge only', () => {
  const orange = '[38;5;208m';
  // son kart satırındaki her kartın kenar rengi: '╭' öncesindeki renk koduna bakar
  const edges = (buf) => {
    const row = buf.split('[2K').filter((l) => /╭/.test(strip(l))).pop();
    return row.split('╭').slice(0, -1).map((x) => x.endsWith(orange));
  };
  const p = mkPanel(3, 30);
  p.d.sel = 2;
  p.d.draw();
  assert.deepStrictEqual(edges(p.get()), [false, true, false]);
  const q = mkPanel(3, 30); q.d.sel = 0; q.d.draw();
  assert.deepStrictEqual(edges(q.get()), [false, false, false]);
});

test('panel mode falls back when getTree throws or an agent has no node', () => {
  const p = mkPanel(2, 30);
  p.d.getTree = () => { throw new Error('x'); };
  assert.doesNotThrow(() => p.d.draw());
  assert.doesNotMatch(p.get(), /╭/);
  assert.match(p.get(), /○/);
  const q = mkPanel(2, 30);
  q.d.getTree = () => ({ main: {}, log: [], nodes: [node(1, 'kind1', 'a')] });
  q.d.draw();
  assert.doesNotMatch(q.get(), /╭/);
});

// ---- fix wave: finished cards stay, flip via setAgents, status label ----
const stNode = (id, status) => ({ id, kind: 'kind' + id, label: 'lab' + id, status, steps: 1, tokens: 0, t0: Date.now(), t1: status === 'running' ? 0 : Date.now(), model: '' });
function mkMixed(rows = 30) {
  const nodes = [stNode(1, 'done'), stNode(2, 'stopped'), stNode(3, 'running')];
  const r = mk(() => ({ main: { model: 'mainmodel', effort: 'e' }, log: [], nodes }));
  r.d.out.rows = rows; r.d.out.columns = 100; r.d.rows = rows;
  r.d.agents = [{ id: 3, no: 3, kind: 'kind3', label: 'l', t0: Date.now(), steps: 0, tokens: 0 }];
  r.d.h = r.d.need();
  return r;
}

test('panel keeps finished cards: 3 cards, 1 running, 2 done header', () => {
  const p = mkMixed();
  assert.strictEqual(p.d.need(), 4 + panelHeight(3, 30));
  p.d.draw();
  const txt = strip(p.get());
  assert.strictEqual((txt.match(/╭/g) || []).length, 4); // main box + 3 cards
  assert.match(txt, /1 running/);
  assert.match(txt, /1 done/);
  assert.match(txt, /✓ kind1/);
  assert.match(txt, /⚠ kind2/);
});

test('panel selected card follows sel among all nodes', () => {
  const p = mkMixed();
  p.d.sel = 1;
  p.d.draw();
  const orange = '\x1b[38;5;208m';
  const row = p.get().split('\x1b[2K').filter((l) => /╭/.test(strip(l))).pop();
  const parts = row.split('╭').slice(1);
  assert.strictEqual(parts.length, 3);
  const before = row.split('╭');
  assert.ok(before[2].endsWith(orange)); // third card edge is orange
  assert.ok(!before[0].endsWith(orange) && !before[1].endsWith(orange));
});

test('panel falls back when a dock agent has no store node (finished nodes present)', () => {
  const p = mkMixed();
  p.d.agents.push({ id: 99, no: 9, kind: 'ghost', label: 'l', t0: Date.now(), steps: 0, tokens: 0 });
  p.d.draw();
  assert.doesNotMatch(p.get(), /╭/);
});

test('need falls back to agents.length when getTree throws', () => {
  const p = mkMixed();
  p.d.getTree = () => { throw new Error('x'); };
  assert.strictEqual(p.d.need(), 4 + panelHeight(1, 30));
  assert.doesNotThrow(() => p.d.draw());
});

test('setAgents flip: 0 agents -> panel grows to need() and draw fills h lines', async () => {
  const nodes = [node(1, 'kind1', 'a'), node(2, 'kind2', 'b'), node(3, 'kind3', 'c')];
  const r = mk(() => ({ main: { model: 'mainmodel', effort: 'e' }, log: [], nodes }));
  const d = r.d;
  d.out.rows = 30; d.out.columns = 100; d.rows = 30;
  d.agents = []; d.h = d.need();
  assert.strictEqual(d.h, 4);
  d.cursorPos = async () => ({ row: 5, col: 1 });
  d.editor.mode = 'line';
  d.setAgents(nodes.map((x) => ({ id: x.id, no: x.id, kind: x.kind, label: 'l', t0: Date.now(), steps: 0, tokens: 0 })));
  await new Promise((res) => setTimeout(res, 20));
  assert.strictEqual(d.h, 4 + panelHeight(3, 30));
  assert.strictEqual(d.h, d.need());
  const mark = r.get().length;
  d.draw();
  const fresh = r.get().slice(mark);
  assert.strictEqual(fresh.split('\x1b[2K').length - 1, d.h);
  const txt = strip(fresh);
  assert.strictEqual((txt.match(/╭/g) || []).length, (txt.match(/╰/g) || []).length);
  assert.strictEqual((txt.match(/╭/g) || []).length, 4);
});

test('setStatusLabel keeps the elapsed start', () => {
  const { d } = mk(() => ({ main: {}, log: [], nodes: [] }));
  d.setStatus('a');
  const start = d.status.start - 5000;
  d.status.start = start;
  d.setStatusLabel('b');
  assert.strictEqual(d.status.label, 'b');
  assert.strictEqual(d.status.start, start);
  d.setStatus(null);
  d.setStatusLabel('c');
  assert.strictEqual(d.status, null); // no status running -> not resurrected
});

// ---- final fix wave: layout rows, running first, count path ----
const cardTops = (buf) => (strip(buf).match(/╭/g) || []).length - 1; // minus main box
const cardBots = (buf) => (strip(buf).match(/╰/g) || []).length - 1;
test('draw: 36 rows with 7 nodes draws 6 cards and +1; 28 rows draws 3 and +4', () => {
  const a = mkPanel(7, 36, 100, 1); a.d.draw();
  assert.strictEqual(cardTops(a.get()), 6);
  assert.strictEqual(cardBots(a.get()), 6);
  assert.match(strip(a.get()), /\+1/);
  assert.strictEqual(a.get().split('\x1b[2K').length - 1, a.d.h);
  const b = mkPanel(7, 28, 100, 1); b.d.draw();
  assert.strictEqual(cardTops(b.get()), 3);
  assert.strictEqual(cardBots(b.get()), 3);
  assert.match(strip(b.get()), /\+4/);
});

test('draw: running card is shown and selectable behind finished ones', () => {
  const nodes = [stNode(1, 'done'), stNode(2, 'done'), stNode(3, 'done'), stNode(4, 'running')];
  const r = mk(() => ({ main: { model: 'mainmodel', effort: 'e' }, log: [], nodes }));
  r.d.out.rows = 28; r.d.out.columns = 100; r.d.rows = 28;
  r.d.agents = [{ id: 4, no: 4, kind: 'kind4', label: 'l', t0: Date.now(), steps: 0, tokens: 0 }];
  r.d.h = r.d.need(); r.d.sel = 1; r.d.draw();
  const txt = strip(r.get());
  assert.match(txt, /● kind4/);
  assert.match(txt, /\+1/);
  assert.strictEqual(cardTops(r.get()), 3);
  const orange = '\x1b[38;5;208m';
  const row = r.get().split('\x1b[2K').filter((l) => /╭/.test(strip(l))).pop();
  const parts = row.split('╭');
  assert.strictEqual(parts.length, 4);
  assert.ok(parts[2].endsWith(orange)); // 3rd shown = running
  assert.ok(!parts[0].endsWith(orange) && !parts[1].endsWith(orange));
});

test('need uses getTreeCount without a full snapshot', () => {
  const p = mkPanel(3, 30);
  let snaps = 0;
  p.d.getTree = () => { snaps++; return { main: {}, log: [], nodes: [] }; };
  p.d.getTreeCount = () => 7;
  assert.strictEqual(p.d.need(), 4 + panelHeight(7, 30));
  assert.strictEqual(snaps, 0);
});

test('dock.relayout: boyut değişince satır sayısı ve kaydırma bölgesi yenilenir, kutu yeni alt satıra çizilir', () => {
  const { d, get } = mk(() => ({ main: {}, log: [], nodes: [] }));
  d.out.rows = 40; // terminal büyüdü
  d.relayout();
  assert.strictEqual(d.rows, 40);
  assert.ok(get().includes("[" + d.top + ";" + (40 - d.h) + "r"));
  const before = get().length;
  d.draw();
  const drawn = get().slice(before);
  assert.ok(drawn.includes("[" + (40 - d.h + 1) + ";1H")); // ilk dock satırı yeni tabanda
  assert.doesNotMatch(drawn, /\x1b\[2[0-4];1H/); // eski (24 satırlık) konuma yazmaz
});

test('dock.click: turda biten (agents listesinden çıkmış) ajanın kartı da görünümü açar', () => {
  const { d } = mk(() => ({ main: {}, log: [], nodes: [] }));
  d.agents = [];
  d.hits = [{ id: 5, row: 10, rows: 6, c1: 1, c2: 40 }];
  d.getRun = (id) => (id === 5 ? { id: 5, agent: 'explore', steps: [], report: 'r' } : null);
  let opened = null;
  d.openView = (a) => { opened = a; };
  assert.strictEqual(d.click(12, 5), true);
  assert.deepStrictEqual(opened, { id: 5 });
  d.getRun = () => null; opened = null;
  assert.strictEqual(d.click(12, 5), false); // kaydı olmayan kart açılmaz
});

test('dock.closeView: onViewClosed varsa tam yeniden çizim çağrılır', () => {
  const { d } = mk(() => ({ main: {}, log: [], nodes: [] }));
  d.viewing = { kind: 'agent', id: 1, scroll: 0 };
  d._origOut = (s) => s; d._origErr = process.stderr.write; d._buf = [];
  let n = 0; d.onViewClosed = () => { n++; };
  d.closeView();
  assert.strictEqual(n, 1);
  assert.strictEqual(d.viewing, null);
});

test('dock.shrink: ajanlar bitince dock floor yüksekliğine iner, boşalan satırlar temizlenir, bölge genişler', () => {
  const { d, get } = mk(() => ({ main: {}, log: [], nodes: [] }));
  d.floor = 5; d.top = 7;
  d.agents = [1, 2, 3].map((n) => ({ id: n, no: n, kind: 'explore', label: 'x', t0: Date.now(), steps: 0, tokens: 0 }));
  d.h = d.need();
  assert.ok(d.h > 5);
  const oldH = d.h;
  d.setAgents([]);
  assert.strictEqual(d.h, 5);
  const out = get();
  assert.ok(out.includes(`\x1b[${7};${24 - 5}r`)); // yeni kaydırma bölgesi
  assert.ok(out.includes(`\x1b[${24 - oldH + 1};1H\x1b[2K`)); // eski dock'un ilk satırı temizlendi
  const before = out.length;
  d.draw();
  assert.ok(get().slice(before).includes(`\x1b[${24 - 5 + 1};1H`)); // dock yeni tabandan çizilir
});
