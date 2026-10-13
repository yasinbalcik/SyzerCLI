'use strict';

// /plugin list | install <yol-veya-git-url> | remove <ad> | enable <ad> | disable <ad>
const plugins = require('../plugins');

const USAGE = 'Usage: /plugin list | install <path-or-git-url> | remove <name> | enable <name> | disable <name>';

async function run(arg, ctx, o = {}) {
  const [sub = 'list', ...rest] = String(arg || '').trim().split(/\s+/);
  const val = rest.join(' ').trim();
  const opts = { base: o.base, out: ctx && ctx.out, readKey: ctx && ctx.readKey, clone: o.clone };
  const note = ' (takes effect in a new session)';
  if (sub === 'list' || sub === '') {
    const items = plugins.list(opts);
    const head = plugins.enabled() ? '' : 'Plugins are disabled (cfg.plugins=false or SYZER_PLUGINS=off)\n';
    if (!items.length) return head + 'No plugins installed.';
    return head + items.map((p) => (p.error
      ? `${p.name} [broken] - ${p.error}`
      : `${p.name} ${p.version} [${p.enabled ? 'enabled' : 'disabled'}]${p.hooks ? ' hooks' : ''}${p.mcp ? ' mcp' : ''}${p.description ? ' - ' + p.description : ''}`)).join('\n');
  }
  if (sub === 'install') {
    if (!val) return USAGE;
    const r = await plugins.install(val, opts);
    return r.ok ? `Installed ${r.name} ${r.version}${note}` : `Install failed: ${r.error}`;
  }
  if (sub === 'remove' || sub === 'uninstall') {
    if (!val) return USAGE;
    const r = plugins.remove(val, opts);
    return r.ok ? `Removed ${val}${note}` : r.error;
  }
  if (sub === 'enable' || sub === 'disable') {
    if (!val) return USAGE;
    const r = plugins.setEnabled(val, sub === 'enable', opts);
    return r.ok ? `${sub === 'enable' ? 'Enabled' : 'Disabled'} ${val}${note}` : r.error;
  }
  return USAGE;
}

const commands = { plugin: { desc: 'Manage plugins (list | install <path-or-git-url> | remove | enable | disable)', run: (a, c) => run(a, c) } };
module.exports = { commands, run };
