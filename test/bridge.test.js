'use strict';
// `syzer orca ...` köprüsü: argümanlar eklentiye aynen iletilir, Orca'nın çağıracağı Syzer komutu SYZER_CLI_CMD olarak verilir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'syzer.js');

function fakePlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-plugin-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'syzer-orca', version: '9.9.9' }));
  fs.writeFileSync(path.join(dir, 'bin', 'syzer-orca.js'), 'console.log(JSON.stringify({ args: process.argv.slice(2), cmd: process.env.SYZER_CLI_CMD })); process.exit(Number(process.env.FAKE_EXIT || 0));');
  return dir;
}

const run = (dir, args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, SYZER_ORCA_PLUGIN_DIR: dir, SYZER_NO_UPDATE: '1', ...env } });

test('syzer orca forwards arguments and the CLI command to the plugin', () => {
  const dir = fakePlugin();
  try {
    const r = run(dir, ['orca', 'patch', '--dry-run', '--quiet']);
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(out.args, ['patch', '--dry-run', '--quiet']);
    assert.ok(out.cmd.includes('bin') && out.cmd.includes('syzer.js'), out.cmd);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syzer orca propagates the plugin exit code', () => {
  const dir = fakePlugin();
  try {
    assert.strictEqual(run(dir, ['orca', 'status'], { FAKE_EXIT: '3' }).status, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('syzer orca fails clearly when the plugin directory is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-noplugin-'));
  try {
    assert.notStrictEqual(run(dir, ['orca', 'status']).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
