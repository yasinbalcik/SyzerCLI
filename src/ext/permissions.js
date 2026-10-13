'use strict';

// /permissions: etkin izin kurallarını kaynak dosyasıyla birlikte listeler (salt-okunur)

function describe(settings, perm) {
  const lines = [`Permission mode: ${perm || 'ask'}`, 'Precedence: deny > ask > allow (deny and dangerous commands cannot be overridden)'];
  if (!settings) { lines.push('No settings loaded.'); return lines.join('\n'); }
  const origins = settings.origins || [];
  const used = new Set();
  let count = 0;
  for (const kind of ['deny', 'ask', 'allow']) {
    for (const rule of settings[kind] || []) {
      const idx = origins.findIndex((o, i) => !used.has(i) && o.kind === kind && o.rule === rule);
      let src = 'this session (not saved)';
      if (idx >= 0) { used.add(idx); src = origins[idx].file; }
      lines.push(`  ${kind.padEnd(5)} ${rule}   [${src}]`);
      count++;
    }
  }
  if (!count) lines.push('  (no rules)');
  const dirs = settings.additionalDirectories || [];
  lines.push(dirs.length ? `Additional directories: ${dirs.join(', ')}` : 'Additional directories: none');
  return lines.join('\n');
}

const commands = {
  permissions: {
    desc: 'List active permission rules with their source files',
    run(arg, ctx) { return describe(ctx && ctx.session && ctx.session.settings, ctx && ctx.session && ctx.session.perm); },
  },
};

module.exports = { commands, describe };
