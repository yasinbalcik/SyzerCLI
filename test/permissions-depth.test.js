'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-pd-home-'));
process.env.SYZER_HOME = HOME;

const perms = require('../src/permissions');
const settingsMod = require('../src/settings');
const { execute } = require('../src/tools');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const baseSettings = (extra = {}) => ({ allow: [], deny: [], ask: [], hooks: { PreToolUse: [], PostToolUse: [] }, ...extra });
const call = (name, args) => ({ name, arguments: JSON.stringify(args) });

test('decide: precedence deny > ask > allow, ask optional', () => {
  const cwd = process.cwd();
  const s = { allow: ['Bash(git:*)'], ask: ['Bash(git push:*)'], deny: ['Bash(git push --force:*)'] };
  assert.equal(perms.decide(s, 'run_command', { command: 'git status' }, cwd).verdict, 'allow');
  assert.equal(perms.decide(s, 'run_command', { command: 'git push origin' }, cwd).verdict, 'ask');
  assert.equal(perms.decide(s, 'run_command', { command: 'git push --force x' }, cwd).verdict, 'deny');
  assert.equal(perms.decide({ allow: ['Bash(ls:*)'] }, 'run_command', { command: 'ls' }, cwd).verdict, 'allow');
});

test('ask rule: prompts even in auto mode with an allow rule; yes proceeds, no denies', async () => {
  const cwd = tmp('syzer-pd-');
  const asked = [];
  const mk = (answer) => ({
    cwd, perm: 'auto', canAsk: true, plan: false, out: {},
    settings: baseSettings({ allow: ['Write(*)'], ask: ['Write(secret.txt)'] }),
    confirm: async (...a) => { asked.push(a[0]); return answer; },
  });
  const r1 = await execute(call('write_file', { path: 'secret.txt', content: 'a' }), mk('no'));
  assert.equal(r1.ok, false);
  assert.equal(asked.length, 1);
  assert.equal(fs.existsSync(path.join(cwd, 'secret.txt')), false);
  const r2 = await execute(call('write_file', { path: 'secret.txt', content: 'a' }), mk('yes'));
  assert.equal(r2.ok, true);
  assert.equal(asked.length, 2);
  // eşleşmeyen dosya: allow kuralıyla sorusuz
  const r3 = await execute(call('write_file', { path: 'other.txt', content: 'b' }), mk('no'));
  assert.equal(r3.ok, true);
  assert.equal(asked.length, 2);
});

test('session verdict: adds an in-memory allow rule, nothing persisted, next call is silent', async () => {
  const cwd = tmp('syzer-pd-');
  let asks = 0;
  const s = {
    cwd, perm: 'ask', canAsk: true, plan: false, out: {},
    settings: baseSettings(),
    confirm: async () => { asks++; return 'session'; },
  };
  const r1 = await execute(call('write_file', { path: 'a.txt', content: 'x' }), s);
  assert.equal(r1.ok, true);
  assert.equal(asks, 1);
  assert.ok(s.settings.allow.includes('Write(a.txt)'));
  assert.equal(s.perm, 'ask');
  const r2 = await execute(call('write_file', { path: 'a.txt', content: 'y' }), s);
  assert.equal(r2.ok, true);
  assert.equal(asks, 1);
  assert.equal(fs.existsSync(settingsMod.projectFile(cwd)), false);
});

test('additionalDirectories: isOutside honours extra dirs; write allowed in auto headless', async () => {
  const cwd = tmp('syzer-pd-');
  const extra = tmp('syzer-pd-extra-');
  const other = tmp('syzer-pd-other-');
  const f = path.join(extra, 'new.txt');
  assert.equal(perms.isOutside(cwd, f), true);
  assert.equal(perms.isOutside(cwd, f, undefined, [extra]), false);
  assert.equal(perms.isOutside(cwd, path.join(other, 'x.txt'), undefined, [extra]), true);
  assert.equal(perms.isOutside(cwd, path.join(extra, '..', 'zzz.txt'), undefined, [extra]), true);
  const s = { cwd, perm: 'auto', canAsk: false, plan: false, settings: baseSettings({ additionalDirectories: [extra] }) };
  const r = await execute(call('write_file', { path: f, content: 'ok' }), s);
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(f, 'utf8'), 'ok');
  const bad = await execute(call('write_file', { path: path.join(other, 'x.txt'), content: 'no' }), s);
  assert.match(bad.output, /^ERR_E_OUTSIDE_WORKSPACE:/);
});

test('settings.load: ask from any file, additionalDirectories only from own files, origins recorded', () => {
  const cwd = tmp('syzer-pd-');
  fs.mkdirSync(path.join(cwd, '.syzer'));
  fs.mkdirSync(path.join(cwd, '.claude'));
  const own = path.join(cwd, '.syzer', 'settings.json');
  const claude = path.join(cwd, '.claude', 'settings.json');
  fs.writeFileSync(own, JSON.stringify({ permissions: { allow: ['Read(*)'], ask: ['Bash(rm:*)'], additionalDirectories: ['../shared', '~/docs'] } }));
  fs.writeFileSync(claude, JSON.stringify({ permissions: { ask: ['WebFetch'], additionalDirectories: ['/etc'] } }));
  const s = settingsMod.load(cwd);
  assert.deepEqual(s.ask.sort(), ['Bash(rm:*)', 'WebFetch']);
  assert.deepEqual(s.additionalDirectories, [path.resolve(cwd, '../shared'), path.join(os.homedir(), 'docs')]);
  assert.ok(s.origins.some((o) => o.kind === 'allow' && o.rule === 'Read(*)' && o.file === own));
  assert.ok(s.origins.some((o) => o.kind === 'ask' && o.rule === 'WebFetch' && o.file === claude));
});

test('/permissions: lists rules with source and session-added rules', () => {
  const { describe } = require('../src/ext/permissions');
  const settings = { allow: ['Read(*)', 'Write(a)'], ask: ['Bash(rm:*)'], deny: [], additionalDirectories: ['/x'],
    origins: [{ kind: 'allow', rule: 'Read(*)', file: '/p/settings.json' }, { kind: 'ask', rule: 'Bash(rm:*)', file: '/q.json' }] };
  const out = describe(settings, 'auto');
  assert.match(out, /allow +Read\(\*\)\s+\[\/p\/settings\.json\]/);
  assert.match(out, /ask +Bash\(rm:\*\)\s+\[\/q\.json\]/);
  assert.match(out, /Write\(a\)\s+\[this session/);
  assert.match(out, /Additional directories: \/x/);
  assert.match(describe(null, 'ask'), /No settings loaded/);
});
