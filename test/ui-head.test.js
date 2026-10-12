'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { head, trunc } = require('../src/ui');

test('head keeps the beginning and only collapses whitespace', () => {
  assert.strictEqual(head('src/agent.js dosyasını oku ve ana döngüyü 5 maddede özetle', 70), 'src/agent.js dosyasını oku ve ana döngüyü 5 maddede özetle');
  assert.strictEqual(head('a  b\n\tc', 20), 'a b c');
  assert.strictEqual(head('sss sss', 20), 'sss sss'); // harfler (s) bozulmamalı
});

test('head truncates at the end with an ellipsis and respects the limit', () => {
  const r = head('x'.repeat(100), 10);
  assert.strictEqual(r.length, 10);
  assert.ok(r.endsWith('…'));
  assert.ok(r.startsWith('xxxxxxxxx'));
});

test('trunc still keeps the tail (file paths) so the two helpers differ on purpose', () => {
  assert.strictEqual(trunc('0123456789', 5), '…6789');
  assert.strictEqual(head('0123456789', 5), '0123…');
});
