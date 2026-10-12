'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isOutside } = require('../src/permissions');

test('permissions: real paths reject traversal and accept existing/absent workspace children', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-perm-'));
  fs.mkdirSync(path.join(cwd, 'dir'));
  assert.equal(isOutside(cwd, 'dir/file.txt'), false);
  assert.equal(isOutside(cwd, '../outside.txt'), true);
  assert.equal(isOutside(cwd, path.join(os.tmpdir(), 'outside.txt')), true);
});

test('permissions: realpath errors fail closed and injected realpath supports synthetic links', () => {
  const cwd = path.join(path.parse(process.cwd()).root, 'workspace');
  const fsImpl = { realpathSync(p) {
    if (p === cwd) return cwd;
    if (p === path.resolve(cwd, 'link', 'new.txt')) return path.join(path.parse(cwd).root, 'outside', 'new.txt');
    const e = new Error('denied'); e.code = 'EACCES'; throw e;
  } };
  assert.equal(isOutside(cwd, 'link/new.txt', fsImpl), true);
  assert.equal(isOutside(cwd, 'inside.txt', { realpathSync() { const e = new Error('denied'); e.code = 'EACCES'; throw e; } }), true);
});

test('permissions: workspace symlink to outside is rejected when privilege allows it', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-perm-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-out-'));
  const link = path.join(cwd, 'link');
  try { fs.symlinkSync(outside, link, 'junction'); }
  catch (err) { if (err && ['EPERM', 'EACCES'].includes(err.code)) return t.skip('symlink privilege unavailable'); throw err; }
  assert.equal(isOutside(cwd, 'link/new.txt'), true);
});
