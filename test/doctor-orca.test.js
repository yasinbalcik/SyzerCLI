'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { orcaDoctorRows, orcaStatusRows } = require('../src/doctor');
const { patchWarning } = require('../src/orca-bridge');

test('doctor explains a zero-match anchor and the lost feature', () => {
  const rows = orcaDoctorRows({ groups: [{ id: 'history', applied: false, reason: 'anchor matched 0x' }] });
  assert.equal(rows[0].level, 'warn');
  assert.match(rows[0].detail, /anchor.*0x/i);
  assert.match(rows[0].detail, /özellik.*devre dışı/i);
});

test('doctor calls a missing or stale patch out after an Orca update', () => {
  const lost = orcaStatusRows({ found: true, patched: false, upToDate: false, orcaVersion: '2.0.0' }, '1.4.0');
  assert.equal(lost[0].level, 'warn');
  assert.match(lost[0].detail, /güncelleme.*düşmüş|düşmüş.*güncelleme/i);
  assert.match(lost[0].detail, /syzer orca patch/);
  assert.match(patchWarning({ found: true, patched: false, upToDate: false }), /düşmüş/);
});
