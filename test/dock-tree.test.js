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
