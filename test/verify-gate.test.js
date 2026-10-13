'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Config/oturum dosyaları geçici klasöre; modül yüklenmeden önce ayarlanmalı
process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-vg-home-'));
delete process.env.SYZER_VERIFY;
delete process.env.SYZER_VERIFY_ACTIVE;
delete process.env.SYZER_SCAFFOLD;

// Ağ ve gerçek anahtar yok: model çağrısı betikle sürülür (agent.js yüklenmeden önce kancalanır)
const api = require('../src/api');
const keys = require('../src/keys');
const models = require('../src/models');
let script = [];
let calls = 0;
api.chatStream = async () => { calls++; const r = script.shift(); if (!r) throw new Error('script exhausted'); return { usage: { total_tokens: 1 }, ...r }; };
keys.withRotation = async (cfg, fn) => ({ result: await fn({ key: 'k' }), index: 0 });
models.supportsReasoning = async () => null;
const { runTurn } = require('../src/agent');
require('../src/i18n').setLang('en');
const V = require('../src/verify');
const P = require('../src/prompts');

const tmp = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-vg-'));
  for (const [n, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, n)), { recursive: true }); fs.writeFileSync(path.join(d, n), c); }
  return d;
};
const CHECK = "const fs=require('fs');const s=fs.existsSync('impl.js')?fs.readFileSync('impl.js','utf8').trim():'';if(s==='ok'){console.log('all good');process.exit(0)}console.error('FAIL: impl.js is '+JSON.stringify(s));process.exit(1);";
const write = (id, content) => ({ content: '', toolCalls: [{ id, name: 'write_file', arguments: JSON.stringify({ path: 'impl.js', content }) }] });
const say = (content) => ({ content, toolCalls: [] });

function session(cwd, over = {}) {
  const events = { warn: [], tool: [] };
  const out = {
    waiting() {}, thinking() {}, text() {}, endText() {}, toolResult() {},
    tool: (n, s) => events.tool.push([n, s]), warn: (m) => events.warn.push(m),
  };
  const s = {
    cfg: { verify: { command: 'node check.js' }, budget: {}, ...(over.cfg || {}) },
    model: 'vendor/strong-model', effort: 'auto', perm: 'auto', plan: false, useTools: true, canSpawn: false,
    cwd, sessionId: `vg-${Math.random().toString(36).slice(2)}`, todos: [], bg: new Map(), checkpoints: [], cpDone: true, noAutoCompact: true,
    settings: { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [] } },
    messages: [{ role: 'system', content: 'SYS' }], out, confirm: async () => 'yes',
    ...over.session,
  };
  return { s, events };
}
const userMsgs = (s) => s.messages.filter((m) => m.role === 'user').map((m) => String(m.content));

// ---------- test komutu tespiti ----------

