const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-home-'));
process.env.SYZER_HOME = home;
const plugins = require('../src/plugins');
const ctxMod = require('../src/context');
const settings = require('../src/settings');
const styles = require('../src/output-styles');
const ext = require('../src/ext/plugin');

const tmp = (p = 'plug-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

function makePlugin(name = 'demo', extra = {}) {
  const d = tmp('plug-src-');
  put(path.join(d, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', description: 'Demo', ...extra }));
  put(path.join(d, 'commands', 'hello.md'), '---\ndescription: say hi\n---\nHi $ARGUMENTS');
  put(path.join(d, 'skills', 'sk', 'SKILL.md'), '---\nname: sk\ndescription: a skill\n---\nbody');
  put(path.join(d, 'agents', 'rev.md'), '---\nname: rev\ndescription: reviewer\n---\nReview.');
  put(path.join(d, 'output-styles', 'terse.md'), '---\nname: terse\n---\nVery terse.');
  return d;
}
const yes = async () => 'y';
const no = async () => 'n';
const cwd = tmp('plug-cwd-');

test('plugins: install from a local directory, list, and merge into context', async () => {
  const r = await plugins.install(makePlugin(), { readKey: yes });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(home, 'plugins', 'demo', 'plugin.json')));
  const l = plugins.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].enabled, true);
  assert.ok(ctxMod.findCommands(cwd).some((c) => c.name === 'hello'));
  assert.ok(ctxMod.findSkills(cwd).some((s) => s.name === 'sk'));
  assert.ok(ctxMod.findAgents(cwd).some((a) => a.name === 'rev'));
  assert.ok(styles.find(cwd).has('terse'));
});

test('plugins: duplicate install refused; disable hides, enable restores', async () => {
  assert.equal((await plugins.install(makePlugin(), { readKey: yes })).ok, false);
  assert.equal(plugins.setEnabled('demo', false).ok, true);
  assert.equal(ctxMod.findCommands(cwd).some((c) => c.name === 'hello'), false);
  assert.match(await ext.run('list', {}), /demo 1.0.0 \[disabled\]/);
  plugins.setEnabled('demo', true);
  assert.equal(ctxMod.findCommands(cwd).some((c) => c.name === 'hello'), true);
});

test('plugins: kill switch via cfg.plugins=false and SYZER_PLUGINS=off', () => {
  assert.equal(plugins.enabled({ plugins: false }), false);
  assert.equal(plugins.enabled({}), true);
  process.env.SYZER_PLUGINS = 'off';
  try {
    assert.equal(plugins.enabled({}), false);
    assert.equal(ctxMod.findCommands(cwd).some((c) => c.name === 'hello'), false);
    assert.deepEqual(plugins.active(), []);
  } finally { delete process.env.SYZER_PLUGINS; }
});

test('plugins: manifest validation and unsafe names', async () => {
  const bad = tmp('plug-bad-');
  put(path.join(bad, 'plugin.json'), JSON.stringify({ name: '../evil', version: '1' }));
  assert.equal((await plugins.install(bad, { readKey: yes })).ok, false);
  const nover = tmp('plug-nover-');
  put(path.join(nover, 'plugin.json'), JSON.stringify({ name: 'nover' }));
  assert.match((await plugins.install(nover, { readKey: yes })).error, /version/);
  const none = tmp('plug-none-');
  assert.match((await plugins.install(none, { readKey: yes })).error, /plugin\.json/);
  assert.equal((await plugins.install('--upload-pack=x', {})).ok, false);
  assert.equal((await plugins.install(path.join(os.tmpdir(), 'no-such-dir-xyz'), {})).ok, false);
  assert.equal(plugins.remove('../x').ok, false);
  assert.equal(plugins.setEnabled('..', true).ok, false);
  assert.equal(plugins.validName('a/b'), false);
  assert.equal(plugins.validName('bad name'), false);
  assert.equal(plugins.validName('good-name.1'), true);
});

test('plugins: hooks/mcp require explicit confirmation, are listed, then merge into settings', async () => {
  const d = makePlugin('withexec');
  put(path.join(d, 'hooks.json'), JSON.stringify({ PreToolUse: [{ matcher: 'run_command', hooks: [{ command: 'node ${PLUGIN_ROOT}/check.js' }] }] }));
  put(path.join(d, 'mcp.json'), JSON.stringify({ mcpServers: { srv: { command: 'node', args: ['${PLUGIN_ROOT}/srv.js'] } } }));
  const lines = [];
  assert.equal((await plugins.install(d, { readKey: no, out: (l) => lines.push(l) })).ok, false);
  assert.ok(lines.some((l) => /hook PreToolUse: node/.test(l)));
  assert.ok(lines.some((l) => /mcp srv: node/.test(l)));
  assert.equal(fs.existsSync(path.join(home, 'plugins', 'withexec')), false);
  assert.match((await plugins.install(d, {})).error, /confirmation/);
  assert.equal((await plugins.install(d, { readKey: yes })).ok, true);
  const s = settings.load(cwd);
  const h = s.hooks.PreToolUse.find((x) => /check\.js/.test(x.command));
  assert.ok(h);
  assert.equal(h.matcher, 'run_command');
  assert.ok(h.command.includes(path.join(home, 'plugins', 'withexec')));
  assert.ok(s.mcpServers.srv.args[0].includes('srv.js'));
  assert.ok(!s.mcpServers.srv.args[0].includes('${'));
  plugins.setEnabled('withexec', false);
  assert.equal(settings.load(cwd).mcpServers.srv, undefined);
});

test('plugins: git URL install uses an injected clone and strips .git', async () => {
  let got = null;
  const clone = (url, dest) => {
    got = url;
    put(path.join(dest, 'plugin.json'), JSON.stringify({ name: 'fromgit', version: '0.1.0' }));
    put(path.join(dest, '.git', 'config'), 'x');
  };
  const r = await plugins.install('https://example.com/x/fromgit.git', { clone });
  assert.equal(r.ok, true);
  assert.equal(got, 'https://example.com/x/fromgit.git');
  assert.equal(fs.existsSync(path.join(home, 'plugins', 'fromgit', '.git')), false);
});

test('plugins: symlinks are not copied; remove deletes plugin and state', async () => {
  const d = makePlugin('linky');
  try { fs.symlinkSync(os.tmpdir(), path.join(d, 'escape'), 'junction'); } catch { /* no symlink permission: skip */ }
  assert.equal((await plugins.install(d, { readKey: yes })).ok, true);
  assert.equal(fs.existsSync(path.join(home, 'plugins', 'linky', 'escape')), false);
  plugins.setEnabled('linky', false);
  assert.equal(plugins.remove('linky').ok, true);
  assert.equal(fs.existsSync(path.join(home, 'plugins', 'linky')), false);
  assert.equal(plugins.list().some((p) => p.name === 'linky'), false);
  assert.equal(plugins.remove('linky').ok, false);
});

test('plugins: /plugin usage and unknown subcommand', async () => {
  assert.match(await ext.run('install', {}), /Usage/);
  assert.match(await ext.run('bogus', {}), /Usage/);
});
