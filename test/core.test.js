'use strict';
const test = require('node:test');
const assert = require('node:assert');
const providers = require('../src/providers');
const keys = require('../src/keys');
const { cmpVer } = require('../src/updater');
const { toMarkdown } = require('../src/export');

const OR = `sk-or-v1-${'a'.repeat(64)}`;
const NV = `nvapi-${'B'.repeat(64)}`;

test('provider detection from key format', () => {
  assert.strictEqual(providers.detect(OR).id, 'openrouter');
  assert.strictEqual(providers.detect(NV).id, 'nvidia');
  assert.strictEqual(providers.detect('hello'), null);
});

test('parseKeys splits mixed lists, dedupes and reports malformed keys', () => {
  const r = keys.parseKeys(`${OR}\n${NV}, ${OR}\nsk-or-v1-short`);
  assert.deepStrictEqual(r.valid.map((k) => k.provider).sort(), ['nvidia', 'openrouter']);
  assert.ok(r.invalid.includes('sk-or-v1-short'));
});

test('mask never shows the full key', () => {
  const m = keys.mask(OR);
  assert.ok(m.length < OR.length && !m.includes(OR.slice(15, 40)));
});

test('cmpVer orders versions numerically', () => {
  assert.strictEqual(cmpVer('3.10.0', '3.9.0'), 1);
  assert.strictEqual(cmpVer('v3.16.1', '3.16.1'), 0);
  assert.strictEqual(cmpVer('3.2.9', '3.3.0'), -1);
});

test('toMarkdown renders a session and skips system messages', () => {
  const md = toMarkdown({ id: 'x', title: 'T', model: 'm', cwd: '/c', ts: 0, messages: [{ role: 'system', content: 'SECRET' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] });
  assert.ok(md.includes('# T') && md.includes('hi') && md.includes('yo') && !md.includes('SECRET'));
});
