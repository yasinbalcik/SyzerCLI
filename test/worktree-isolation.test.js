'use strict';
// spawn_agent isolation: "worktree": gerçek geçici git deposu, ağ yok, model çağrısı yok (runTurn taklit edilir).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wt-home-'));
process.env.SYZER_HOME = home;

const WT = require('../src/worktree');
const agentMod = require('../src/agent');
const { spawn } = require('../src/subagents');

const g = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wt-repo-'));
  g(dir, 'init', '-q');
  g(dir, 'config', 'user.name', 'Test');
  g(dir, 'config', 'user.email', 'test@example.com');
  g(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  g(dir, 'add', '.');
  g(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function parentFor(cwd, warns) {
  return {
    cfg: {}, cwd, ctx: { agents: [{ name: 'general', tools: ['read_file', 'write_file'], description: '' }] },
    skills: [], model: 'm', effort: 'low', useTools: true, runs: [],
    out: { warn: (m) => warns.push(m) },
    settings: null, confirm: async () => 'yes',
  };
}

// runTurn'i taklit eder: alt ajanın cwd'sini kaydeder, isteğe bağlı dosya yazar.
function mockRunTurn(fn) {
  const orig = agentMod.runTurn;
  agentMod.runTurn = async (sub, prompt) => { await fn(sub, prompt); return { content: 'done', tokens: 1, toolCalls: 0 }; };
  return () => { agentMod.runTurn = orig; };
}

const call = (args) => ({ arguments: JSON.stringify({ prompt: 'do it', ...args }) });
const worktreeList = (repo) => g(repo, 'worktree', 'list', '--porcelain').stdout;
const branches = (repo) => g(repo, 'branch', '--list', 'syzer/agent-*').stdout.trim();

test('worktree: created under SYZER_HOME/worktrees on a new branch, cleaned when unchanged', async () => {
  const repo = makeRepo();
  let seen;
  const restore = mockRunTurn((sub) => { seen = sub.cwd; assert.ok(fs.existsSync(path.join(sub.cwd, 'a.txt'))); assert.match(branches(repo), /syzer\/agent-/); });
  try {
    const r = await spawn(parentFor(repo, []), call({ isolation: 'worktree' }));
    assert.equal(r.ok, true);
    const expectRoot = path.resolve(home, 'worktrees');
    assert.equal(path.dirname(path.resolve(seen)), expectRoot);
    assert.notEqual(path.resolve(seen), path.resolve(repo));
    assert.equal(fs.existsSync(seen), false, 'unchanged worktree removed');
    assert.equal(branches(repo), '', 'branch removed');
    assert.ok(!worktreeList(repo).includes('syzer/agent-'));
    assert.ok(!/\[worktree\]/.test(r.output));
  } finally { restore(); }
});

test('worktree: changes are kept, reported with path/branch/stat, main tree untouched', async () => {
  const repo = makeRepo();
  let seen;
  const restore = mockRunTurn((sub) => { seen = sub.cwd; fs.writeFileSync(path.join(sub.cwd, 'new.txt'), 'hello\n'); fs.appendFileSync(path.join(sub.cwd, 'a.txt'), 'two\n'); });
  try {
    const r = await spawn(parentFor(repo, []), call({ isolation: 'worktree' }));
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(seen, 'new.txt')));
    assert.match(r.output, /\[worktree\]/);
    assert.ok(r.output.includes(seen));
    const br = /branch: (syzer\/agent-[a-z0-9-]+)/.exec(r.output);
    assert.ok(br, 'branch name in report');
    assert.ok(branches(repo).includes(br[1]));
    assert.match(r.output, /new\.txt/);
    assert.match(r.output, /a\.txt/);
    // ana çalışma ağacı dokunulmadı
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(fs.existsSync(path.join(repo, 'new.txt')), false);
    assert.equal(g(repo, 'status', '--porcelain').stdout.trim(), '');
  } finally { restore(); }
});

test('worktree: non-git directory falls back to normal run with a warning', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wt-nogit-'));
  const warns = [];
  let seen;
  const restore = mockRunTurn((sub) => { seen = sub.cwd; });
  try {
    const r = await spawn(parentFor(dir, warns), call({ isolation: 'worktree' }));
    assert.equal(r.ok, true);
    assert.equal(seen, dir);
    assert.ok(warns.some((w) => /worktree isolation unavailable/.test(w)));
  } finally { restore(); }
});

test('worktree: two parallel isolated agents get distinct paths and branches', async () => {
  const repo = makeRepo();
  const cwds = [];
  const restore = mockRunTurn(async (sub) => {
    cwds.push(sub.cwd);
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(path.join(sub.cwd, `f${cwds.length}.txt`), 'x');
  });
  try {
    const p = parentFor(repo, []);
    const [r1, r2] = await Promise.all([spawn(p, call({ isolation: 'worktree' })), spawn(p, call({ isolation: 'worktree' }))]);
    assert.equal(cwds.length, 2);
    assert.notEqual(cwds[0], cwds[1]);
    const b1 = /branch: (\S+)/.exec(r1.output)[1];
    const b2 = /branch: (\S+)/.exec(r2.output)[1];
    assert.notEqual(b1, b2);
    assert.ok(fs.existsSync(cwds[0]) && fs.existsSync(cwds[1]));
  } finally { restore(); }
});

test('worktree.create: refuses non-repo and returns reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-wt-nogit2-'));
  const r = WT.create(dir);
  assert.equal(r.ok, false);
  assert.match(r.reason, /git/);
});

test('spawn_agent schema exposes isolation enum', () => {
  const tools = require('../src/tools');
  const defs = tools.toolDefsFor({ canSpawn: true, cfg: {}, agentName: null });
  const d = defs.find((x) => x.function.name === 'spawn_agent');
  assert.deepEqual(d.function.parameters.properties.isolation.enum, ['worktree']);
});
