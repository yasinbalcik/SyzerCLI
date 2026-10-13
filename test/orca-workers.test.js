'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const workers = require('../src/orca-workers');

test('worker result wait fails promptly when its Orca terminal has exited', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-worker-'));
  const outFile = path.join(dir, 'result.txt');
  let sleeps = 0;
  await assert.rejects(
    workers.waitForWorkerResult(outFile, 'term-1', {
      probe: async () => ({ state: 'exited', exitCode: 1 }),
      sleep: async () => { sleeps++; },
      pollMs: 0,
      deadlineMs: 1000,
    }),
    (err) => err.code === 'WORKER_EXITED' && /term-1/.test(err.message),
  );
  assert.equal(sleeps, 0, 'must not spend the legacy 15-minute wait after exit');
});

test('worker result wait remains compatible when terminal status is unavailable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-worker-'));
  const outFile = path.join(dir, 'result.txt');
  let probes = 0;
  const report = await workers.waitForWorkerResult(outFile, 'term-2', {
    probe: async () => { probes++; return { state: 'unknown' }; },
    sleep: async () => fs.writeFileSync(outFile, 'done'),
    pollMs: 0,
    settleMs: 0,
    deadlineMs: 1000,
  });
  assert.equal(report, 'done');
  assert.equal(probes, 1);
});

test('worker failure preserves the ERR contract after an early exit', () => {
  assert.match(workers.workerFailure('worker exited before writing result'), /^ERR_TOOL_FAILED: /);
});
