const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const sl = require('../src/statusline');

const node = JSON.stringify(process.execPath);
const cmd = (js) => `${node} -e ${JSON.stringify(js)}`;
const session = (command, extra = {}) => ({
  model: 'm/x', cwd: process.cwd(), sessionId: 's1', messages: [{ role: 'system', content: 'hi' }],
  cfg: { verify: false }, settings: { statusLine: command === null ? undefined : { command, timeoutMs: 3000 } }, ...extra,
});

test('statusline: no config renders nothing', async () => {
  sl.clearCache();
  assert.equal(await sl.render(session(null)), '');
  assert.equal(sl.config({}), null);
  assert.equal(sl.config({ statusLine: { command: '  ' } }), null);
  assert.deepEqual(sl.config({ statusLine: 'echo hi' }), { command: 'echo hi', timeoutMs: 1500 });
});

test('statusline: passes JSON on stdin and returns only the first line', async () => {
  sl.clearCache();
  const js = "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.model+'|'+j.sessionId+'|'+typeof j.budget+'|'+j.verify);console.log('second')})";
  assert.equal(await sl.render(session(cmd(js))), 'm/x|s1|object|false');
});

test('statusline: failure, non-zero exit and timeout are ignored silently', async () => {
  sl.clearCache();
  assert.equal(await sl.render(session('definitely-not-a-command-xyz')), '');
  assert.equal(await sl.render(session(cmd('console.log("x");process.exit(3)'))), '');
  const slow = session(cmd('setTimeout(()=>console.log("late"),5000)'));
  slow.settings.statusLine.timeoutMs = 200;
  const t0 = Date.now();
  assert.equal(await sl.render(slow), '');
  assert.ok(Date.now() - t0 < 2500);
});

test('statusline: short cache avoids re-running the command', async () => {
  sl.clearCache();
  let calls = 0;
  const fake = () => {
    calls++;
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stdin = { on() {}, end() {} };
    c.kill = () => {};
    setImmediate(() => { c.stdout.emit('data', 'ok\n'); c.emit('close', 0); });
    return c;
  };
  const s = session('fake');
  assert.equal(await sl.render(s, { spawn: fake, now: () => 1000 }), 'ok');
  assert.equal(await sl.render(s, { spawn: fake, now: () => 1500 }), 'ok');
  assert.equal(calls, 1);
  assert.equal(await sl.render(s, { spawn: fake, now: () => 9000 }), 'ok');
  assert.equal(calls, 2);
});

test('statusline: firstLine strips control sequences and caps length', () => {
  assert.equal(sl.firstLine('\n\x1b[2Jhello\x07\nworld'), 'hello');
  assert.equal(sl.firstLine('\x1b[32mgreen\x1b[0m'), '\x1b[32mgreen\x1b[0m');
  assert.equal(sl.firstLine('x'.repeat(1000)).length, 300);
});

test('statusline: payload includes budget and token fields', () => {
  const B = require('../src/budget');
  const s = session('x');
  s.budget = B.createTracker({ tokens: 1000, turns: null, minutes: null });
  s.budget.addTokens(250);
  const p = sl.payload(s);
  assert.equal(p.tokens, 250);
  assert.equal(p.budget.limits.tokens, 1000);
  assert.equal(p.budget.active, true);
  assert.equal(p.verify, false);
});
