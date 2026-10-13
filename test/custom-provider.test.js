'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SYZER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-cp-'));
const providers = require('../src/providers');
const config = require('../src/config');

test('addCustom validates and persists an OpenAI-compatible provider', () => {
  assert.throws(() => providers.addCustom({ id: 'openrouter', base: 'http://x/v1' }), /builtin/);
  assert.throws(() => providers.addCustom({ id: 'Bad Id', base: 'http://x/v1' }), /bad id/);
  assert.throws(() => providers.addCustom({ id: 'ok', base: 'ftp://x' }), /bad url/);
  const rec = providers.addCustom({ id: 'lightning', base: 'https://abc.litng.ai/v1/', model: 'qwen2.5-coder:32b' });
  assert.strictEqual(rec.base, 'https://abc.litng.ai/v1');
  const p = providers.PROVIDERS.lightning;
  assert.ok(p.custom);
  assert.strictEqual(p.defaultModel, 'qwen2.5-coder:32b');
  assert.deepStrictEqual(p.reasoning('off'), {});
  assert.deepStrictEqual(p.reasoning('high'), { reasoning_effort: 'high' });
  assert.ok(JSON.parse(fs.readFileSync(providers.customFile(), 'utf8')).providers.some((x) => x.id === 'lightning'));
});

test('custom provider never claims pasted keys', () => {
  assert.strictEqual(providers.detect('sk-or-v1-' + 'a'.repeat(64)).id, 'openrouter');
  assert.strictEqual(providers.detect('random-token-123'), null);
});

test('config can switch to a custom provider and back; remove deletes it', () => {
  config.saveKeys('lightning', { active: 0, keys: [{ key: 'no-key' }] });
  const cfg = config.load();
  config.switchProvider(cfg, 'lightning');
  assert.strictEqual(cfg.model, 'qwen2.5-coder:32b');
  assert.strictEqual(cfg.keys.length, 1);
  assert.strictEqual(config.load().provider, 'lightning');
  config.switchProvider(cfg, 'openrouter');
  assert.ok(providers.removeCustom('lightning'));
  assert.strictEqual(providers.PROVIDERS.lightning, undefined);
  assert.throws(() => providers.removeCustom('nvidia'), /builtin/);
});

test('textToolCalls turns plain-text tool calls from local models into real calls', () => {
  const { textToolCalls } = require('../src/api');
  const tools = [{ type: 'function', function: { name: 'read_file' } }, { type: 'function', function: { name: 'list_dir' } }];
  const one = textToolCalls('{"name": "read_file", "arguments": {"path": "README.md"}}', tools);
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].name, 'read_file');
  assert.deepStrictEqual(JSON.parse(one[0].arguments), { path: 'README.md' });
  const two = textToolCalls('<tool_call>\n{"name":"read_file","arguments":{"path":"a"}}\n</tool_call>\n<tool_call>\n{"name":"list_dir","arguments":{}}\n</tool_call>', tools);
  assert.deepStrictEqual(two.map((c) => c.name), ['read_file', 'list_dir']);
  assert.strictEqual(textToolCalls('```json\n{"name":"list_dir","arguments":{"path":"."}}\n```', tools).length, 1);
  assert.strictEqual(textToolCalls('{"name": "rm_rf", "arguments": {}}', tools), null);
  assert.strictEqual(textToolCalls('Here is the JSON: {"a":1}', tools), null);
  assert.strictEqual(textToolCalls('{"a": 1}', tools), null);
});

test('textToolCalls finds calls after prose and keeps the prose', () => {
  const { textToolCalls } = require('../src/api');
  const tools = [{ type: 'function', function: { name: 'run_command' } }];
  const r = textToolCalls('Önce kurulumu yapalım.\n\n{"name": "run_command", "arguments": {"command": "echo {hi}"}}', tools, { withRest: true });
  assert.strictEqual(r.calls.length, 1);
  assert.deepStrictEqual(JSON.parse(r.calls[0].arguments), { command: 'echo {hi}' });
  assert.strictEqual(r.rest, 'Önce kurulumu yapalım.');
  assert.strictEqual(textToolCalls('Örnek: {"name": "x", "arguments": {}}', tools), null);
});

test('simple mode limits tools, disables spawning and uses the short prompt', () => {
  providers.addCustom({ id: 'mini', base: 'http://localhost:11434/v1', model: 'm', simple: true });
  providers.setCurrent('mini');
  const { createSession, SIMPLE_TOOLS } = require('../src/session');
  const { toolDefsFor } = require('../src/tools');
  const s = createSession({ model: 'm', permissions: 'ask' }, { cwd: process.cwd() });
  const names = toolDefsFor(s).map((d) => d.function.name).sort();
  assert.deepStrictEqual(names, [...SIMPLE_TOOLS].sort());
  assert.strictEqual(s.canSpawn, false);
  assert.match(s.messages[0].content, /\[SIMPLE\]/);
  providers.setSimple('mini', false);
  providers.setCurrent('mini');
  const s2 = createSession({ model: 'm', permissions: 'ask' }, { cwd: process.cwd() });
  assert.ok(toolDefsFor(s2).length > SIMPLE_TOOLS.length);
  providers.removeCustom('mini');
  providers.setCurrent('openrouter');
});
