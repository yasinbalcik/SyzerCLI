'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const P = require('../src/prompts');
const { LIMITS } = require('../src/limits');
const { execute } = require('../src/tools');
const workers = require('../src/orca-workers');

const session = () => ({
  cwd: process.cwd(),
  settings: { hooks: {}, rules: [], allow: [], deny: [] },
  perm: 'auto',
  plan: false,
  bg: new Map(),
});

test('A5 major: spawn_syzer parse/missing/worker errors use one ERR_ line', async () => {
  const parent = { out: {}, cfg: {}, perm: 'auto' };
  const badJson = await workers.spawnWorker(parent, { arguments: '{' });
  const missing = await workers.spawnWorker(parent, { arguments: '{}' });
  assert.match(badJson.output, /^ERR_INVALID_JSON:/);
  assert.match(missing.output, /^ERR_MISSING_PROMPT:/);
  assert.match(workers.workerFailure('worker failed'), /^ERR_TOOL_FAILED: worker failed$/);
  assert.doesNotMatch(workers.workerFailure('worker failed'), /\n/);
});

test('A5 major: spawn_syzer report clipping follows LIMITS.subagentReport', () => {
  const report = workers.clipWorkerReport('x'.repeat(LIMITS.subagentReport + 1));
  assert.strictEqual(report, `${'x'.repeat(LIMITS.subagentReport)}\n…(truncated)`);
});

test('A5 major: MCP and shell failures are one standard ERR_ line', async () => {
  const mcpSession = session();
  mcpSession.mcp = { call: async () => ({ ok: false, text: 'first line\nsecond line' }) };
  const mcp = await execute({ name: 'mcp__demo__broken', arguments: '{}' }, mcpSession);
  assert.match(mcp.output, /^ERR_TOOL_FAILED:/);
  assert.doesNotMatch(mcp.output, /\n/);

  const shell = await execute({ name: 'run_command', arguments: JSON.stringify({ command: 'Write-Output first; Write-Output second; exit 1' }) }, session());
  assert.match(shell.output, /^ERR_TOOL_FAILED:/);
  assert.doesNotMatch(shell.output, /\n/);
});

test('A5 minor: leadSystem defaults never render undefined or object placeholders', () => {
  const out = P.leadSystem({});
  assert.doesNotMatch(out, /undefined|\[object Object\]/);
});

test('A5 minor: Turkish subagent hierarchy explanation is Turkish', () => {
  const out = P.subagentSystem({
    ctx: { header: 'başlık', files: [] },
    agent: { name: 'general', prompt: 'görev' },
    language: 'tr',
  });
  assert.doesNotMatch(out, /You are a subagent|You cannot ask the user questions|Finish the task/);
  assert.match(out, /alt ajan|kullanıcıya soru soramaz|görevi bitir/i);
});

test('A5 minor: tool output clipping uses the shared truncation suffix', async () => {
  const out = await execute({ name: 'run_command', arguments: JSON.stringify({ command: "Write-Output ('x' * 21000)" }) }, session());
  assert.match(out.output, /…\(truncated\)/);
  assert.doesNotMatch(out.output, /…\(truncated \d+ chars\)/);
});
