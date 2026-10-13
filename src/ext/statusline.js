'use strict';

// /statusline: ayarlı komutun mevcut çıktısını gösterir
const sl = require('../statusline');

async function run(arg, ctx) {
  const session = ctx && ctx.session;
  if (!session) return 'No session.';
  const conf = sl.config(session.settings);
  if (!conf) return 'No statusline configured. Add to settings.json: { "statusLine": { "command": "<cmd>", "timeoutMs": 1500 } }';
  const text = await sl.render(session);
  return `statusLine command: ${conf.command} (timeout ${conf.timeoutMs} ms)\nOutput: ${text || '(empty, failed or timed out)'}`;
}

const commands = { statusline: { desc: 'Show the configured statusline command and its current output', run } };
module.exports = { commands, run };
