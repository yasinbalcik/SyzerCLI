'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonAtomic } = require('../src/atomic-json');

test('atomic JSON: writes parseable 2-space JSON with mode and no temp residue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-atomic-'));
  const file = path.join(dir, 'config.json');
  writeJsonAtomic(file, { answer: 42 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { answer: 42 });
  assert.match(fs.readFileSync(file, 'utf8'), /\n  "answer": 42\n/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('atomic JSON: retries EPERM/EBUSY with injected delays and preserves old file on permanent failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-atomic-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"old":true}');
  let renames = 0;
  const delays = [];
  const injected = {
    ...fs,
    renameSync(from, to) {
      renames++;
      if (renames < 4) { const e = new Error('busy'); e.code = renames === 2 ? 'EBUSY' : 'EPERM'; throw e; }
      return fs.renameSync(from, to);
    },
  };
  writeJsonAtomic(file, { fresh: true }, { fsImpl: injected, sleepSync: (ms) => delays.push(ms) });
  assert.equal(renames, 4);
  assert.deepEqual(delays, [0, 25, 50, 100]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { fresh: true });

  const failed = { ...fs, renameSync() { const e = new Error('denied'); e.code = 'EPERM'; throw e; } };
  assert.throws(() => writeJsonAtomic(file, { never: true }, { fsImpl: failed, sleepSync() {} }), /denied/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { fresh: true });
});

test('atomic JSON: serialization failure does not touch target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-atomic-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"keep":1}');
  const value = {}; value.self = value;
  assert.throws(() => writeJsonAtomic(file, value), TypeError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"keep":1}');
});

test('atomic JSON: unserializable root values preserve the existing target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-atomic-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"keep":1}');
  for (const value of [undefined, () => {}, Symbol('value')]) {
    assert.throws(() => writeJsonAtomic(file, value), TypeError);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"keep":1}');
  }
});

test('atomic JSON: default retry sleep uses Atomics.wait instead of spinning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-atomic-'));
  const file = path.join(dir, 'config.json');
  const originalWait = Atomics.wait;
  const waits = [];
  let renames = 0;
  const injected = {
    ...fs,
    renameSync(from, to) {
      if (renames++ === 0) { const err = new Error('busy'); err.code = 'EPERM'; throw err; }
      return fs.renameSync(from, to);
    },
  };
  Atomics.wait = (...args) => { waits.push(args[3]); return 'timed-out'; };
  try {
    writeJsonAtomic(file, { fresh: true }, { fsImpl: injected });
  } finally {
    Atomics.wait = originalWait;
  }
  assert.deepEqual(waits, [25]);
});
