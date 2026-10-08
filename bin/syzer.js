#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');
const pkg = require('../package.json');
const config = require('../src/config');
const { setLang, t } = require('../src/i18n');
const { C } = require('../src/ui');
const cmds = require('../src/cmds');
const { createSession } = require('../src/session');
const { runTurn } = require('../src/agent');
const { findAgents } = require('../src/context');
const { makeSub } = require('../src/subagents');
const { McpManager } = require('../src/mcp');
const { killAll } = require('../src/tools');
const cmds2 = require('../src/cmds2');
const settingsMod = require('../src/settings');

const HELP = `SyzerCLI v${pkg.version}

  syzer                       interactive chat (agent with file tools)
  syzer [flags] "prompt"      one-shot answer (for scripts / orchestration)
  syzer provider [openrouter|nvidia]  switch provider (each has its own key file)
  syzer key add [keys|--file f]  add many keys at once; provider is detected from the key format
  syzer key list | use <n> | remove <n> | reset
  syzer usage [--json] [--check]  per-key status (OpenRouter: free requests/credit; NVIDIA: local counts, --check verifies live)
  syzer models [text] [--check] [--all]  list models (NVIDIA: --check finds which work on your account)
  syzer model [set <id>]      show / set the default model
  syzer effort [auto|off|low|medium|high|xhigh]
  syzer fallback [auto|off|set <id>...]  backup models
  syzer agents                list subagents
  syzer serve [--port 8787] [--token t]  local OpenAI-compatible proxy (key pool + fallback)
  syzer mcp serve | list      expose this CLI as an MCP server / list configured MCP servers
  syzer rules | allow "Bash(git status:*)" | deny "Read(.env)"
  syzer subagent [model <id|inherit> | effort <lvl|inherit> | concurrency <n>]
  syzer stats                 requests / tokens per day
  syzer lang [tr|en|de|es|ja|zh|ko|pl]
  syzer --prompt-file <f> [--out <f>]  one-shot from a prompt file (used by Orca workers)
  syzer web [--port 8788] [--no-open]  local web UI (chat, keys, usage, settings)
  syzer orca [status|install [--shortcut]|patch|restore|uninstall]  Orca integration (auto-maintained)
  syzer setup                 run the first-time setup wizard again
  syzer update                check GitHub for a newer version (the syzer.exe launcher installs it)
  syzer usage --summary --json  percent used per provider (for status bars / Orca)
  syzer perm [ask|auto|readonly]

flags: --resume <id> (continue a saved session)  --provider <name> (this run only)  -a/--agent <name> (run as that agent)  --no-agents  -e/--effort <level>  -c/--continue (resume last session)  -k/--key <n> (use key n for this run)  -p/--print  -y/--yes (auto-approve tools)  -m/--model <id>  --json  --no-tools  --no-check`;

function parseArgs(argv) {
  const f = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--print') f.print = true;
    else if (a === '-y' || a === '--yes' || a === '--unrestricted') f.yes = true; // --unrestricted: Orca'nın "bypass permissions" bayrağı
    else if (a === '--json') f.json = true;
    else if (a === '--no-tools') f.noTools = true;
    else if (a === '--no-check') f.noCheck = true;
    else if (a === '--check') f.check = true;
    else if (a === '--no-open') f.noOpen = true;
    else if (a === '--quiet') f.quiet = true;
    else if (a === '--prompt-file') f.promptFile = argv[++i];
    else if (a === '--out') f.outFile = argv[++i];
    else if (a === '--dry-run') f.dryRun = true;
    else if (a === '--shortcut') f.shortcut = true;
    else if (a === '--summary') f.summary = true;
    else if (a === '--no-update') f.noUpdate = true;
    else if (a === '--all') f.all = true;
    else if (a === '--provider') f.provider = argv[++i];
    else if (a === '-e' || a === '--effort') f.effort = argv[++i];
    else if (a === '-a' || a === '--agent') f.agent = argv[++i];
    else if (a === '--port') f.port = argv[++i];
    else if (a === '--host') f.host = argv[++i];
    else if (a === '--token') f.token = argv[++i];
    else if (a === '--no-agents') f.noAgents = true;
    else if (a === '-c' || a === '--continue') f.resume = true;
    else if (a === '--resume') f.resumeId = argv[++i];
    else if (a === '-m' || a === '--model') f.model = argv[++i];
    else if (a === '-k' || a === '--key') f.key = argv[++i];
    else if (a === '--file' || a === '-f') f.file = argv[++i];
    else if (a === '-h' || a === '--help') f.help = true;
    else if (a === '-v' || a === '--version') f.version = true;
    else if (/^--[a-z]/i.test(a)) console.error(`Unknown flag ${a} (ignored)`);
    else f.rest.push(a);
  }
  return f;
}

