'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Scrollback } = require('../src/scrollback');
const { reportHits, reportLines } = require('../src/agent-tree');
require('../src/i18n').setLang('en');

const node = (id) => ({ id, kind: 'explore', label: 'x', status: 'done', steps: 1, tokens: 5, t0: Date.now() - 1000, t1: Date.now() });
const snap = { main: { model: 'm', effort: 'auto' }, log: [], nodes: [node(7), node(8)] };

function mkSb() {
  const out = { columns: 100, write() {} };
  return new Scrollback({ out, region: () => ({ top: 5, bottom: 24 }) });
}

test('reportHits: iki kart yan yana, ana kutudan sonra başlar', () => {
  const h = reportHits(snap, { width: 98 });
  assert.strictEqual(h.length, 2);
  assert.deepStrictEqual(h.map((x) => x.id), [7, 8]);
  assert.strictEqual(h[0].row, 3);
  assert.ok(h[0].c2 < h[1].c1);
});

test('reportHits: reportLines satır sayısıyla uyumlu', () => {
  const lines = reportLines(snap, { isTTY: true, columns: 100 });
  const h = reportHits(snap, { width: 98 });
  assert.ok(h[0].row + h[0].rows <= lines.length);
});

test('scrollback.hitAt: tıklanan ekran satırı/sütunu doğru karta eşlenir', () => {
  const sb = mkSb();
  for (let i = 0; i < 40; i++) sb.feed(`satir ${i}\n`);
  const start = sb.nextLine();
  sb.regions.push({ line: start, hits: reportHits(snap, { width: 98 }) });
  reportLines(snap, { isTTY: true, columns: 100 }).forEach((l) => sb.feed(l + '\n'));
  const total = sb.allRows().length; // son satır boş imleç satırı
  // canlı görünümde son satır = bölgenin altı (24); rapor son satırı bir üstte
  const lastRowOfReport = 24 - 1;
  const reportLen = reportLines(snap, { isTTY: true, columns: 100 }).length;
  const firstReportRow = lastRowOfReport - reportLen + 1;
  const y = firstReportRow + 3 + 1; // ilk kartın ikinci satırı
  const h = reportHits(snap, { width: 98 });
  assert.strictEqual(sb.hitAt(h[0].c1 + 2, y), 7);
  assert.strictEqual(sb.hitAt(h[1].c1 + 2, y), 8);
  assert.strictEqual(sb.hitAt(1, firstReportRow), null); // ana kutu
  assert.ok(total > 40);
});

test('scrollback: üstten atılan satırlar mutlak numarayı bozmaz', () => {
  const sb = mkSb();
  for (let i = 0; i < 4100; i++) sb.feed('x\n');
  assert.ok(sb.trimmed > 0);
  assert.strictEqual(sb.nextLine(), 4100);
});
