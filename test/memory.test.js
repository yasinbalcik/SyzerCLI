'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-home-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.SYZER_HOME = path.join(HOME, '.syzercli');
delete process.env.SYZER_MEMORY;

const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../src/memory');
const { execute, toolDefsFor } = require('../src/tools');
const { buildContext } = require('../src/context');

const proj = () => fs.mkdtempSync(path.join(os.tmpdir(), 'memory-proj-'));
const sess = (cwd, extra = {}) => ({ cwd, perm: 'auto', canAsk: false, plan: false, cfg: {}, settings: { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [] } }, ...extra });
const call = (name, args) => ({ name, arguments: JSON.stringify(args) });

test('memory: save, read, list, forget', () => {
  const cwd = proj();
  assert.deepEqual(memory.list(cwd), []);
  assert.equal(memory.loadIndex(cwd), '');
  const r = memory.save(cwd, { name: 'Prefers-PNPM', description: 'uses pnpm', type: 'user', body: 'Always use pnpm, not npm.' });
  assert.deepEqual(r, { name: 'prefers-pnpm', created: true });
  const f = memory.read(cwd, 'prefers-pnpm');
  assert.equal(f.type, 'user');
  assert.equal(f.body, 'Always use pnpm, not npm.');
  assert.equal(memory.list(cwd).length, 1);
  assert.equal(memory.forget(cwd, 'prefers-pnpm'), true);
  assert.equal(memory.forget(cwd, 'prefers-pnpm'), false);
  assert.equal(memory.read(cwd, 'prefers-pnpm'), null);
  assert.equal(memory.loadIndex(cwd), '');
});

test('memory: same name overwrites, index has one line per fact', () => {
  const cwd = proj();
  memory.save(cwd, { name: 'a', description: 'first', body: 'one' });
  const r = memory.save(cwd, { name: 'a', description: 'second', body: 'two' });
  assert.equal(r.created, false);
  memory.save(cwd, { name: 'b', description: 'other', type: 'reference', body: 'x' });
  assert.equal(memory.list(cwd).length, 2);
  assert.equal(memory.read(cwd, 'a').body, 'two');
  const idx = fs.readFileSync(path.join(memory.dir(cwd), 'MEMORY.md'), 'utf8').trim().split('\n');
  assert.equal(idx.length, 2);
  assert.match(idx[0], /\[a\]\(a\.md\).*second/);
  assert.ok(!fs.readdirSync(memory.dir(cwd)).some((f) => f.endsWith('.tmp')));
});

test('memory: path traversal and bad names are rejected', () => {
  const cwd = proj();
  for (const bad of ['../evil', '..\\evil', 'a/b', 'a.md', '', '.hidden', 'memory', 'x'.repeat(61)]) {
    assert.throws(() => memory.save(cwd, { name: bad, description: 'd', body: 'b' }), memory.MemoryError, bad);
  }
  assert.throws(() => memory.read(cwd, '../x'), memory.MemoryError);
  assert.throws(() => memory.forget(cwd, '../x'), memory.MemoryError);
  assert.throws(() => memory.save(cwd, { name: 'ok', description: 'd', type: 'weird', body: 'b' }), memory.MemoryError);
});

test('memory: size limits and secrets', () => {
  const cwd = proj();
  assert.throws(() => memory.save(cwd, { name: 'big', description: 'd', body: 'x'.repeat(memory.LIMITS.body + 1) }), /too long/);
  assert.throws(() => memory.save(cwd, { name: 'big', description: 'd'.repeat(memory.LIMITS.description + 1), body: 'x' }), /too long/);
  assert.throws(() => memory.save(cwd, { name: 'key', description: 'd', body: 'token sk-abcdefghijklmnopqrstuvwxyz123456' }), /secret/);
  assert.equal(memory.list(cwd).length, 0);
});

test('memory: loadIndex is capped by maxChars', () => {
  const cwd = proj();
  for (let i = 0; i < 20; i++) memory.save(cwd, { name: `fact-${i}`, description: `description number ${i} `.repeat(3), body: 'b' });
  const idx = memory.loadIndex(cwd, { maxChars: 600 });
  assert.ok(idx.length <= 640, String(idx.length));
  assert.match(idx, /truncated/);
});

test('memory: stores are per project', () => {
  const a = proj();
  const b = proj();
  memory.save(a, { name: 'only-a', description: 'd', body: 'b' });
  assert.equal(memory.list(b).length, 0);
});

test('memory: tools save/forget via execute, errors are ERR_ lines', async () => {
  const cwd = proj();
  const s = sess(cwd);
  let r = await execute(call('memory_save', { name: 'fact', description: 'a fact', type: 'project', body: 'text' }), s);
  assert.equal(r.ok, true);
  assert.equal(memory.list(cwd).length, 1);
  r = await execute(call('memory_save', { name: '../x', description: 'd', body: 'b' }), s);
  assert.equal(r.ok, false);
  assert.match(r.output, /^ERR_TOOL_FAILED:/);
  r = await execute(call('memory_forget', { name: 'fact' }), s);
  assert.equal(r.ok, true);
  r = await execute(call('memory_forget', { name: 'fact' }), s);
  assert.equal(r.ok, false);
});

test('memory: context gets the index, simple/disabled/sub sessions do not get tools', () => {
  const cwd = proj();
  assert.ok(!buildContext(cwd).system.includes('Persistent project memory'));
  memory.save(cwd, { name: 'deploy-note', description: 'deploys go through staging', body: 'b' });
  const ctx = buildContext(cwd);
  assert.match(ctx.system, /Persistent project memory/);
  assert.match(ctx.system, /deploy-note/);
  assert.ok(!ctx.files.some((f) => f.path === 'memory/MEMORY.md')); // alt ajanlar ctx.files kullanır
  const names = (s) => toolDefsFor(s).map((d) => d.function.name);
  assert.ok(names(sess(cwd)).includes('memory_save'));
  assert.ok(!names(sess(cwd, { cfg: { memory: false } })).includes('memory_save'));
  assert.ok(!names(sess(cwd, { agentName: 'explore' })).includes('memory_forget'));
  assert.ok(!names(sess(cwd, { allowedTools: new Set(['read_file']) })).includes('memory_save'));
});

test('memory: disable via cfg and SYZER_MEMORY', async () => {
  const cwd = proj();
  assert.equal(memory.enabled({ memory: false }), false);
  assert.equal(memory.enabled({}), true);
  const r = await execute(call('memory_save', { name: 'x', description: 'd', body: 'b' }), sess(cwd, { cfg: { memory: false } }));
  assert.equal(r.ok, false);
  memory.save(cwd, { name: 'x', description: 'd', body: 'b' });
  process.env.SYZER_MEMORY = 'off';
  try {
    assert.equal(memory.enabled({}), false);
    assert.ok(!buildContext(cwd).system.includes('Persistent project memory'));
  } finally { delete process.env.SYZER_MEMORY; }
});

test('/memory command: list, show, forget', () => {
  const { run } = require('../src/ext/memory');
  const cwd = proj();
  const ctx = { session: { cwd } };
  assert.match(run('list', ctx), /No memories/);
  memory.save(cwd, { name: 'n1', description: 'desc', body: 'the body' });
  assert.match(run('list', ctx), /n1 \(project\) - desc/);
  assert.match(run('show n1', ctx), /the body/);
  assert.match(run('forget n1', ctx), /Forgot/);
  assert.match(run('show ../x', ctx), /invalid name/);
});
