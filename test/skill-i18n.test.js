const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { translate, parseList } = require('../src/skill-i18n');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skill-i18n-'));

test('skill-i18n: translates once, then serves from cache without calling the model', async () => {
  const dir = tmp();
  let calls = 0;
  const ask = async (prompt) => { calls++; const arr = JSON.parse(prompt.slice(prompt.indexOf('['))); return JSON.stringify(arr.map((x) => `TR:${x}`)); };
  assert.deepEqual(await translate(['Read files', '', 'Run tests'], 'tr', { dir, ask }), ['TR:Read files', '', 'TR:Run tests']);
  assert.equal(calls, 1);
  assert.deepEqual(await translate(['Run tests', 'Read files'], 'tr', { dir, ask }), ['TR:Run tests', 'TR:Read files']);
  assert.equal(calls, 1);
});

test('skill-i18n: bad model output or failure falls back to the original text', async () => {
  const dir = tmp();
  assert.deepEqual(await translate(['a', 'b'], 'tr', { dir, ask: async () => 'sorry, no' }), ['a', 'b']);
  assert.deepEqual(await translate(['a'], 'tr', { dir, ask: async () => { throw new Error('429'); } }), ['a']);
  assert.equal(fs.existsSync(path.join(dir, 'skill-i18n.tr.json')), false);
});

test('skill-i18n: unsupported language is a no-op', async () => {
  let calls = 0;
  assert.deepEqual(await translate(['x'], 'en', { dir: tmp(), ask: async () => { calls++; return '[]'; } }), ['x']);
  assert.equal(calls, 0);
});

test('skill-i18n: parseList requires the exact count of strings', () => {
  assert.deepEqual(parseList('ok: ["a","b"]', 2), ['a', 'b']);
  assert.equal(parseList('["a"]', 2), null);
  assert.equal(parseList('[1,2]', 2), null);
});
