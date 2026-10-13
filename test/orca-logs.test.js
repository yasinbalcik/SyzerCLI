'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

test('bounded log rotates to one backup before exceeding its byte limit', () => {
  const logs = require('../src/logs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-logs-'));
  const file = path.join(dir, 'quit.log');
  fs.writeFileSync(file, 'old-content');
  assert.equal(logs.appendLine(file, 'new-entry', { maxBytes: 10 }), true);
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'old-content');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new-entry\n');
});

test('bounded log never throws when its filesystem write fails', () => {
  const logs = require('../src/logs');
  const badFs = { statSync() { throw new Error('no'); }, mkdirSync() { throw new Error('no'); }, appendFileSync() { throw new Error('no'); } };
  assert.equal(logs.appendLine('/nope/quit.log', 'safe', { fsImpl: badFs }), false);
});

test('hook timeout and HTTP failure are logged without rejecting the UI event', async () => {
  const { createHooks } = require('../src/orca-hooks');
  const entries = [];
  const env = { ORCA_PANE_KEY: 'pane', ORCA_AGENT_HOOK_PORT: '1', ORCA_AGENT_HOOK_TOKEN: 'token' };
  const stalledHttp = {
    request() {
      const req = new EventEmitter();
      req.end = () => {};
      req.destroy = () => req.emit('close');
      return req;
    },
  };
  const hooks = createHooks({ env, httpImpl: stalledHttp, timeoutMs: 1, logFailure: (s) => entries.push(s) });
  await hooks.promptSubmitted('secret prompt must not be logged');
  assert.match(entries[0], /Prompt.*timeout/);
  assert.doesNotMatch(entries.join('\n'), /secret prompt/);
});

test('hook HTTP 5xx is recorded without rejecting the UI event', async () => {
  const { createHooks } = require('../src/orca-hooks');
  const entries = [];
  const responseHttp = {
    request(_options, onResponse) {
      const req = new EventEmitter();
      req.destroy = () => req.emit('close');
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter();
        res.statusCode = 503;
        res.resume = () => {};
        onResponse(res);
        res.emit('end');
      });
      return req;
    },
  };
  const hooks = createHooks({ env: { ORCA_PANE_KEY: 'pane', ORCA_AGENT_HOOK_PORT: '1', ORCA_AGENT_HOOK_TOKEN: 'token' }, httpImpl: responseHttp, logFailure: (s) => entries.push(s) });
  await hooks.end();
  assert.deepEqual(entries, ['hook End: HTTP 503']);
});
