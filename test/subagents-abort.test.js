'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('../src/subagents');

test('subagent limiter: queued AbortSignal rejects immediately and never starts work', async () => {
  const { limited, gate } = createLimiter();
  let release;
  const first = limited(1, () => new Promise((resolve) => { release = resolve; }));
  const ctl = new AbortController();
  let ran = false;
  const queued = limited(1, () => { ran = true; }, ctl.signal);
  assert.equal(gate.waiters.length, 1);
  ctl.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(gate.waiters.length, 0);
  release();
  await first;
  assert.equal(ran, false);
});

test('subagent limiter: an already aborted signal does not consume capacity', async () => {
  const { limited, gate } = createLimiter();
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(limited(1, () => assert.fail('must not run'), ctl.signal), { name: 'AbortError' });
  assert.equal(gate.active, 0);
  assert.equal(gate.waiters.length, 0);
});
