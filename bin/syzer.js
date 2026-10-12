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
const H = require('../src/headless');

const HELP = `SyzerCLI v${pkg.version}

  syzer                       interactive chat (agent with file tools)
  syzer [flags] "prompt"      one-shot answer (for scripts / orchestration)
  syzer provider [openrouter|nvidia]  switch provider (each has its own key file)
  syzer key add [keys|--file f]  add many keys at once; provider is detected from the key format
  syzer key list | use <n> | remove <n> | reset | test | prune  (test/prune print JSON; --provider p)
  syzer key usage --json [--provider p] [--all | --budget-ms N]   refresh + list per-key quota (cached, bounded)
  syzer key stats [--json]    recent outcomes, failure rate and cool-down per key (smart rotation)
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
  syzer --prompt "text" | echo task | syzer -   headless / CI one-shot (see exit codes below)
  syzer web [--port 8788] [--no-open]  local web UI (chat, keys, usage, settings)
  syzer orca [status|install [--shortcut]|patch|restore|uninstall]  Orca integration (auto-maintained)
  syzer setup                 run the first-time setup wizard again
  syzer doctor [--online]     check install, key pool, network and Orca patch (--online: also latest plugin release)
  syzer export <id|last> [--out f.md]  save a session as Markdown
  syzer update                check GitHub for a newer version (the syzer.exe launcher installs it)
  syzer usage --summary --json  percent used per provider (for status bars / Orca)
  syzer perm [ask|auto|readonly]

flags: --resume <id> (continue a saved session)  --provider <name> (this run only)  -a/--agent <name> (run as that agent)  --no-agents  -e/--effort <level>  -c/--continue (resume last session)  -k/--key <n> (use key n for this run)  -p/--print  -y/--yes (auto-approve tools)  -m/--model <id>  --json  --no-tools  --no-check
       --budget-tokens N  --budget-turns N  --budget-minutes N (per-task guard; env SYZER_BUDGET_TOKENS/TURNS/MINUTES; /budget in chat)
       --prompt <text>  --prompt-file <f>  --out <f>  --quiet  --timeout-minutes N  (headless)
${H.EXIT_HELP}`;

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
    else if (a === '--usage-analytics') f.usageAnalytics = true;
    else if (a === '--prompt-file') f.promptFile = argv[++i];
    else if (a === '--prompt') f.prompt = argv[++i];
    else if (a === '--timeout-minutes') f.timeoutMinutes = argv[++i];
    else if (a === '--title') f.title = argv[++i];
    else if (a === '--out') f.outFile = argv[++i];
    else if (a === '--dry-run') f.dryRun = true;
    else if (a === '--shortcut') f.shortcut = true;
    else if (a === '--summary') f.summary = true;
    else if (a === '--no-update') f.noUpdate = true;
    else if (a === '--all') f.all = true;
    else if (a === '--online') f.online = true;
    else if (a === '--provider') f.provider = argv[++i];
    else if (a === '-e' || a === '--effort') f.effort = argv[++i];
    else if (a === '-a' || a === '--agent') f.agent = argv[++i];
    else if (a === '--budget-ms') f.budgetMs = argv[++i];
    else if (a === '--budget-tokens') f.budgetTokens = argv[++i];
    else if (a === '--budget-turns') f.budgetTurns = argv[++i];
    else if (a === '--budget-minutes') f.budgetMinutes = argv[++i];
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

const budgetFlagsOf = (f) => ({ tokens: f.budgetTokens, turns: f.budgetTurns, minutes: f.budgetMinutes });

