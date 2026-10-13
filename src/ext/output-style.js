'use strict';

// /output-style [ad]: stilleri listeler ya da seçer (cfg.outputStyle olarak kaydedilir)
const styles = require('../output-styles');

function run(arg, ctx, deps = {}) {
  const session = ctx && ctx.session;
  const cfg = (ctx && ctx.cfg) || (session && session.cfg) || {};
  const cwd = (session && session.cwd) || process.cwd();
  const all = styles.find(cwd);
  const want = String(arg || '').trim();
  const cur = cfg.outputStyle || 'default';
  if (!want) {
    const rows = [...all.values()].map((s) => `${s.name === cur ? '*' : ' '} ${s.name} [${s.source}]${s.description ? ' - ' + s.description : ''}`);
    return `Output styles (current: ${cur})\n${rows.join('\n')}\nUsage: /output-style <name>`;
  }
  if (!all.has(want)) return `No such output style: ${want}`;
  cfg.outputStyle = want;
  try { (deps.save || require('../config').save)(cfg); } catch { /* kayıt başarısız olsa da oturumda geçerli */ }
  if (session) styles.apply(session, want);
  return `Output style: ${want}`;
}

const commands = { 'output-style': { desc: 'List or switch the output style (default | concise | explanatory | custom)', run } };
module.exports = { commands, run };
