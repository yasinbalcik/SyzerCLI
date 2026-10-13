'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { complete } = require('../src/complete');
const { Editor } = require('../src/input');

const context = {
  commands: ['/help', '/model', '/lang', '/perm', '/provider', '/effort'],
  models: ['openrouter/alpha', 'OpenAI/beta'],
  languages: ['tr', 'en'],
  permissions: ['ask', 'auto', 'readonly'],
  providers: ['openrouter', 'nvidia'],
  efforts: ['auto', 'high'],
  files: ['src/input.js', 'src/repl.js', 'README.md'],
};

test('completes a slash command and reports its token range', () => {
  assert.deepEqual(complete('/mo', 3, context), {
    candidates: ['/model'], range: { start: 0, end: 3 },
  });
});

test('completes supported first command arguments case-insensitively', () => {
  assert.deepEqual(complete('/model OPEN', 11, context), {
    candidates: ['OpenAI/beta', 'openrouter/alpha'], range: { start: 7, end: 11 },
  });
  assert.deepEqual(complete('/lang ', 6, context), {
    candidates: ['en', 'tr'], range: { start: 6, end: 6 },
  });
  assert.deepEqual(complete('/perm au', 8, context), {
    candidates: ['auto'], range: { start: 6, end: 8 },
  });
});

test('completes an @ file token without touching the filesystem', () => {
  assert.deepEqual(complete('review @src/in now', 14, context), {
    candidates: ['@src/input.js'], range: { start: 7, end: 14 },
  });
});

test('uses the active token range for unsupported arguments and clamps cursors', () => {
  assert.deepEqual(complete('/model alpha extra', 18, context), {
    candidates: [], range: { start: 13, end: 18 },
  });
  assert.deepEqual(complete('/zz', 99, context), {
    candidates: [], range: { start: 0, end: 3 },
  });
});

test('deduplicates context candidates without coercing malformed values', () => {
  const result = complete('/lang ', 6, { languages: ['EN', 'en', 'tr', null] });
  assert.deepEqual(result.candidates, ['EN', 'tr']);
});

test('Editor applies the returned replacement range without rewriting nearby input', () => {
  const editor = new Editor({ input: { on() {}, off() {} }, output: { isTTY: false, write() {} }, complete: (line, cursor) => complete(line, cursor, context) });
  editor.items = [...'/lang e later'];
  editor.cur = 7;
  editor._tab();
  assert.equal(editor.items.join(''), '/lang en later');
  assert.equal(editor.cur, 8);
});

test('cursor in the middle only replaces the token prefix and preserves its suffix', () => {
  const result = complete('/model opXYZ', 9, context);
  assert.deepEqual(result, { candidates: ['OpenAI/beta', 'openrouter/alpha'], range: { start: 7, end: 9 } });
});