// Headless / CI çalıştırma: bloklamaz, çıkış kodu H.EXIT sözleşmesine uyar (src/headless.js)
async function printMode(cfg, f, prompt) {
  const t0 = Date.now();
  const log = (s) => process.stderr.write(s + '\n');
  const st = { denied: 0, timedOut: false, interrupted: false };
  const denyTexts = [t('readonly_block'), t('denied')];
  const writeOut = (text) => { if (f.outFile) { try { fs.writeFileSync(`${f.outFile}.tmp`, text); fs.renameSync(`${f.outFile}.tmp`, f.outFile); } catch { /* önemsiz */ } } };
  const out = {
    waiting() {}, text() {}, endText() {},
    tool: (n, s) => { if (!f.quiet) log(C.gray(`● ${n}(${s})`)); },
    toolResult: (ok, txt, ui) => {
      if (!ok && H.isDenial(txt, denyTexts)) st.denied++;
      if (!f.quiet) log(C.gray(`  ⎿ ${ui ? ui.summary : String(txt).split('\n')[0].slice(0, 100)}`));
    },
    warn: (m) => log(`⚠ ${m}`),
  };
  // sonucu yaz: --out sözleşmesi + stdout (düz metin ya da tek JSON nesnesi) + çıkış kodu
  const finish = ({ content, error, budgetExceeded, usageError, r, s, base }) => {
    const exitCode = H.exitCodeFor({ error, usageError, budgetExceeded, denied: st.denied > 0, interrupted: st.interrupted, timedOut: st.timedOut });
    const changed = base ? H.changedFiles(require('../src/checkpoints').store(), [base.sessionId, s && s.sessionId]) : null;
    writeOut(H.outBody({ content, error, budgetExceeded }));
    if (f.json) {
      console.log(JSON.stringify(H.buildResult({
        content, error, budgetExceeded, exitCode, sessionId: base && base.sessionId, tokens: r && r.tokens, toolTurns: r && r.toolCalls,
        ms: Date.now() - t0, changed, model: s && s.model, key: r && r.keyIndex >= 0 ? r.keyIndex + 1 : undefined, timedOut: st.timedOut,
      })));
    } else if (error) console.error(`${C.red('✖')} ${error}`);
    else console.log(H.outBody({ content, budgetExceeded }));
    if (budgetExceeded && !f.json) log(`⚠ BUDGET EXCEEDED (exit ${H.EXIT.BUDGET})`);
    process.exitCode = exitCode;
    if (exitCode !== 0) setTimeout(() => process.exit(exitCode), 500).unref(); // takılı tutamaçlar çıkışı engellemesin
  };
  const usageFail = (msg) => finish({ error: msg, usageError: true });

  // yapılandırma / bayrak doğrulama (kullanım hatası → 2)
  const B = require('../src/budget');
  const bad = [['--budget-tokens', f.budgetTokens], ['--budget-turns', f.budgetTurns], ['--budget-minutes', f.budgetMinutes]].find(([, v]) => v !== undefined && B.parseLimit(v) === undefined);
  if (bad) return usageFail(`Invalid value for ${bad[0]}: ${bad[1]}`);
  const timeoutMs = H.parseTimeoutMs(f.timeoutMinutes);
  if (timeoutMs === undefined) return usageFail(`Invalid value for --timeout-minutes: ${f.timeoutMinutes}`);
  if (!cfg.keys.length) return usageFail(t('no_keys'));

  if (f.title && process.stdout.isTTY && !f.quiet) process.stdout.write(`\x1b]0;${f.title}\x07`);
  const perm = f.yes ? 'auto' : cfg.permissions === 'auto' ? 'auto' : 'readonly';
  const base = createSession(cfg, { model: f.model, perm, effort: f.effort, useTools: !f.noTools, agents: !f.noAgents, confirm: H.headlessConfirm(f.yes), out });
  base.budgetFlags = budgetFlagsOf(f);
  let s = base;
  if (f.agent) {
    const def = base.ctx.agents.find((x) => x.name === f.agent);
    if (!def) return usageFail(`Unknown agent "${f.agent}". Available: ${base.ctx.agents.map((x) => x.name).join(', ')}`);
    s = makeSub(base, def, def.name, 0);
    if (f.model) s.model = f.model;
    if (f.effort) s.effort = f.effort;
    s.maxSteps = 30;
    s.budgetFlags = base.budgetFlags;
  }
  if (Object.keys(base.settings.mcpServers).length && !f.noTools) {
    try {
      base.mcp = await new McpManager().load(base.settings.mcpServers, base.cwd);
      base.mcp.errors.forEach((e) => log(`⚠ MCP "${e.name}": ${e.message}`));
    } catch (e) { log(`⚠ MCP: ${e.message}`); }
  }

  const ctl = new AbortController();
  let abortNow;
  const aborted = new Promise((_, rej) => { abortNow = rej; });
  aborted.catch(() => {});
  const stop = (why) => { ctl.abort(); abortNow(new Error(why)); };
  const onSig = () => { st.interrupted = true; stop('interrupted'); };
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);
  const timer = timeoutMs ? setTimeout(() => { st.timedOut = true; stop('TIMEOUT'); }, timeoutMs) : null;

  let r = null;
  let error = '';
  try { r = await Promise.race([runTurn(s, prompt, ctl.signal), aborted]); }
  catch (e) { error = st.timedOut ? 'TIMEOUT' : st.interrupted ? 'interrupted' : e.message; }
  finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGINT', onSig);
    process.removeListener('SIGTERM', onSig);
    killAll(base);
    if (base.mcp) base.mcp.close();
  }
  finish({ content: r ? r.content : '', error, budgetExceeded: r && r.budgetExceeded, r, s, base });
}

