'use strict';

// /memory list | show <ad> | forget <ad>
const memory = require('../memory');

function run(arg, ctx) {
  const cwd = (ctx && ctx.session && ctx.session.cwd) || process.cwd();
  const [sub = 'list', ...rest] = String(arg || '').trim().split(/\s+/);
  const name = rest.join(' ');
  try {
    if (sub === 'list' || sub === '') {
      const items = memory.list(cwd);
      if (!items.length) return 'No memories saved for this project.';
      return items.map((i) => `${i.name} (${i.type}) - ${i.description}`).join('\n');
    }
    if (sub === 'show') {
      if (!name) return 'Usage: /memory show <name>';
      const f = memory.read(cwd, name);
      return f ? `${f.name} (${f.type})\n${f.description}\n\n${f.body}` : `No such memory: ${name}`;
    }
    if (sub === 'forget') {
      if (!name) return 'Usage: /memory forget <name>';
      return memory.forget(cwd, name) ? `Forgot: ${name}` : `No such memory: ${name}`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
  return 'Usage: /memory list | show <name> | forget <name>';
}

const commands = { memory: { desc: 'Show or remove saved project memories (list | show <name> | forget <name>)', run } };
module.exports = { commands, run };