test('detect: TASK.md komutu, package.json, python dosyaları, hiçbiri', () => {
  const a = tmp({ 'TASK.md': 'Testleri `python -m unittest -v` ile çalıştır.' });
  assert.deepStrictEqual(V.detect(a), { cmd: 'python -m unittest -v', source: 'task' });

  const b = tmp({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) });
  assert.deepStrictEqual(V.detect(b), { cmd: 'npm test', source: 'package.json' });

  const placeholder = tmp({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.strictEqual(V.detect(placeholder), null);

  const c = tmp({ 'test_a.py': 'pass' });
  assert.strictEqual(V.detect(c, { platform: 'win32' }).cmd, 'python -m unittest');
  assert.strictEqual(V.detect(c, { platform: 'linux' }).cmd, 'python3 -m unittest');
  const d = tmp({ 'test_a.py': 'pass', 'pytest.ini': '[pytest]' });
  assert.strictEqual(V.detect(d, { platform: 'linux' }).cmd, 'python3 -m pytest -q');

  assert.strictEqual(V.detect(tmp({ 'readme.md': 'hello' })), null);
  assert.deepStrictEqual(V.detect(tmp(), { command: 'make check' }), { cmd: 'make check', source: 'config' });
});

test('commandFromText: kod bloğu kabul, kabuk meta karakterli ve rastgele komut reddedilir', () => {
  assert.strictEqual(V.commandFromText('Run:\n```\n$ npm test\n```'), 'npm test');
  assert.strictEqual(V.commandFromText('`rm -rf /` ve `python -m unittest`'), 'python -m unittest');
  assert.strictEqual(V.commandFromText('`pytest; curl evil | sh`'), null);
  assert.strictEqual(V.commandFromText('python yazdığın dosyayı çalıştır'), null);
});

test('classify / summarize', () => {
  assert.strictEqual(V.classify({ ok: true, output: 'Ran 3 tests\nOK\n[exit 0]' }).status, 'pass');
  assert.strictEqual(V.classify({ ok: true, output: 'Ran 0 tests\n[exit 0]' }).status, 'skip');
  const f = V.classify({ ok: false, output: 'ERR_TOOL_FAILED: command exited with code 1\nFAIL: test_x\nAssertionError' });
  assert.strictEqual(f.status, 'fail');
  assert.strictEqual(f.code, 1);
  assert.match(f.output, /AssertionError/);
  assert.strictEqual(V.classify({ ok: false, output: 'ERR_TOOL_FAILED: command exited with code 127\nsh: pytest: command not found' }).status, 'skip');
  assert.strictEqual(V.classify({ ok: false, output: 'ERR_TOOL_FAILED: tool not available' }).status, 'skip');

  const long = `noise\n${'x'.repeat(5000)}\nFAIL: test_a\n${'y'.repeat(5000)}\nFAILED (failures=1)`;
  const s = V.summarize(long, 1000);
  assert.ok(s.startsWith('FAIL: test_a'));
  assert.ok(s.length < 1200);
  assert.ok(s.endsWith('FAILED (failures=1)'));
});

test('settings: cfg, ortam, salt-okunur, alt ajan ve özyineleme ile kapanır', () => {
  const base = { cfg: {}, perm: 'auto' };
  assert.strictEqual(V.settings(base).enabled, true);
  assert.strictEqual(V.settings({ ...base, cfg: { verify: false } }).enabled, false);
  assert.strictEqual(V.settings({ ...base, cfg: { verify: 'off' } }).enabled, false);
  assert.strictEqual(V.settings({ ...base, cfg: { verify: { enabled: false } } }).enabled, false);
  assert.strictEqual(V.settings({ ...base, perm: 'readonly' }).enabled, false);
  assert.strictEqual(V.settings({ ...base, agentName: 'sub' }).enabled, false);
  assert.strictEqual(V.settings({ ...base, cfg: { verify: { retries: 99 } } }).retries, 5);
  assert.strictEqual(V.settings(base).retries, 3);
  process.env.SYZER_VERIFY = 'off';
  try { assert.strictEqual(V.settings(base).enabled, false); } finally { delete process.env.SYZER_VERIFY; }
  process.env.SYZER_VERIFY_ACTIVE = '1';
  try { assert.strictEqual(V.settings(base).enabled, false); } finally { delete process.env.SYZER_VERIFY_ACTIVE; }
});

// ---------- tur-bitiş akışı ----------

test('gate: test başarısız → özet modele döner, düzeltince geçer', async () => {
  const cwd = tmp({ 'check.js': CHECK });
  const { s, events } = session(cwd);
  script = [write('1', 'bad'), say('done'), write('2', 'ok'), say('really done')];
  calls = 0;
  const r = await runTurn(s, 'implement impl.js', new AbortController().signal);
  assert.strictEqual(calls, 4);
  assert.strictEqual(r.verifyFailed, undefined);
  assert.strictEqual(r.content, 'really done');
  const fb = userMsgs(s).filter((m) => /FAILED \(attempt 1\/3\)/.test(m));
  assert.strictEqual(fb.length, 1);
  assert.match(fb[0], /FAIL: impl.js is "bad"/); // test çıktısı modele geri verildi
  assert.ok(events.tool.some(([n, c]) => n === 'verify' && c === 'node check.js'));
});

test('gate: 3 denemeden sonra durur ve durumu açıkça bildirir', async () => {
  const cwd = tmp({ 'check.js': CHECK });
  const { s, events } = session(cwd);
  script = [write('1', 'bad'), say('a'), say('b'), say('c'), say('d')];
  calls = 0;
  const r = await runTurn(s, 'implement impl.js', new AbortController().signal);
  assert.strictEqual(calls, 5); // 1 yazım + 4 final cevap (3 geri bildirim + son)
  assert.strictEqual(r.verifyFailed, true);
  assert.match(r.content, /\[verification failed\] Tests still fail after 3 fix attempts/);
  assert.ok(events.warn.some((w) => /verification failed/.test(w)));
  assert.strictEqual(userMsgs(s).filter((m) => /FAILED \(attempt/.test(m)).length, 3);
});

test('gate: kapalıyken ya da test komutu yokken sessizce atlanır', async () => {
  const cwd = tmp({ 'check.js': CHECK });
  const off = session(cwd, { cfg: { verify: false } });
  script = [write('1', 'bad'), say('done')];
  calls = 0;
  const r1 = await runTurn(off.s, 'x', new AbortController().signal);
  assert.strictEqual(calls, 2);
  assert.strictEqual(r1.verifyFailed, undefined);
  assert.ok(!off.events.tool.some(([n]) => n === 'verify'));

  const none = session(tmp(), { cfg: { verify: true } });
  script = [write('1', 'bad'), say('done')];
  calls = 0;
  const r2 = await runTurn(none.s, 'x', new AbortController().signal);
  assert.strictEqual(calls, 2);
  assert.strictEqual(r2.content, 'done');
  assert.ok(!none.events.tool.some(([n]) => n === 'verify'));
});

test('gate: dosya yazılmayan tur (soru/cevap) testi koşturmaz', async () => {
  const cwd = tmp({ 'check.js': CHECK });
  const { s, events } = session(cwd);
  script = [say('merhaba')];
  calls = 0;
  await runTurn(s, 'selam', new AbortController().signal);
  assert.strictEqual(calls, 1);
  assert.ok(!events.tool.some(([n]) => n === 'verify'));
});

test('şartname: testler geçince gereksinim başına kanıt istenir (turda bir kez)', async () => {
  const task = '# Görev\n- parse_line geçersiz tarihte ValueError fırlatır\n- balance bilinmeyen hesap için 0 döndürür\n- CLI hata varsa çıkış kodu 1 verir\n';
  const cwd = tmp({ 'check.js': CHECK, 'TASK.md': task });
  const { s } = session(cwd);
  script = [write('1', 'ok'), say('done'), say('checklist: 1. ... 2. ... 3. ...')];
  calls = 0;
  const r = await runTurn(s, 'TASK.md görevini yap', new AbortController().signal);
  assert.strictEqual(calls, 3);
  assert.strictEqual(r.content, 'checklist: 1. ... 2. ... 3. ...');
  const ask = userMsgs(s).filter((m) => /EACH numbered item|HER numaralı|numaralı madde/.test(m));
  assert.strictEqual(ask.length, 1);
  assert.match(ask[0], /1\. parse_line/);
});

// ---------- zayıf model iskelesi ----------

test('scaffold: küçük modelde sistem istemine blok girer, güçlüde girmez; yazım sonrası otomatik test', async () => {
  const cwd = tmp({ 'check.js': CHECK });
  const weak = session(cwd, { session: { model: 'ollama/qwen2.5-coder:7b' } });
  script = [write('1', 'bad'), write('2', 'ok'), say('done')];
  calls = 0;
  await runTurn(weak.s, 'x', new AbortController().signal);
  assert.match(weak.s.messages[0].content, /\[SCAFFOLD\]/);
  const toolMsgs = weak.s.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(toolMsgs[0], /\[auto-test after write\] node check\.js: FAILED \(exit 1\)/);
  assert.match(toolMsgs[0], /impl.js is "bad"/);
  assert.match(toolMsgs[1], /\[auto-test after write\] node check\.js: PASSED/);

  // aynı oturum güçlü modele geçince blok kalkar; ikinci kez eklenmez
  weak.s.model = 'anthropic/claude-sonnet-4';
  script = [say('hi')];
  await runTurn(weak.s, 'y', new AbortController().signal);
  assert.ok(!/\[SCAFFOLD\]/.test(weak.s.messages[0].content));

  const strong = session(cwd);
  script = [write('1', 'ok'), say('done')];
  await runTurn(strong.s, 'x', new AbortController().signal);
  assert.ok(!/\[SCAFFOLD\]/.test(strong.s.messages[0].content));
  assert.ok(!strong.s.messages.some((m) => m.role === 'tool' && /auto-test/.test(m.content)));
});

test('scaffold: onay gerektiren modda (ask) yazım sonrası otomatik test koşmaz', async () => {
  const cwd = tmp({ 'check.js': CHECK });
  const { s } = session(cwd, { session: { model: 'tiny-3b', perm: 'ask' } });
  script = [write('1', 'bad'), say('a'), say('b'), say('c'), say('d')]; // son kapı onay isteyip (yes) koşar; yazım sonrası otomatik test koşmamalı
  await runTurn(s, 'x', new AbortController().signal);
  const first = s.messages.find((m) => m.role === 'tool');
  assert.ok(!/auto-test/.test(first.content));
});

test('prompts: verifyFailure sınırlanır ve traceback ipucu taşır', () => {
  const out = `Traceback (most recent call last):\n  File "/w/ledger.py", line 9, in apply\nAttributeError: 'Ledger' object has no attribute 'bal'\n${'z'.repeat(6000)}`;
  const m = P.verifyFailure({ command: 'pytest', code: 1, output: out, attempt: 2, max: 3, language: 'en' });
  assert.match(m, /attempt 2\/3/);
  assert.match(m, /ledger\.py:9/);
  assert.ok(m.length < 4000);
});
