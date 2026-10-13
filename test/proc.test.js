'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const proc = require('../src/proc');

function child(pid = 71) {
  const c = new EventEmitter();
  c.pid = pid;
  c.exitCode = null;
  return c;
}

test('proc: Windows shell prefers pwsh and makes console and pipeline UTF-8', () => {
  let seen;
  proc.spawnShell('Write-Output şığ', 'C:/work', {
    platform: 'win32', findPwsh: () => true,
    spawnImpl: (...args) => { seen = args; return child(); },
  });
  assert.equal(seen[0], 'pwsh.exe');
  assert.deepEqual(seen[1].slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(seen[1][3], /Console\]::InputEncoding/);
  assert.match(seen[1][3], /Console\]::OutputEncoding/);
  assert.match(seen[1][3], /\$OutputEncoding/);
  assert.match(seen[1][3], /Write-Output şığ$/);
  assert.equal(seen[2].cwd, 'C:/work');
});

test('proc: POSIX shell is detached and tree close escalates group TERM to KILL', () => {
  let opts;
  proc.spawnShell('sleep 1', '/work', { platform: 'linux', spawnImpl: (_cmd, _args, o) => { opts = o; return child(); } });
  assert.equal(opts.detached, true);

  const calls = [];
  let scheduled;
  const c = child(88);
  proc.killTree(c, {
    platform: 'linux', killImpl: (...args) => calls.push(args),
    setTimeoutImpl: (fn, ms) => { scheduled = { fn, ms, unref() {} }; return scheduled; },
  });
  assert.deepEqual(calls, [[-88, 'SIGTERM']]);
  assert.equal(scheduled.ms, 1000);
  scheduled.fn();
  assert.deepEqual(calls, [[-88, 'SIGTERM'], [-88, 'SIGKILL']]);
});

test('proc: Windows taskkill targets the entire tree and consumes async launch errors', () => {
  const taskkill = child();
  let seen;
  proc.killTree(child(91), {
    platform: 'win32',
    spawnImpl: (...args) => { seen = args; return taskkill; },
  });
  assert.deepEqual(seen, ['taskkill', ['/pid', '91', '/t', '/f'], { stdio: 'ignore', windowsHide: true }]);
  assert.doesNotThrow(() => taskkill.emit('error', new Error('access denied')));
});
