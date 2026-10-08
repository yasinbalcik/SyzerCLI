'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const splash = require('../src/splash');
const { Editor } = require('../src/input');

const mkOut = (o = {}) => {
  const out = new EventEmitter();
  Object.assign(out, { isTTY: true, rows: 30, columns: 80, buf: '', write(s) { this.buf += s; return true; } }, o);
  return out;
};
const mkIn = (o = {}) => Object.assign(new EventEmitter(), { isTTY: true }, o);
const count = (s, sub) => s.split(sub).length - 1;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = { env: {}, out: mkOut(), input: mkIn(), session: { messages: [1] } };

test('eligibleAtStart matrix', () => {
  assert.strictEqual(splash.eligibleAtStart(ok), true);
  const bad = [
    { out: mkOut({ isTTY: false }) }, { input: mkIn({ isTTY: false }) },
    { out: mkOut({ rows: 23 }) }, { out: mkOut({ columns: 49 }) },
    { env: { SYZER_NO_LOGO: '1' } }, { env: { NO_COLOR: '1' } }, { env: { ORCA_AGENT_LAUNCH_TOKEN: 'x' } },
    { session: { messages: [1, 2, 3] } },
  ];
  for (const b of bad) assert.strictEqual(splash.eligibleAtStart({ ...ok, ...b }), false, JSON.stringify(Object.keys(b)));
});

test('show closes on first key', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200 });
  input.emit('keypress', 'a', { name: 'a' });
  assert.deepStrictEqual(await p, { exit: false, keys: [{ str: 'a', key: { name: 'a' } }] });
  assert.strictEqual(count(out.buf, '\x1b[?1049h'), 1);
  assert.strictEqual(count(out.buf, '\x1b[?1049l'), 1);
  assert.ok(out.buf.includes('\x1b[?25h'));
  assert.strictEqual(input.listenerCount('keypress'), 0);
  assert.strictEqual(out.listenerCount('resize'), 0);
});

test('burst keys kept in order', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200 });
  input.emit('keypress', 'a', { name: 'a' });
  input.emit('keypress', 'b', { name: 'b' });
  input.emit('keypress', '\r', { name: 'return' });
  assert.deepStrictEqual((await p).keys.map((k) => k.str), ['a', 'b', '\r']);
});

test('ctrl c / ctrl d exit', async () => {
  for (const name of ['c', 'd']) {
    const out = mkOut(); const input = mkIn();
    const p = splash.show({ out, input, fps: 200 });
    input.emit('keypress', '\x03', { name, ctrl: true });
    assert.deepStrictEqual(await p, { exit: true, keys: [] });
    assert.strictEqual(count(out.buf, '\x1b[?1049l'), 1);
  }
});

test('swallowKey', async () => {
  let out = mkOut(); let input = mkIn();
  let p = splash.show({ out, input, fps: 200, swallowKey: true });
  input.emit('keypress', 'x', { name: 'x' });
  assert.deepStrictEqual(await p, { exit: false, keys: [] });
  out = mkOut(); input = mkIn();
  p = splash.show({ out, input, fps: 200, swallowKey: true });
  input.emit('keypress', '\x03', { name: 'c', ctrl: true });
  assert.deepStrictEqual(await p, { exit: false, keys: [] });
});

test('draws frames', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200, hint: 'merhaba-hint', title: 'Baslik' });
  await wait(100);
  input.emit('keypress', 'a', { name: 'a' });
  await p;
  assert.ok(/[⠀-⣿•●·]/.test(out.buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')), 'logo characters');
  assert.ok(out.buf.includes('merhaba-hint'));
  assert.ok(out.buf.includes('Baslik'));
});

test('resize redraws', async () => {
  const out = mkOut(); const input = mkIn();
  let n = 0;
  const p = splash.show({ out, input, fps: 1, frame: () => { n++; return ['x']; } });
  const before = n;
  out.rows = 40;
  out.emit('resize');
  assert.ok(n > before);
  input.emit('keypress', 'a', { name: 'a' });
  await p;
});

test('show twice', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200 });
  const p2 = splash.show({ out, input, fps: 200 });
  assert.strictEqual(count(out.buf, '\x1b[?1049h'), 1);
  input.emit('keypress', 'a', { name: 'a' });
  assert.strictEqual((await p).keys.length, 1);
  await p2;
});

