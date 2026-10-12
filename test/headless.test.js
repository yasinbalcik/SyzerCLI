'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/headless');

test('exitCodeFor: öncelik ve eşleme', () => {
  assert.strictEqual(H.exitCodeFor({}), 0);
  assert.strictEqual(H.exitCodeFor({ error: 'x' }), 1);
  assert.strictEqual(H.exitCodeFor({ usageError: true, error: 'x' }), 2);
  assert.strictEqual(H.exitCodeFor({ budgetExceeded: 'limit' }), 3);
  assert.strictEqual(H.exitCodeFor({ denied: true }), 4);
  assert.strictEqual(H.exitCodeFor({ interrupted: true, error: 'x' }), 130);
  assert.strictEqual(H.exitCodeFor({ timedOut: true, error: 'TIMEOUT' }), 1);
  assert.strictEqual(H.exitCodeFor({ budgetExceeded: 'l', denied: true }), 3);
});

test('resolvePromptSource: öncelik', () => {
  const r = (o) => H.resolvePromptSource(o);
  assert.strictEqual(r({ promptFile: 'a', prompt: 'b', positional: ['c'], stdinIsTTY: false }).source, 'file');
  assert.strictEqual(r({ promptFile: 'a', stdinIsTTY: false }).readStdin, false); // CI'da asılma yok
  assert.strictEqual(r({ promptFile: 'a', positional: ['-'], stdinIsTTY: false }).readStdin, true);
  assert.strictEqual(r({ prompt: 'b', positional: ['c'], stdinIsTTY: true }).source, 'flag');
  assert.strictEqual(r({ prompt: 'b', positional: ['c'], stdinIsTTY: true }).args, 'b c');
  assert.strictEqual(r({ positional: ['merhaba', 'dunya'], stdinIsTTY: true }).source, 'args');
  assert.strictEqual(r({ positional: ['-'], stdinIsTTY: false }).source, 'stdin');
  assert.strictEqual(r({ stdinIsTTY: false }).source, 'stdin');
  assert.deepStrictEqual(r({ stdinIsTTY: true }), { source: 'none', readStdin: false, args: '' });
  assert.strictEqual(H.joinPrompt('a', ' b '), 'a\n\nb');
  assert.strictEqual(H.joinPrompt('', 'b'), 'b');
});

test('buildResult: tek JSON nesnesi, eski alanlar korunur', () => {
  const ok = H.buildResult({ content: 'hi', exitCode: 0, sessionId: 's1', tokens: 10, toolTurns: 2, ms: 1500, changed: ['/a'], model: 'm', key: 1 });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.result, 'hi');
  assert.strictEqual(ok.content, 'hi');
  assert.deepStrictEqual(ok.session, { id: 's1' });
  assert.deepStrictEqual(ok.usage, { tokens: 10, toolTurns: 2, seconds: 1.5 });
  assert.deepStrictEqual(ok.files, { changed: ['/a'] });
  assert.strictEqual('error' in ok, false);
  const bad = H.buildResult({ content: '', error: 'TIMEOUT', exitCode: 1, timedOut: true, changed: null });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error, 'TIMEOUT');
  assert.strictEqual('files' in bad, false);
  const b = H.buildResult({ content: 'x', budgetExceeded: 'tokens', exitCode: 3 });
  assert.strictEqual(b.budgetExceeded, 'tokens');
  JSON.parse(JSON.stringify(b));
});

test('outBody: ERROR: sözleşmesi', () => {
  assert.strictEqual(H.outBody({ error: 'TIMEOUT' }), 'ERROR: TIMEOUT');
  assert.strictEqual(H.outBody({ content: '' }), '(no output)');
  assert.match(H.outBody({ content: 'x', budgetExceeded: 'l' }), /^BUDGET EXCEEDED: l\n\nx$/);
});

test('parseTimeoutMs', () => {
  assert.strictEqual(H.parseTimeoutMs(undefined), null);
  assert.strictEqual(H.parseTimeoutMs('2'), 120000);
  assert.strictEqual(H.parseTimeoutMs('0.5'), 30000);
  assert.strictEqual(H.parseTimeoutMs('abc'), undefined);
  assert.strictEqual(H.parseTimeoutMs('-1'), undefined);
});

test('headlessConfirm bloklamaz: -y izin, aksi ret', async () => {
  assert.strictEqual(await H.headlessConfirm(true)('write_file', 's', ''), 'yes');
  assert.strictEqual(await H.headlessConfirm(false)('write_file', 's', ''), 'no');
});

test('isDenial ve changedFiles', () => {
  assert.strictEqual(H.isDenial('Blocked: read-only mode.', ['Blocked: read-only mode.', 'x']), true);
  assert.strictEqual(H.isDenial('ok', ['Blocked: read-only mode.']), false);
  const store = { list: (id) => (id === 'a' ? [{ files: [{ path: '/x' }, { path: '/y' }] }, { files: [{ path: '/x' }] }] : []) };
  assert.deepStrictEqual(H.changedFiles(store, ['a', 'b', null]).sort(), ['/x', '/y']);
  assert.strictEqual(H.changedFiles({ list() { throw new Error('x'); } }, ['a']), null);
});
