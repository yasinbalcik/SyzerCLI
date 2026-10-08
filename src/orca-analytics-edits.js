'use strict';

// Ayarlar → Stats & Usage → "Syzer" filtresi yamaları. Ham liste: orca-edits-analytics.js (groups A..E).
// Hash'li dosya adları glob'a çevrilir; ana süreçteki komut yer tutucusu yama anında doldurulur.
const BS = String.fromCharCode(92);

function toGlob(file) {
  const i = file.lastIndexOf('/');
  const dir = file.slice(0, i + 1);
  const base = file.slice(i + 1).replace(/-[A-Za-z0-9_]{8}[.]js$/, '-HASH.js');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\\/]/g, (c) => BS + c);
  const body = esc('out/' + dir + base).split(esc('-HASH.js')).join('-.*' + BS + '.js');
  return new RegExp('^' + body + '$');
}

function analyticsEdits(cmd) {
  const { groups } = require('./orca-edits-analytics');
  const out = [];
  for (const [name, list] of Object.entries(groups)) {
    for (const p of list) {
      out.push({
        group: name === 'E_overview' ? 'analytics-overview' : 'analytics',
        glob: toGlob(p.file),
        from: p.from,
        to: p.to.split('process.env.SYZER_BIN||`syzer`').join('process.env.SYZER_BIN||' + JSON.stringify(cmd)),
      });
    }
  }
  return out;
}

module.exports = { analyticsEdits, toGlob };
