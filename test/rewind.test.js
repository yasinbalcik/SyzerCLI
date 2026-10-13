'use strict';
// /rewind: tur işaretleri, sohbet kesme, dosya geri alma, çatışma, geçersiz işaret, meşgul oturum.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-rw-'));
process.env.SYZER_HOME = root;
const { create } = require('../src/checkpoints');
const rw = require('../src/rewind');
const ext = require('../src/ext/rewind');

function setup() {
  const dir = fs.mkdtempSync(path.join(root, 't-'));
  const store = create({ dir: path.join(dir, 'cp') });
  const session = { sessionId: 's1', cwd: dir, busy: false, messages: [{ role: 'system', content: 'sys' }] };
  const deps = { checkpoints: store, save: () => { session.saved = (session.saved || 0) + 1; } };
  const f = (n) => path.join(dir, n);
  // runTurn'ün yaptığı: işaret → beginTurn → (dosya yazımı) → asistan yanıtı
  const turn = (prompt, edits = {}) => {
    const startLen = session.messages.length;
    session.messages.push({ role: 'user', content: prompt });
    rw.mark(session, startLen, prompt, deps);
    store.beginTurn(session.sessionId, prompt);
    for (const [name, text] of Object.entries(edits)) {
      store.record(session.sessionId, f(name)); fs.writeFileSync(f(name), text); store.wrote(session.sessionId, f(name));
    }
    session.messages.push({ role: 'assistant', content: 'done ' + prompt });
  };
  return { session, store, deps, f, turn };
}

test('marks: one per turn, sequential, aligned with checkpoint numbers', () => {
  const { session, turn, store } = setup();
  turn('first');
  turn('second', { 'a.txt': 'x' });
  turn('third', { 'b.txt': 'y' });
  const m = rw.marks(session);
  assert.deepStrictEqual(m.map((x) => x.turn), [1, 2, 3]);
  assert.deepStrictEqual(m.map((x) => x.startLen), [1, 3, 5]);
  assert.strictEqual(m[1].cp, 1);
  assert.strictEqual(m[2].cp, 2);
  assert.strictEqual(store.list('s1')[0].turn, m[1].cp);
  assert.strictEqual(JSON.stringify(m).includes('userRef'), false);
});

test('chat rewind truncates messages from the chosen turn and drops later marks', () => {
  const { session, turn, deps } = setup();
  turn('one'); turn('two'); turn('three');
  const r = rw.rewind(session, 2, { files: false }, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.chatTurnsRemoved, 2);
  assert.strictEqual(session.messages.length, 3);
  assert.deepStrictEqual(rw.marks(session).map((x) => x.turn), [1]);
  assert.ok(session.saved >= 1);
});

test('files rewind restores and deletes from that turn onward, keeps chat with files-only', () => {
  const { session, turn, deps, f } = setup();
  fs.writeFileSync(f('a.txt'), 'orig');
  turn('t1', { 'a.txt': 'v1' });
  turn('t2', { 'a.txt': 'v2', 'new.txt': 'n' });
  const len = session.messages.length;
  const r = rw.rewind(session, 2, { chat: false }, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.chatTurnsRemoved, 0);
  assert.strictEqual(session.messages.length, len);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'v1');
  assert.strictEqual(fs.existsSync(f('new.txt')), false);
  assert.strictEqual(r.files.restored.length, 2);
});

test('both: rewind to turn 1 restores original files and truncates chat', () => {
  const { session, turn, deps, f } = setup();
  fs.writeFileSync(f('a.txt'), 'orig');
  turn('t1', { 'a.txt': 'v1' });
  turn('t2', { 'a.txt': 'v2' });
  const r = rw.rewind(session, 1, {}, deps);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'orig');
  assert.strictEqual(session.messages.length, 1);
  assert.strictEqual(r.chatTurnsRemoved, 2);
});

test('conflict: user edit is reported, chat untouched; force overwrites', () => {
  const { session, turn, deps, f } = setup();
  fs.writeFileSync(f('a.txt'), 'orig');
  turn('t1', { 'a.txt': 'v1' });
  fs.writeFileSync(f('a.txt'), 'hand edit');
  const len = session.messages.length;
  const r = rw.rewind(session, 1, {}, deps);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.files.conflicts, [f('a.txt')]);
  assert.strictEqual(session.messages.length, len);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'hand edit');
  const r2 = rw.rewind(session, 1, { force: true }, deps);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'orig');
  assert.strictEqual(session.messages.length, 1);
});

test('invalid marks after compaction are refused', () => {
  const { session, turn, deps } = setup();
  turn('one'); turn('two');
  // compact.js messages dizisini yerinde yeniden kurar
  session.messages.splice(0, session.messages.length, { role: 'system', content: 'sys' }, { role: 'user', content: '[summary]' }, { role: 'assistant', content: 'ok' });
  const r = rw.rewind(session, 1, {}, deps);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /not found or no longer valid/);
  assert.strictEqual(session.messages.length, 3);
  assert.deepStrictEqual(rw.marks(session), []);
});

test('unknown turn and busy session are refused without side effects', () => {
  const { session, turn, deps } = setup();
  turn('one');
  assert.strictEqual(rw.rewind(session, 99, {}, deps).ok, false);
  session.busy = true;
  const len = session.messages.length;
  const r = rw.rewind(session, 1, {}, deps);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /busy/);
  assert.strictEqual(session.messages.length, len);
});

test('/rewind command: list, confirm, cancel, --chat only', async () => {
  const { session, turn, f } = setup();
  fs.writeFileSync(f('a.txt'), 'orig');
  // komut gerçek paylaşılan checkpoint deposunu kullanır → onunla aynı oturum kimliği
  session.sessionId = 'rwcmd-' + process.pid;
  const real = require('../src/checkpoints').store();
  const startLen = session.messages.length;
  session.messages.push({ role: 'user', content: 'edit a' });
  rw.mark(session, startLen, 'edit a');
  real.beginTurn(session.sessionId, 'edit a');
  real.record(session.sessionId, f('a.txt')); fs.writeFileSync(f('a.txt'), 'v1'); real.wrote(session.sessionId, f('a.txt'));
  session.messages.push({ role: 'assistant', content: 'ok' });
  void turn;
  const lines = [];
  const ctx = (key) => ({ session, out: (l) => lines.push(l), readKey: async () => key });
  const listing = await ext.commands.rewind.run('', ctx('n'));
  assert.match(listing, /#1 .*edit a.*\[1 file\]/);
  assert.strictEqual(await ext.commands.rewind.run('1', ctx('n')), 'Cancelled.');
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'v1');
  const out = await ext.commands.rewind.run('1 --chat', ctx('y'));
  assert.match(out, /1 turn\(s\) removed from conversation, 0 file\(s\) restored/);
  assert.strictEqual(fs.readFileSync(f('a.txt'), 'utf8'), 'v1');
  assert.strictEqual(session.messages.length, 1);
});
