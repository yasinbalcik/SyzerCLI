'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute } = require('../src/tools');

function session(cwd, extra = {}) {
  return { cwd, perm: 'auto', canAsk: false, plan: false, settings: { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [] } }, ...extra };
}

test('tools: headless auto write outside workspace returns ERR_E_OUTSIDE_WORKSPACE', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-tools-'));
  const outside = path.join(path.dirname(cwd), `syzer-out-${Date.now()}.txt`);
  const result = await execute({ name: 'write_file', arguments: JSON.stringify({ path: outside, content: 'secret' }) }, session(cwd));
  assert.equal(result.ok, false);
  assert.match(result.output, /^ERR_E_OUTSIDE_WORKSPACE:/);
  assert.equal(fs.existsSync(outside), false);
});

test('tools: allow rule cannot bypass headless workspace guard; read remains unaffected', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-tools-'));
  const outside = path.join(path.dirname(cwd), `syzer-out-${Date.now()}-2.txt`);
  const result = await execute({ name: 'write_file', arguments: JSON.stringify({ path: outside, content: 'x' }) }, session(cwd, { settings: { allow: ['Write(*)'], deny: [], hooks: { PreToolUse: [], PostToolUse: [] } } }));
  assert.match(result.output, /^ERR_E_OUTSIDE_WORKSPACE:/);
  assert.equal(fs.existsSync(outside), false);
});
