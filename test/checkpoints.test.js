'use strict';
// Dosya checkpoint'leri: kayıt, /undo geri yükleme, çakışma, sınırlar (gerçek fs, geçici dizin, enjekte saat).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { create } = require('../src/checkpoints');

function setup(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-cp-'));
  const clock = { t: 1000 };
  const store = create({ dir: path.join(root, 'cp'), now: () => clock.t, ...opts });
  const f = (n) => path.join(root, n);
  // Syzer'in write_file davranışı: önce record, sonra yaz, sonra wrote
  const write = (sid, file, text) => { store.record(sid, file); fs.writeFileSync(file, text); store.wrote(sid, file); };
  return { root, store, clock, f, write };
}

test('create / modify / delete tracking: one checkpoint per turn', () => {
  const { store, f, write } = setup();
  fs.writeFileSync(f('a.txt'), 'old');
  store.beginTurn('s1', 'make changes please');
  write('s1', f('a.txt'), 'new');
  write('s1', f('a.txt'), 'newer'); // aynı turda ikinci düzenleme: ilk içerik korunur
  write('s1', f('b.txt'), 'created');
  const list = store.list('s1');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].files.length, 2);
  assert.strictEqual(list[0].files[0].existed, true);
  assert.strictEqual(list[0].files[1].existed, false);
  assert.strictEqual(list[0].prompt, 'make changes please');
});

test('turn without edits creates no checkpoint', () => {
  const { store } = setup();
  store.beginTurn('s1', 'just chatting');
  assert.deepStrictEqual(store.list('s1'), []);
});

test('undo restores modified file and removes created one, then drops checkpoint', () => {
  const { store, f, write } = setup();
  fs.writeFileSync(f('a.txt'), 'old');
  store.beginTurn('s1', 'p');
  write('s1', f('a.txt'), 'new');
  write('s1', f('b.txt'), 'created');
  const r = store.undo('s1');
  assert.strictEqual(r.turns, 1);
  assert.deepStrictEqual(r.restored, [f('a.txt')]);
  assert.deepStrictEqual(r.removed, [f('b.txt')]);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'old');
  assert.ok(!fs.existsSync(f('b.txt')));
  assert.strictEqual(store.list('s1').length, 0);
  assert.strictEqual(store.undo('s1').turns, 0);
});

test('undo N goes back several turns in reverse order', () => {
  const { store, f, write } = setup();
  fs.writeFileSync(f('a.txt'), 'v0');
  for (const [i, v] of ['v1', 'v2', 'v3'].entries()) { store.beginTurn('s1', `turn ${i}`); write('s1', f('a.txt'), v); }
  assert.strictEqual(store.list('s1').length, 3);
  const r = store.undo('s1', 2);
  assert.strictEqual(r.turns, 2);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'v1');
  assert.strictEqual(store.list('s1').length, 1);
});

test('external change is a conflict: untouched without force, overwritten with force', () => {
  const { store, f, write } = setup();
  fs.writeFileSync(f('a.txt'), 'old');
  store.beginTurn('s1', 'p');
  write('s1', f('a.txt'), 'by syzer');
  fs.writeFileSync(f('a.txt'), 'by user');
  const r = store.undo('s1');
  assert.strictEqual(r.turns, 0);
  assert.deepStrictEqual(r.conflicts, [f('a.txt')]);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'by user');
  assert.strictEqual(store.list('s1').length, 1);
  const r2 = store.undo('s1', 1, { force: true });
  assert.strictEqual(r2.turns, 1);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'old');
});

test('file deleted by someone else after Syzer created it is a conflict', () => {
  const { store, f, write } = setup();
  store.beginTurn('s1', 'p');
  write('s1', f('n.txt'), 'x');
  fs.rmSync(f('n.txt'));
  assert.strictEqual(store.undo('s1').conflicts.length, 1);
});

test('cap: only the last N checkpoints are kept and old blobs are removed', () => {
  const { store, f, write, root } = setup({ maxKeep: 3 });
  fs.writeFileSync(f('a.txt'), 'v0');
  for (let i = 1; i <= 5; i++) { store.beginTurn('s1', `t${i}`); write('s1', f('a.txt'), `v${i}`); }
  const list = store.list('s1');
  assert.deepStrictEqual(list.map((c) => c.turn), [3, 4, 5]);
  const sdir = path.join(root, 'cp', 's1');
  assert.ok(!fs.existsSync(path.join(sdir, '1')));
  assert.ok(fs.existsSync(path.join(sdir, '5')));
});

test('files over the size limit are skipped, not restored, and reported', () => {
  const { store, f, write } = setup({ maxFile: 10 });
  fs.writeFileSync(f('big.bin'), 'x'.repeat(50));
  store.beginTurn('s1', 'p');
  write('s1', f('big.bin'), 'small');
  const cp = store.list('s1')[0];
  assert.strictEqual(cp.files[0].skipped, 'too large');
  const r = store.undo('s1');
  assert.deepStrictEqual(r.restored, []);
  assert.strictEqual(r.skipped[0].why, 'too large');
  assert.strictEqual(fs.readFileSync(f('big.bin'), 'utf8'), 'small');
});

test('subagent edits share the parent session id and land in the same checkpoint', () => {
  const { store, f, write } = setup();
  store.beginTurn('s1', 'p');
  write('s1', f('a.txt'), '1'); // ana ajan
  write('s1', f('b.txt'), '2'); // alt ajan (aynı sessionId)
  assert.strictEqual(store.list('s1').length, 1);
  assert.strictEqual(store.list('s1')[0].files.length, 2);
});

test('sessions are isolated from each other', () => {
  const { store, f, write } = setup();
  store.beginTurn('s1', 'p'); write('s1', f('a.txt'), '1');
  store.beginTurn('s2', 'p'); write('s2', f('b.txt'), '2');
  store.undo('s1');
  assert.strictEqual(store.list('s2').length, 1);
  assert.ok(fs.existsSync(f('b.txt')));
});