async function readStdin() {
  let data = '';
  for await (const c of process.stdin) data += c;
  return data;
}

async function readPastedLines() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(C.gray(t('key_paste')));
  let text = '';
  await new Promise((resolve) => {
    rl.on('line', (l) => { if (!l.trim()) { rl.close(); } else text += l + '\n'; });
    rl.on('close', resolve);
  });
  return text;
}

async function printMode(cfg, f, prompt) {
  const log = (s) => process.stderr.write(s + '\n');
  const out = {
    waiting() {}, text() {}, endText() {},
    tool: (n, s) => log(C.gray(`● ${n}(${s})`)),
    toolResult: (ok, txt, ui) => log(C.gray(`  ⎿ ${ui ? ui.summary : String(txt).split('\n')[0].slice(0, 100)}`)),
    warn: (m) => log(`⚠ ${m}`),
  };
  const perm = f.yes ? 'auto' : cfg.permissions === 'auto' ? 'auto' : 'readonly';
  const base = createSession(cfg, { model: f.model, perm, effort: f.effort, useTools: !f.noTools, agents: !f.noAgents, out });
  let s = base;
  if (f.agent) {
    const def = base.ctx.agents.find((x) => x.name === f.agent);
    if (!def) throw new Error(`Unknown agent "${f.agent}". Available: ${base.ctx.agents.map((x) => x.name).join(', ')}`);
    s = makeSub(base, def, def.name, 0);
    if (f.model) s.model = f.model;
    if (f.effort) s.effort = f.effort;
    s.maxSteps = 30;
  }
  if (Object.keys(base.settings.mcpServers).length && !f.noTools) {
    base.mcp = await new McpManager().load(base.settings.mcpServers, base.cwd);
    base.mcp.errors.forEach((e) => log(`⚠ MCP "${e.name}": ${e.message}`));
  }
  let r;
  const writeOut = (text) => { if (f.outFile) { try { fs.writeFileSync(`${f.outFile}.tmp`, text); fs.renameSync(`${f.outFile}.tmp`, f.outFile); } catch { /* önemsiz */ } } };
  try { r = await runTurn(s, prompt); }
  catch (e) { writeOut(`ERROR: ${e.message}`); throw e; }
  finally { killAll(base); if (base.mcp) base.mcp.close(); }
  writeOut(r.content || '(no output)');
  if (f.json) {
    console.log(JSON.stringify({ content: r.content, model: s.model, tokens: r.tokens, key: r.keyIndex + 1, ms: r.ms }));
  } else {
    console.log(r.content);
  }
}

