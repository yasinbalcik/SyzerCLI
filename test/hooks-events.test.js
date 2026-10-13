'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-hk-home-'));
delete process.env.SYZER_HOOKS;
delete process.env.SYZER_VERIFY;
delete process.env.SYZER_SCAFFOLD;

// Ağ yok: model çağrısı betikle sürülür
const api = require('../src/api');
const keys = require('../src/keys');
const models = require('../src/models');
let script = [];
api.chatStream = async () => { const r = script.shift(); if (!r) throw new Error('script exhausted'); return { usage: { total_tokens: 1 }, ...r }; };
keys.withRotation = async (cfg, fn) => ({ result: await fn({ key: 'k' }), index: 0 });
models.supportsReasoning = async () => null;
const { runTurn } = require('../src/agent');
require('../src/i18n').setLang('en');
const hooks = require('../src/hooks');
const settingsMod = require('../src/settings');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-hk-'));
const fwd = (p) => p.replace(/\\/g, '/');
// Kabuğa özgü sözdizimi yok: her davranış küçük bir node betiği
const js = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return `node "${fwd(f)}"`; };
const ctxCmd = (name, text) => js(`${name}.js`, `process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{console.log(${JSON.stringify(text)});});`);
const blockCmd = (name, msg) => js(`${name}.js`, `process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{console.error(${JSON.stringify(msg)});process.exit(2);});`);
const echoCmd = js('echo.js', "let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{const j=JSON.parse(b);console.log(j.hook_event_name+':'+(j.prompt||j.trigger||j.agent_type||''));});");

const H = (command, matcher = '*') => ({ matcher, command, timeout: 20 });
const settings = (h = {}) => ({ allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [], ...h } });

function session(st, over = {}) {
  const out = { waiting() {}, thinking() {}, text() {}, endText() {}, toolResult() {}, tool() {}, warn() {} };
  return {
    cfg: { budget: {} }, model: 'vendor/strong-model', effort: 'auto', perm: 'auto', plan: false, useTools: true, canSpawn: false,
    cwd: dir, sessionId: `hk-${Math.random().toString(36).slice(2)}`, todos: [], bg: new Map(), checkpoints: [], cpDone: true, noAutoCompact: true,
    settings: st, messages: [{ role: 'system', content: 'SYS' }], out, confirm: async () => 'yes', ...over,
  };
}
const say = (content) => ({ content, toolCalls: [] });
const userMsgs = (s) => s.messages.filter((m) => m.role === 'user').map((m) => String(m.content));

test('settings.load: yeni olay dizileri + düz/iç içe biçim normalizasyonu', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-hk-proj-'));
  fs.mkdirSync(path.join(cwd, '.syzer'));
  fs.writeFileSync(path.join(cwd, '.syzer', 'settings.json'), JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [{ command: 'a', timeout: 5 }] }],
      Stop: [{ matcher: 'x', command: 'b' }],
      SessionStart: [{ command: 'c' }], PreCompact: [{ command: 'd' }], SubagentStop: [{ command: 'e' }],
    },
  }));
  const s = settingsMod.load(cwd);
  for (const ev of ['UserPromptSubmit', 'Stop', 'SessionStart', 'PreCompact', 'SubagentStop', 'PreToolUse', 'PostToolUse']) assert.ok(Array.isArray(s.hooks[ev]), ev);
  assert.deepStrictEqual(s.hooks.UserPromptSubmit, [{ matcher: '*', command: 'a', timeout: 5 }]);
  assert.deepStrictEqual(s.hooks.Stop, [{ matcher: 'x', command: 'b', timeout: 30 }]);
});

test('fire: eksik dizi/kancasız ayar dayanıklı, sıfır sonuç', async () => {
  assert.deepStrictEqual(await hooks.fire(null, 'Stop', {}, dir), { block: false, message: '', context: '' });
  assert.deepStrictEqual(await hooks.fire(settings(), 'Stop', {}, dir), { block: false, message: '', context: '' });
});

test('fire: stdout bağlam, olay adı ve yük stdin ile gelir', async () => {
  const r = await hooks.fire(settings({ UserPromptSubmit: [H(echoCmd)] }), 'UserPromptSubmit', { prompt: 'hello' }, dir);
  assert.strictEqual(r.block, false);
  assert.strictEqual(r.context, 'UserPromptSubmit:hello');
});

