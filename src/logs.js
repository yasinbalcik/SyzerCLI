'use strict';
// Küçük, bağımlılıksız günlük yazarı. Tanılama hiçbir zaman asıl akışı düşürmez.
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 200 * 1024;

function appendLine(file, line, { fsImpl = fs, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  try {
    const text = `${String(line).replace(/[\r\n]+/g, ' ').slice(0, 1000)}\n`;
    const bytes = Buffer.byteLength(text);
    let size = 0;
    try { size = fsImpl.statSync(file).size; } catch (_) { /* yeni dosya */ }
    if (size + bytes > maxBytes) {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true });
      try { fsImpl.rmSync(`${file}.1`, { force: true }); } catch (_) { /* en iyi çaba */ }
      try { fsImpl.renameSync(file, `${file}.1`); } catch (_) { /* henüz günlük yok */ }
    }
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    fsImpl.appendFileSync(file, text, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { DEFAULT_MAX_BYTES, appendLine };