async function main() {
  const SU = require('../src/selfupdate');
  const headlessArgv = process.argv.slice(2).some((a) => ['--prompt', '--prompt-file', '--quiet', '--json'].includes(a)); // CI: kendini güncelleyip yeniden başlatma
  if (!headlessArgv && !SU.skip(process.argv.slice(2)) && await SU.run()) return; // npm kurulumu açılışta kendini günceller
  const f = parseArgs(process.argv.slice(2));
  if (f.provider) process.env.SYZER_PROVIDER = f.provider; // yalnızca bu çalıştırma için
  const cfg = config.load();
  setLang(cfg.lang);
  if (f.key) { const n = parseInt(f.key, 10) - 1; if (cfg.keys[n]) cfg.active = n; }

  if (f.version) return console.log(pkg.version);
  if (f.help) return console.log(HELP);

  const [cmd, sub, ...more] = f.rest;

  if ((cmd === 'key' || cmd === 'keys') && sub === 'stats') {
    const kj = require('../src/keys-json');
    const r = kj.stats(f.provider);
    return console.log(f.json ? JSON.stringify(r) : kj.statsText(r));
  }
  if ((cmd === 'key' || cmd === 'keys') && sub === 'usage') { // kota önbelleğini yenile + listele (JSON; Orca key yöneticisi)
    const kj = require('../src/keys-json');
    return console.log(JSON.stringify(await kj.usage(f.provider, { all: !!f.all, budgetMs: parseInt(f.budgetMs, 10) || 0 })));
  }
  if ((cmd === 'key' || cmd === 'keys') && (f.json || sub === 'test' || sub === 'prune')) { // makine okunur çıktı (Orca vb.)
    const kj = require('../src/keys-json');
    const out = (o) => console.log(JSON.stringify(o));
    if (sub === 'add') return out(await kj.add(more.join(String.fromCharCode(10)) || (process.stdin.isTTY ? '' : await readStdin())));
    if (sub === 'remove' || sub === 'rm') return out(kj.remove(f.provider || cfg.provider, more[0]));
    if (sub === 'use') return out(kj.use(f.provider || cfg.provider, more[0]));
    if (sub === 'test') return out(await kj.test(f.provider));
    if (sub === 'prune') return out(kj.prune(f.provider));
    return out(kj.listAll());
  }
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
  if (cmd === 'orca') return require('../src/orca-bridge').run(process.argv.slice(process.argv.indexOf('orca') + 1)); // eklenti: github.com/yasinbalcik/SyzerCLI-Orca
  if (cmd === 'doctor') return require('../src/doctor').run(cfg, { online: f.online });
  if (cmd === 'export') return require('../src/export').run(sub, f.outFile);
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
  if (cmd === 'stats' && f.usageAnalytics) return console.log(JSON.stringify(require('../src/analytics').build()));
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
  // istem kaynağı önceliği: --prompt-file > --prompt > argümanlar > stdin ("-" ya da pipe)
  const src = H.resolvePromptSource({ promptFile: f.promptFile, prompt: f.prompt, positional: f.rest, stdinIsTTY: !!process.stdin.isTTY });
  const headlessIntent = (src.source !== 'none' && src.source !== 'stdin') || f.print;
  let prompt = src.args;
  if (f.promptFile) {
    try { prompt = H.joinPrompt(fs.readFileSync(f.promptFile, 'utf8'), src.args); }
    catch (e) { console.error(`${C.red('✖')} --prompt-file: ${e.message}`); process.exitCode = H.EXIT.USAGE; return; }
  }
  if (src.readStdin) prompt = H.joinPrompt(prompt, await readStdin());
  prompt = prompt.trim();
  if (prompt || headlessIntent) {
    if (!prompt) { console.error('No prompt given.'); process.exitCode = H.EXIT.USAGE; return; }
    return printMode(cfg, f, prompt);
  }
  return require('../src/repl').start(cfg, { budgetFlags: budgetFlagsOf(f), model: f.model, perm: f.yes ? 'auto' : undefined, effort: f.effort, resume: f.resume, resumeId: f.resumeId, agents: !f.noAgents, useTools: !f.noTools });
}

main().catch((e) => { console.error(`${C.red('✖')} ${e.message}`); process.exitCode = 1; });
