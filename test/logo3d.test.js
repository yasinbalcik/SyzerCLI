'use strict';
process.env.FORCE_COLOR = '1';
delete process.env.NO_COLOR;
const test = require('node:test');
const assert = require('node:assert');
const { C, vlen } = require('../src/ui');
const { points } = require('../src/logo-points');
const { renderFrame, projectPoints, pickFront, LAYERS } = require('../src/logo3d');

const DOTS = /[·∙•●]/g;

test('points data sane', () => {
  assert.ok(points.length >= 900 && points.length <= 2000, 'count ' + points.length);
  const seen = new Set();
  for (const p of points) {
    assert.ok(Array.isArray(p) && p.length === 2);
    assert.ok(Math.abs(p[0]) <= 1 && Math.abs(p[1]) <= 1);
    const k = p.join(',');
    assert.ok(!seen.has(k), 'dup ' + k);
    seen.add(k);
  }
});

test('renderFrame size', () => {
  for (const [c, r] of [[60, 24], [50, 24], [200, 60]]) {
    const f = renderFrame({ t: 0, cols: c, rows: r });
    assert.strictEqual(f.length, r);
    for (const l of f) assert.ok(vlen(l) <= c);
  }
});

test('renderFrame deterministic', () => {
  const o = { cols: 60, rows: 24 };
  assert.deepStrictEqual(renderFrame({ ...o, t: 0.7 }), renderFrame({ ...o, t: 0.7 }));
  assert.notDeepStrictEqual(renderFrame({ ...o, t: 0 }), renderFrame({ ...o, t: 1.3 }));
});

test('renderFrame content', () => {
  const f = renderFrame({ t: 0, cols: 60, rows: 24, color: false }).join('\n');
  assert.ok((f.match(DOTS) || []).length >= 100);
  assert.ok(!/\x1b/.test(f));
});

test('depth colors', () => {
  const f = renderFrame({ t: 0.9, cols: 70, rows: 28 }).join('\n');
  assert.ok(f.includes(C.gray('·')), 'gray far dot');
  assert.ok(f.includes(C.orange('●')) || f.includes(C.bold(C.orange('●'))), 'orange near dot');
});

test('rotation depth ordering', () => {
  const pr = projectPoints(0.4, 60, 24);
  assert.ok(pr.length > 0 && pr.every((p) => p.z >= 0 && p.z <= 1));
  assert.strictEqual(LAYERS, 3);
  const r = pickFront([
    { cx: 5, cy: 5, z: 0.2 }, { cx: 5, cy: 5, z: 0.9 }, { cx: 5, cy: 5, z: 0.5 }, { cx: 6, cy: 5, z: 0.1 },
  ]);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r.find((p) => p.cx === 5).z, 0.9);
});

test('bad data safe', () => {
  assert.deepStrictEqual(renderFrame({ t: 1, cols: 10, rows: 3, points: [] }), ['', '', '']);
  assert.doesNotThrow(() => renderFrame({ t: 1, cols: 10, rows: 3, points: [[NaN, 1], null, 'x'] }));
  assert.strictEqual(renderFrame({ t: 1, cols: 0, rows: 0 }).length, 0);
});