async function main() {
  const f = parseArgs(process.argv.slice(2));
  if (f.provider) process.env.SYZER_PROVIDER = f.provider; // yalnızca bu çalıştırma için
  const cfg = config.load();
  setLang(cfg.lang);
  if (f.key) { const n = parseInt(f.key, 10) - 1; if (cfg.keys[n]) cfg.active = n; }

  if (f.version) return console.log(pkg.version);
  if (f.help) return console.log(HELP);

  const [cmd, sub, ...more] = f.rest;

  if (cmd === 'key' || cmd === 'keys') {
    switch (sub) {
      case 'add': {
        let text = more.join('\n');
        if (f.file) text += '\n' + fs.readFileSync(f.file, 'utf8');
        if (!text.trim()) text = process.stdin.isTTY ? await readPastedLines() : await readStdin();
        return cmds.keyAdd(cfg, text, { check: !f.noCheck });
      }
      case 'list': case 'ls': case undefined: return cmds.keyList(cfg);
      case 'remove': case 'rm': return cmds.keyRemove(cfg, more[0]);
      case 'use': return cmds.keyUse(cfg, more[0]);
      case 'reset': return cmds.keyReset(cfg);
      default: return console.log(HELP);
    }
  }
  if (cmd === 'provider') return cmds.providerCmd(cfg, sub);
  if (cmd === 'orca') return require('../src/orca-patch').run(sub, { quiet: f.quiet, dryRun: f.dryRun, shortcut: f.shortcut });
  if (cmd === 'web') return require('../src/web').start(cfg, { port: Number(f.port) || 8788, open: !f.noOpen });
  if (cmd === 'setup') return require('../src/setup').run(cfg);
  if (cmd === 'update') return require('../src/update-cmd').run(cfg);
  if (cmd === 'usage' && f.summary) return cmds.usageSummary(cfg, { json: f.json });
  if (cmd === 'usage') return cmds.usage(cfg, { json: f.json, check: f.check });
  if (cmd === 'models') {
    if (f.check) await cmds.modelsCheck(cfg, { force: true });
    return cmds.modelsList(cfg, [sub, ...more].filter(Boolean).join(' '), { all: f.all });
  }
  if (cmd === 'model') {
    if (sub === 'set' && more[0]) return cmds.modelSet(cfg, more[0]);
    return console.log(t('model_current', cfg.model));
  }
  if (cmd === 'lang') return cmds.langSet(cfg, sub);
  if (cmd === 'effort') return cmds.effortSet(cfg, sub);
  if (cmd === 'rules') {
    const st = settingsMod.load(process.cwd());
    if (sub === 'remove') return cmds2.ruleRemove(process.cwd(), st, more.join(' '));
    return cmds2.rulesList(st);
  }
  if (cmd === 'allow' || cmd === 'deny') return cmds2.ruleAdd(process.cwd(), settingsMod.load(process.cwd()), cmd, [sub, ...more].filter(Boolean).join(' '));
  if (cmd === 'fallback') return cmds.fallbackSet(cfg, [sub, ...more].filter(Boolean));
  if (cmd === 'stats') return cmds.statsShow();
  if (cmd === 'serve') return require('../src/server').start({ port: Number(f.port) || 8787, host: f.host || '127.0.0.1', token: f.token || null });
  if (cmd === 'mcp') {
    if (sub === 'serve') return require('../src/mcp-server').serve();
    const settings = require('../src/settings').load(process.cwd());
    const names = Object.keys(settings.mcpServers);
    if (!names.length) return console.log('No MCP servers configured. Add them to .mcp.json or .openrouter/mcp.json ({"mcpServers":{"name":{"command":"npx","args":["..."]}}}).');
    const mgr = await new (require('../src/mcp').McpManager)().load(settings.mcpServers, process.cwd());
    mgr.clients.forEach((c) => console.log(`${C.green('●')} ${c.name}  ${C.gray(`${c.tools.length} tools: ${c.tools.map((x) => x.name).join(', ').slice(0, 100)}`)}`));
    mgr.errors.forEach((e) => console.log(`${C.red('✖')} ${e.name}  ${e.message}`));
    mgr.skipped.forEach((e) => console.log(`${C.gray('○')} ${e.name}  ${C.gray(e.reason)}`));
    mgr.close();
    return;
  }
  if (cmd === 'agents') return cmds.agentsList(findAgents(process.cwd()), cfg);
  if (cmd === 'subagent') return cmds.subagentSet(cfg, [sub, ...more].filter(Boolean));
  if (cmd === 'perm') {
    if (sub) return cmds.permSet(cfg, sub);
    return console.log(cfg.permissions);
  }

  // ilk açılış kurulumu
  const setup = require('../src/setup');
  if (!cmd && setup.needed(cfg)) { await setup.run(cfg); setLang(cfg.lang); }
  else if (!cmd && !cfg.setupDone && process.stdin.isTTY) { cfg.setupDone = true; config.save(cfg); }

  // sohbet
  let prompt = f.rest.join(' ');
  if (f.promptFile) prompt = fs.readFileSync(f.promptFile, 'utf8').trim();
  if (!process.stdin.isTTY && !prompt) prompt = (await readStdin()).trim();
  else if (!process.stdin.isTTY && prompt) prompt += '\n\n' + (await readStdin()).trim();
  if (prompt || f.print) {
    if (!prompt) return console.error('No prompt given.');
    return printMode(cfg, f, prompt);
  }
  return require('../src/repl').start(cfg, { model: f.model, perm: f.yes ? 'auto' : undefined, effort: f.effort, resume: f.resume, resumeId: f.resumeId, agents: !f.noAgents, useTools: !f.noTools });
}

main().catch((e) => { console.error(`${C.red('✖')} ${e.message}`); process.exitCode = 1; });
