'use strict';

const readline = require('readline');
const pkg = require('../package.json');
const config = require('./config');
const { setLang } = require('./i18n');
const { createSession } = require('./session');
const { runTurn } = require('./agent');
const { fetchInfo } = require('./cmds');
const { mask } = require('./keys');
const { PROTOCOL } = require('./mcp');

const TOOLS = [
  {
    name: 'ask',
    description: 'Ask a question to the default model of the active provider (OpenRouter or NVIDIA). Plain chat, no file access. Key rotation and fallback models are handled automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'the question or task' },
        model: { type: 'string', description: 'optional model id override' },
        effort: { type: 'string', enum: ['auto', 'off', 'low', 'medium', 'high', 'xhigh'] },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'agent',
    description: 'Run an autonomous agent with file and shell tools in a working directory and return its final report. Read-only unless allow_changes is true.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        agent: { type: 'string', description: 'agent name (explore, plan, general or a custom one)' },
        cwd: { type: 'string', description: 'working directory (default: server cwd)' },
        allow_changes: { type: 'boolean', description: 'allow file edits and commands (default false)' },
        model: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'usage',
    description: 'Show remaining free requests and credit for every saved key of the active provider.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const quietOut = {
  waiting() {}, thinking() {}, text() {}, endText() {}, tool() {}, toolResult() {},
  warn: (m) => process.stderr.write(`[syzercli] ${m}\n`),
};

async function callTool(cfg, name, args) {
  if (name === 'ask') {
    const s = createSession(cfg, { model: args.model, effort: args.effort, useTools: false, agents: false, perm: 'readonly', out: quietOut });
    return (await runTurn(s, args.prompt)).content;
  }
  if (name === 'agent') {
    const cwd = args.cwd || process.cwd();
    const base = createSession(cfg, { cwd, model: args.model, perm: args.allow_changes ? 'auto' : 'readonly', canAsk: false, out: quietOut });
    let s = base;
    if (args.agent) {
      const def = base.ctx.agents.find((x) => x.name === args.agent);
      if (!def) throw new Error(`Unknown agent "${args.agent}". Available: ${base.ctx.agents.map((x) => x.name).join(', ')}`);
      s = require('./subagents').makeSub(base, def, def.name, 0);
      if (args.model) s.model = args.model;
      s.maxSteps = 30;
    }
    return (await runTurn(s, args.prompt)).content;
  }
  if (name === 'usage') {
    const rows = await Promise.all(cfg.keys.map(async (e, i) => {
      const r = await fetchInfo(e);
      const f = r.ok ? r.data.free_model_daily_requests : null;
      return `#${i + 1} ${mask(e.key)}${i === cfg.active ? ' (active)' : ''}: ${r.ok ? (f ? `${f.remaining}/${f.limit} free requests left` : 'ok') : r.error}`;
    }));
    return rows.join('\n') || 'No keys saved.';
  }
  throw new Error(`Unknown tool: ${name}`);
}

// stdout yalnızca protokol içindir: diğer tüm çıktılar stderr'e yönlenir
function serve() {
  console.log = (...a) => process.stderr.write(a.join(' ') + '\n');
  const cfg = config.load();
  setLang(cfg.lang);
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    if (id === undefined) return; // bildirimler (initialized vb.)
    try {
      if (method === 'initialize') {
        send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'syzercli', version: pkg.version } } });
      } else if (method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      } else if (method === 'tools/call') {
        try {
          const text = await callTool(cfg, params.name, params.arguments || {});
          send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text || '') }] } });
        } catch (e) {
          send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
        }
      } else if (method === 'ping') {
        send({ jsonrpc: '2.0', id, result: {} });
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  });
  rl.on('close', () => process.exit(0));
}

module.exports = { serve };
