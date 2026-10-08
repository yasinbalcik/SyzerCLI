'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const patch = require('../src/orca-patch');

const CMD = '"node" "syzer.js"';

test('every edit has a group and exact from/to strings', () => {
  const list = patch.edits(CMD);
  assert.ok(list.length > 20);
  for (const e of list) {
    assert.ok(e.group, 'group');
    assert.ok(typeof e.from === 'string' && e.from.length > 0, `from: ${e.group}`);
    assert.ok(typeof e.to === 'string', `to: ${e.group}`);
    assert.ok(e.file || e.glob instanceof RegExp, `target: ${e.group}`);
  }
});

test('restore group is part of the patch (regression: 3.16.0 shipped it unapplied)', () => {
  const groups = new Set(patch.edits(CMD).map((e) => e.group));
  assert.ok(groups.has('restore'));
  assert.ok(groups.has('core'));
});

test('marker format and stability', () => {
  const m = patch.markerOf(CMD);
  assert.match(m, /^\/\*syzer-orca:\d+:[0-9a-f]{8}\*\/$/);
  assert.strictEqual(m, patch.markerOf(CMD));
  assert.notStrictEqual(m, patch.markerOf('"other"'));
});

test('marker changes when a patch source file changes (stale-patch guard)', () => {
  const f = path.join(__dirname, '..', 'src', 'orca-edits-restore.js');
  const orig = fs.readFileSync(f);
  const before = patch.markerOf(CMD);
  try {
    fs.appendFileSync(f, '\n// test\n');
    assert.notStrictEqual(patch.markerOf(CMD), before);
  } finally { fs.writeFileSync(f, orig); }
  assert.strictEqual(patch.markerOf(CMD), before);
});

test('shells group closes terminals on quit and its snippet is valid JS', () => {
  const e = patch.edits(CMD).filter((x) => x.group === 'shells');
  assert.strictEqual(e.length, 2);
  assert.ok(e.some((x) => x.to.includes('__syzerQuitDaemon(Kua()?GQt:WQt)')));
  assert.ok(!/'/.test(require('../src/orca-snippets/quit-kill').DEFS), 'no single quotes in injected text');
  new Function('I', 'ZYr', 'eH', 'u$t', `${require('../src/orca-snippets/quit-kill').DEFS};return 1`);
});
