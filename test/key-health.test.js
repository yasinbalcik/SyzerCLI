'use strict';
// Key sağlık takibi: soğuma, seçim sırası, stats ve doctor bölümleri (enjekte saat/fs).
const test = require('node:test');
const assert = require('node:assert');

const H = require('../src/key-health');
const { keyPoolRows, orcaDoctorRows } = require('../src/doctor');
const orca = require('../src/orca-bridge');

function memFs() {
  const files = {};
  return {
    files,
    readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFileSync: (p, d) => { files[p] = String(d); },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    mkdirSync: () => {},
  };
}
const mk = () => { const fsImpl = memFs(); const clock = { t: 1_000_000 }; return { clock, fsImpl, h: H.create({ file: '/h.json', now: () => clock.t, fsImpl }) }; };
const E = (key) => ({ key });

test('classify maps statuses and network errors', () => {
  assert.strictEqual(H.classify(429, 'x'), '429');
  assert.strictEqual(H.classify(503, 'network: ECONNRESET'), 'network');
  assert.strictEqual(H.classify(504, 'stalled'), '5xx');
  assert.strictEqual(H.classify(400, 'bad'), null);
});

test('cool-down grows 30s -> 2m -> 10m (cap) and resets on success', () => {
  const { h, clock } = mk();
  const left = () => h.stats('p', 'k').coolLeft;
  h.recordOutcome('p', 'k', '429'); assert.strictEqual(left(), 30e3);
  h.recordOutcome('p', 'k', '5xx'); assert.strictEqual(left(), 120e3);
  h.recordOutcome('p', 'k', '429'); assert.strictEqual(left(), 600e3);
  h.recordOutcome('p', 'k', '429'); assert.strictEqual(left(), 600e3);
  clock.t += 601e3; assert.strictEqual(h.isCooling('p', 'k'), false);
  h.recordOutcome('p', 'k', '429'); h.recordOutcome('p', 'k', 'ok');
  assert.strictEqual(left(), 0);
  assert.strictEqual(h.stats('p', 'k').streak, 0);
});

test('network/401 do not start a cool-down; history is capped at 20', () => {
  const { h } = mk();
  h.recordOutcome('p', 'k', 'network'); h.recordOutcome('p', 'k', '401');
  assert.strictEqual(h.isCooling('p', 'k'), false);
  for (let i = 0; i < 30; i++) h.recordOutcome('p', 'k', 'ok');
  assert.strictEqual(h.stats('p', 'k').samples, 20);
});

test('rank: no stats keeps order; cooling keys go last; lower failure rate first', () => {
  const { h, clock } = mk();
  const list = [E('a'), E('b'), E('c')];
  assert.deepStrictEqual(h.rank('p', list, (k) => k), list);
  h.recordOutcome('p', 'a', '429'); // a cooling
  assert.deepStrictEqual(h.rank('p', list, (k) => k).map((e) => e.key), ['b', 'c', 'a']);
  clock.t += 31e3; // a cooled down, but failure rate (1/1) < MIN_SAMPLES => 0
  assert.deepStrictEqual(h.rank('p', list, (k) => k).map((e) => e.key), ['a', 'b', 'c']);
  for (let i = 0; i < 4; i++) h.recordOutcome('p', 'a', '401');
  for (let i = 0; i < 4; i++) h.recordOutcome('p', 'b', 'ok');
  clock.t += 1e6;
  assert.deepStrictEqual(h.rank('p', list, (k) => k).map((e) => e.key), ['b', 'c', 'a']);
});

test('never writes full keys and never throws on broken fs', () => {
  const { h, fsImpl } = mk();
  h.recordOutcome('openrouter', 'sk-or-v1-…abcd', 'ok');
  assert.ok(!/sk-or-v1-[a-z0-9]{20}/.test(fsImpl.files['/h.json']));
  const bad = H.create({ file: '/x', fsImpl: { readFileSync() { throw new Error('x'); }, writeFileSync() { throw new Error('x'); }, mkdirSync() { throw new Error('x'); } } });
  assert.doesNotThrow(() => bad.recordOutcome('p', 'k', '429'));
  assert.deepStrictEqual(bad.rank('p', [E('a')], (k) => k).length, 1);
});

test('doctor key pool rows: ready/total, cooling, worst rate', () => {
  const rows = keyPoolRows({ providers: [
    { id: 'openrouter', keys: [{ state: 'ready', cooldownSec: 0, failRate: 0.1 }, { state: 'ready', cooldownSec: 20, failRate: 0.6 }, { state: 'off', cooldownSec: 0, failRate: 0 }] },
    { id: 'nvidia', keys: [] },
  ] });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].level, 'warn');
  assert.match(rows[0].detail, /1\/3 hazır, 1 soğumada.*%60/);
});

test('doctor orca rows: groups applied/skipped with reasons and version vs latest', () => {
  const d = { exitCode: 2, groups: [{ id: 'main', applied: true }, { id: 'ui', applied: false, reason: 'anchor missing' }] };
  const rows = orcaDoctorRows(d, { version: '1.1.0', latest: '1.2.0', cmpVer: require('../src/updater').cmpVer });
  assert.strictEqual(rows[0].level, 'warn');
  assert.match(rows[0].detail, /v1\.1\.0.*v1\.2\.0/);
  assert.strictEqual(rows[1].level, 'ok');
  assert.match(rows[2].detail, /atlandı: anchor missing/);
  assert.strictEqual(orcaDoctorRows({ error: 'timeout' })[0].level, 'warn');
  assert.deepStrictEqual(orcaDoctorRows(null), []);
});

test('orca-bridge doctorJson: mocked spawn, parse + timeout handling', () => {
  const prev = process.env.SYZER_ORCA_PLUGIN_DIR;
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'syzer-orca.js'), '');
  process.env.SYZER_ORCA_PLUGIN_DIR = dir;
  try {
    const ok = orca.doctorJson({ spawn: () => ({ status: 2, stdout: '{"groups":[{"id":"a","applied":false}]}' }) });
    assert.strictEqual(ok.exitCode, 2);
    assert.strictEqual(ok.groups[0].id, 'a');
    assert.match(orca.doctorJson({ spawn: () => ({ error: { code: 'ETIMEDOUT' } }) }).error, /timeout/);
    assert.ok(orca.doctorJson({ spawn: () => ({ stdout: 'nope', stderr: '' }) }).error);
  } finally {
    if (prev === undefined) delete process.env.SYZER_ORCA_PLUGIN_DIR; else process.env.SYZER_ORCA_PLUGIN_DIR = prev;
  }
});