test('exit safety: frame throws', async () => {
  const out = mkOut(); const input = mkIn();
  const exitBefore = process.listenerCount('exit');
  const r = await splash.show({ out, input, fps: 200, frame: () => { throw new Error('boom'); } });
  assert.strictEqual(r.exit, false);
  assert.strictEqual(count(out.buf, '\x1b[?1049l'), 1);
  assert.ok(out.buf.includes('\x1b[?25h'));
  assert.strictEqual(input.listenerCount('keypress'), 0);
  assert.strictEqual(process.listenerCount('exit'), exitBefore);
});

test('exit safety: write throws later', async () => {
  const out = mkOut(); const input = mkIn();
  let fail = false; const w = out.write;
  out.write = function (s) { if (fail && !s.includes('?1049l') && !s.includes('?25h')) throw new Error('EPIPE'); return w.call(this, s); };
  const before = process.listenerCount('exit');
  const p = splash.show({ out, input, fps: 200 });
  fail = true;
  await p;
  assert.strictEqual(count(out.buf, '\x1b[?1049l'), 1);
  assert.strictEqual(process.listenerCount('exit'), before);
});

test('Editor#inject', async () => {
  const input = mkIn({ isTTY: false, resume() {}, pause() {} });
  const ed = new Editor({ input, output: { isTTY: false, write() {} } });
  const p = ed.read('> ');
  ed.inject('a', { name: 'a' });
  ed.inject('b', { name: 'b' });
  ed.inject('\r', { name: 'return' });
  assert.strictEqual((await p).text, 'ab');
});

const ESCRE = /\x1b\[[0-9;?]*[A-Za-z]/g;

test('no per-frame clear; resize clears once', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200 });
  const afterEnter = out.buf.length;
  await wait(60);
  const frames = out.buf.slice(afterEnter);
  assert.ok(frames.length > 0);
  assert.ok(!frames.includes('\x1b[2J'));
  assert.ok(frames.includes('\x1b[2K'));
  const mark = out.buf.length;
  out.emit('resize');
  assert.strictEqual(count(out.buf.slice(mark, mark + 400), '\x1b[2J') >= 1, true);
  input.emit('keypress', 'a', { name: 'a' });
  await p;
});

test('width clamp', async () => {
  const out = mkOut({ columns: 50 }); const input = mkIn();
  const p = splash.show({ out, input, fps: 200, hint: 'h'.repeat(300), title: 't'.repeat(120) });
  await wait(30);
  input.emit('keypress', 'a', { name: 'a' });
  await p;
  const segs = out.buf.replace(/\x1b\[[0-9;]*H/g, '\n').split('\n');
  for (const sg of segs) {
    const clean = sg.replace(ESCRE, '');
    assert.ok([...clean].length <= 50, `too wide: ${clean.length}`);
  }
});

test('late keys window', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200 });
  input.emit('keypress', 'a', { name: 'a' });
  setTimeout(() => input.emit('keypress', 'b', { name: 'b' }), 10);
  setTimeout(() => input.emit('keypress', 'c', { name: 'c' }), 25);
  setTimeout(() => input.emit('keypress', 'd', { name: 'd' }), 80);
  const r = await p;
  assert.deepStrictEqual(r.keys.map((k) => k.str), ['a', 'b', 'c']);
  await wait(60);
  assert.strictEqual(input.listenerCount('keypress'), 0);
});

test('paste markers passed through', async () => {
  const out = mkOut(); const input = mkIn();
  const p = splash.show({ out, input, fps: 200 });
  input.emit('keypress', undefined, { name: 'paste-start' });
  input.emit('keypress', 'hello', {});
  input.emit('keypress', undefined, { name: 'paste-end' });
  const r = await p;
  assert.deepStrictEqual(r.keys.map((k) => k.key.name || k.str), ['paste-start', 'hello', 'paste-end']);
});

test('exit safety: first write (ENTER) throws', async () => {
  const out = mkOut(); const input = mkIn();
  const w = out.write; let n = 0;
  out.write = function (s) { if (n++ === 0) throw new Error('EPIPE'); return w.call(this, s); };
  const exitBefore = process.listenerCount('exit');
  const r = await splash.show({ out, input, fps: 200 });
  assert.strictEqual(r.exit, false);
  assert.ok(count(out.buf, '\x1b[?1049l') <= 1);
  assert.strictEqual(input.listenerCount('keypress'), 0);
  assert.strictEqual(out.listenerCount('resize'), 0);
  assert.strictEqual(process.listenerCount('exit'), exitBefore);
});
