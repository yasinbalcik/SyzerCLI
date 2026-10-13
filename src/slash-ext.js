'use strict';

// Genişletilebilir slash komutları: src/ext/*.js dosyaları { commands: { ad: { desc, run(arg, ctx) } } } dışa aktarır.
// ctx: { session, cfg, chat(text), out(line), readKey(q) }. run bir string dönerse yazdırılır.
// Yerleşik komutlar (repl.js switch) önceliklidir; buradakiler yalnızca bilinmeyen adlar için denenir.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'ext');
let cache = null;

function load(dir = DIR) {
  const map = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch { return map; }
  for (const f of files) {
    try {
      const mod = require(path.join(dir, f));
      for (const [name, def] of Object.entries(mod.commands || {})) {
        if (def && typeof def.run === 'function' && !map.has(name)) map.set(name, { desc: String(def.desc || ''), run: def.run, source: f });
      }
    } catch { /* bozuk uzantı komutu açılışı bozmasın */ }
  }
  return map;
}

function commands() { return cache || (cache = load()); }
function has(name) { return commands().has(name); }
function list() { return [...commands()].map(([name, d]) => ({ name, desc: d.desc, source: d.source })); }

// Komutu çalıştırır; bulunamazsa false
async function run(name, arg, ctx) {
  const def = commands().get(name);
  if (!def) return false;
  const r = await def.run(arg, ctx);
  if (typeof r === 'string' && r) ctx.out(r);
  return true;
}

module.exports = { load, commands, has, list, run, DIR, reset: () => { cache = null; } };
