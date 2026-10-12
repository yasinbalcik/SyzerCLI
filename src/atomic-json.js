'use strict';

const fs = require('fs');
const path = require('path');

function writeJsonAtomic(file, value, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const space = options.space === undefined ? 2 : options.space;
  const mode = options.mode === undefined ? 0o600 : options.mode;
  const newline = options.newline === true;
  const renameAttempts = options.renameAttempts === undefined ? 4 : options.renameAttempts;
  const retryDelaysMs = options.retryDelaysMs || [0, 25, 50, 100];
  const sleepSync = options.sleepSync || ((ms) => {
    if (!ms) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  });

  // Serialize before creating anything so a circular value cannot leave a temp file.
  const raw = JSON.stringify(value, null, space);
  if (raw === undefined) throw new TypeError('The "value" argument could not be serialized to JSON');
  const text = raw + (newline ? '\n' : '');
  const dir = path.dirname(file);
  fsImpl.mkdirSync(dir, { recursive: true });
  const base = path.basename(file);
  const tmp = path.join(dir, `${base}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  let made = false;
  try {
    fsImpl.writeFileSync(tmp, text, { encoding: 'utf8', mode });
    made = true;
    if (typeof fsImpl.chmodSync === 'function') {
      try { fsImpl.chmodSync(tmp, mode); } catch { /* best effort on Windows */ }
    }
    let last;
    const count = Math.max(1, renameAttempts);
    for (let i = 0; i < count; i++) {
      sleepSync(retryDelaysMs[i] || 0);
      try {
        fsImpl.renameSync(tmp, file);
        made = false;
        return;
      } catch (err) {
        last = err;
        if (!err || (err.code !== 'EPERM' && err.code !== 'EBUSY') || i === count - 1) throw err;
      }
    }
    throw last;
  } finally {
    if (made) {
      try { fsImpl.unlinkSync(tmp); } catch { /* only this call's temp name */ }
    }
  }
}

module.exports = { writeJsonAtomic };
