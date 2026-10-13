'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quotaGuide } = require('../src/quota-guide');

test('guides for each quota-related HTTP error in English', () => {
  for (const [status, word] of [[402, 'credit'], [403, 'access'], [429, 'limit']]) {
    const guide = quotaGuide({ status, message: 'secret upstream response' }, 'en', { provider: 'openrouter' });
    assert.equal(guide.code, `HTTP_${status}`);
    assert.match(guide.message, new RegExp(word, 'i'));
    assert.deepEqual(guide.actions, ['syzer key add', 'syzer usage', 'syzer provider nvidia']);
    assert.doesNotMatch(guide.message, /secret upstream/i);
  }
});

test('prioritizes an exhausted key pool and emits Turkish guidance', () => {
  const guide = quotaGuide(new Error('ignored'), 'tr', { allKeysExhausted: true, provider: 'nvidia' });
  assert.equal(guide.code, 'KEYS_EXHAUSTED');
  assert.match(guide.message, /anahtar/i);
  assert.ok(guide.actions.includes('syzer key add'));
  assert.ok(guide.actions.includes('syzer usage'));
  assert.ok(guide.actions.includes('syzer provider openrouter'));
});

test('does not guide unrelated errors', () => {
  assert.equal(quotaGuide({ status: 500 }, 'en'), null);
});