test('fire: çıkış 2 → block + stderr mesajı', async () => {
  const r = await hooks.fire(settings({ Stop: [H(blockCmd('b1', 'not yet'))] }), 'Stop', {}, dir);
  assert.strictEqual(r.block, true);
  assert.strictEqual(r.message, 'not yet');
});

test('fire: matcher değeri (regex) süzer; değer yoksa yok sayılır', async () => {
  const st = settings({ PreCompact: [H(ctxCmd('m1', 'only-auto'), 'auto')] });
  assert.strictEqual((await hooks.fire(st, 'PreCompact', {}, dir, 'manual')).context, '');
  assert.strictEqual((await hooks.fire(st, 'PreCompact', {}, dir, 'auto')).context, 'only-auto');
  assert.strictEqual((await hooks.fire(st, 'PreCompact', {}, dir)).context, 'only-auto');
});

test('SYZER_HOOKS=off: tüm olaylar (pre/post dahil) devre dışı', async () => {
  const st = settings({ Stop: [H(blockCmd('b2', 'x'))], PreToolUse: [H(blockCmd('b3', 'x'))] });
  process.env.SYZER_HOOKS = 'off';
  try {
    assert.strictEqual((await hooks.fire(st, 'Stop', {}, dir)).block, false);
    assert.strictEqual((await hooks.pre(st, 'read_file', {}, dir)).block, false);
    assert.strictEqual(await hooks.post(st, 'read_file', {}, { ok: true, output: '' }, dir), '');
  } finally { delete process.env.SYZER_HOOKS; }
  assert.strictEqual((await hooks.pre(st, 'read_file', {}, dir)).block, true); // eski davranış korunur
});

test('runTurn: UserPromptSubmit engeller, modeli çağırmaz', async () => {
  script = [say('never')];
  const s = session(settings({ UserPromptSubmit: [H(blockCmd('u1', 'policy says no'))] }));
  const r = await runTurn(s, 'do it', undefined);
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.content, 'policy says no');
  assert.strictEqual(script.length, 1); // model çağrılmadı
  assert.strictEqual(s.messages.length, 1);
});

test('runTurn: UserPromptSubmit + SessionStart bağlamı [system reminder] olarak eklenir; SessionStart bir kez', async () => {
  const st = settings({ UserPromptSubmit: [H(ctxCmd('u2', 'CTX-PROMPT'))], SessionStart: [H(ctxCmd('s1', 'CTX-START'))] });
  const s = session(st);
  script = [say('one'), say('two')];
  await runTurn(s, 'first', undefined);
  await runTurn(s, 'second', undefined);
  const u = userMsgs(s);
  assert.ok(u[0].startsWith('first') && u[0].includes('[system reminder]') && u[0].includes('CTX-START') && u[0].includes('CTX-PROMPT'));
  assert.ok(u[1].includes('CTX-PROMPT') && !u[1].includes('CTX-START'));
});

test('runTurn: Stop çıkış 2 → model geri çevrilir; en çok 3 kez', async () => {
  const s = session(settings({ Stop: [H(blockCmd('st1', 'finish the checklist'))] }));
  script = [say('a'), say('b'), say('c'), say('d'), say('e')];
  const r = await runTurn(s, 'go', undefined);
  assert.strictEqual(r.content, 'd'); // 1 ilk + 3 geri bildirim = 4 çağrı
  assert.strictEqual(script.length, 1);
  assert.strictEqual(userMsgs(s).filter((m) => m.startsWith('[Stop hook]')).length, 3);
  assert.ok(userMsgs(s).some((m) => m.includes('finish the checklist')));
});

test('runTurn: Stop kancası yoksa tek model çağrısı', async () => {
  const s = session(settings());
  script = [say('done'), say('extra')];
  const r = await runTurn(s, 'go', undefined);
  assert.strictEqual(r.content, 'done');
  assert.strictEqual(script.length, 1);
});

test('compactSession: PreCompact kancası çalışır, sıkıştırmayı engellemez', async () => {
  const marker = path.join(dir, 'precompact.txt');
  const cmd = js('pc.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'fired');`);
  const s = session(settings({ PreCompact: [H(cmd)] }));
  const compact = require('../src/compact');
  await compact.compactSession(s, { mode: 'trim', threshold: 1e9, say() {} });
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'fired');
});
