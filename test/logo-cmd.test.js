'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { t, setLang } = require('../src/i18n');

const root = path.join(__dirname, '..');
const KEYS = ['splash_hint'];

test('splash i18n keys: filled, tr differs from en, de falls back to en', () => {
  try {
    for (const k of KEYS) {
      setLang('en'); const en = t(k);
      setLang('tr'); const tr = t(k);
      setLang('de'); const de = t(k);
      assert.ok(en && en !== k, k + ' en');
      assert.ok(tr && tr !== k, k + ' tr');
      assert.notStrictEqual(tr, en, k + ' tr != en');
      assert.strictEqual(de, en, k + ' de falls back to en');
    }
  } finally { setLang('en'); }
});

test('package version 3.25.0 and scripts.test lists every test file', () => {
  const pkg = require('../package.json');
  assert.strictEqual(pkg.version, '3.25.0');
  const lock = require('../package-lock.json');
  assert.strictEqual(lock.version, '3.25.0');
  assert.strictEqual(lock.packages[''].version, '3.25.0');
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js'))) {
    assert.ok(pkg.scripts.test.includes('test/' + f), f + ' missing from scripts.test');
  }
});
