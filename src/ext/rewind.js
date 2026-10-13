'use strict';

// /rewind: seçilen kullanıcı turuna konuşmayı ve/veya dosyaları geri sarar (bkz. src/rewind.js)
const path = require('path');
const rw = require('../rewind');

function usage(ctx) {
  const all = rw.marks(ctx.session).slice(-10);
  if (!all.length) return 'No rewindable turns yet (turns from before a resume, /compact or /clear cannot be rewound).';
  const cps = require('../checkpoints').store().list(ctx.session.sessionId);
  const lines = ['Rewindable turns (use /rewind <turn> [--files|--chat] [--force]):'];
  all.forEach((m, i) => {
    const hi = i + 1 < all.length ? all[i + 1].cp : Infinity;
    const n = new Set(cps.filter((c) => c.turn >= m.cp && c.turn < hi).flatMap((c) => c.files.map((f) => f.path))).size;
    lines.push(`  #${m.turn}  ${m.prompt.slice(0, 60) || '(no text)'}${n ? `  [${n} file${n > 1 ? 's' : ''}]` : ''}`);
  });
  return lines.join('\n');
}

async function run(arg, ctx) {
  const tok = String(arg || '').split(/\s+/).filter(Boolean);
  if (!tok.length) return usage(ctx);
  const num = tok.find((x) => /^#?\d+$/.test(x));
  if (!num) return usage(ctx);
  const onlyFiles = tok.includes('--files');
  const onlyChat = tok.includes('--chat');
  const opts = { force: tok.includes('--force'), chat: !(onlyFiles && !onlyChat), files: !(onlyChat && !onlyFiles) };
  const turn = parseInt(num.replace('#', ''), 10);
  const pv = rw.preview(ctx.session, turn);
  if (!pv) return `Turn ${turn} not found or no longer valid. Run /rewind to list rewindable turns.`;
  if (ctx.session.busy) return 'Session is busy; wait for the current turn to finish.';
  const rel = (p) => path.relative(ctx.session.cwd || process.cwd(), p) || p;
  const eff = [];
  if (opts.chat) eff.push(`remove ${pv.chatTurns} conversation turn(s) (${pv.messages} messages) from turn #${turn} onward`);
  if (opts.files) {
    eff.push(pv.files.length
      ? `restore/delete ${pv.files.length} file(s) changed by Syzer: ${pv.files.slice(0, 5).map(rel).join(', ')}${pv.files.length > 5 ? ', ...' : ''}${opts.force ? ' (forced, overwriting your later edits)' : ''}`
      : 'restore no files (none changed since that turn)');
  }
  ctx.out(`Rewind to before turn #${turn}: "${pv.mark.prompt}"`);
  eff.forEach((e) => ctx.out(`  - ${e}`));
  ctx.out('  Shell command side effects and git state are not touched.');
  const k = await ctx.readKey('  Proceed? [y/n] ');
  if (String(k || '').toLowerCase() !== 'y') return 'Cancelled.';
  const r = rw.rewind(ctx.session, turn, opts);
  const lines = [];
  r.files.restored.forEach((p) => lines.push(`  restored ${rel(p)}`));
  (r.files.skipped || []).forEach((x) => lines.push(`  skipped ${rel(x.path)} (${x.why})`));
  if (r.files.conflicts.length) {
    lines.push(`Conflict in checkpoint #${r.files.conflictTurn}: changed after Syzer wrote it:`);
    r.files.conflicts.forEach((p) => lines.push(`  ! ${rel(p)}`));
  }
  if (!r.ok) lines.push(`Rewind not completed: ${r.error}`);
  else lines.push(`Rewound: ${r.chatTurnsRemoved} turn(s) removed from conversation, ${r.files.restored.length} file(s) restored.`);
  return lines.join('\n');
}

module.exports = { commands: { rewind: { desc: 'rewind conversation and/or files to an earlier turn: /rewind [<turn> [--files|--chat] [--force]]', run } } };
