'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { McpClient } = require('../src/mcp');

function fakeChild() {
  const c = new EventEmitter();
  c.pid = 515;
  c.stdin = { end() {} };
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  return c;
}

test('mcp: Windows invokes cmd.exe with quoted command and arguments', () => {
  let seen;
  const client = new McpClient('test', { command: 'C:/Program Files/tool.cmd', args: ['a b', 'x&y', 'say "hi"'] }, 'C:/work', {
    platform: 'win32',
    comSpec: 'cmd.exe',
    spawnImpl: (...args) => { seen = args; return fakeChild(); },
  });
  client.start();
  assert.equal(seen[0], 'cmd.exe');
  assert.deepEqual(seen[1].slice(0, 3), ['/d', '/s', '/c']);
  assert.match(seen[1][3], /^"C:\/Program Files\/tool\.cmd" "a b" "x\^&y"/);
  assert.match(seen[1][3], /say \\\"hi\\\"/);
  assert.equal(seen[2].shell, false);
});

test('mcp: close ends stdin and delegates whole-tree shutdown', () => {
  const c = fakeChild();
  let ended = 0;
  c.stdin.end = () => { ended++; };
  let killed;
  const client = new McpClient('test', { command: 'node' }, '.', {
    spawnImpl: () => c,
    killTree: (got) => { killed = got; },
  });
  client.start();
  client.close();
  assert.equal(ended, 1);
  assert.equal(killed, c);
});
