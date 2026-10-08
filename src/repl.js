'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { t, setLang } = require('./i18n');
const { C, box, pad, trunc, spinner, MdStream, vlen } = require('./ui');
const { usable } = require('./keys');
const { runTurn } = require('./agent');
const { createSession, resetSession } = require('./session');
const { loadBody } = require('./context');
const { supportsImages, supportsReasoning } = require('./models');
const sessions = require('./sessions');
const { undoLast } = require('./tools');
const providers = require('./providers');
const { Editor } = require('./input');
const { Dock } = require('./dock');
const { McpManager } = require('./mcp');
const { killAll } = require('./tools');
const compactMod = require('./compact');
const { estimate, windowOf } = compactMod;
const cmds2 = require('./cmds2');
const cmds = require('./cmds');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const BUILTIN = ['help', 'model', 'models', 'usage', 'keys', 'lang', 'perm', 'skills', 'context', 'clear', 'exit',
  'effort', 'fallback', 'undo', 'resume', 'stats', 'plan', 'go', 'agents', 'subagent',
  'rules', 'allow', 'deny', 'mcp', 'compact', 'diff', 'commit', 'review', 'checkpoints', 'restore', 'todos', 'tasks', 'init', 'provider', 'web', 'runs', 'run'];
const LABEL = { read_file: 'Read', write_file: 'Write', edit_file: 'Update', list_dir: 'List', find_files: 'Find', search_files: 'Search', run_command: 'Run', use_skill: 'Skill', spawn_agent: 'Agent' };
const PLAN_PREFIX = '[PLAN MODE] Use read-only tools only. Do NOT modify anything. Investigate, then answer with a concise numbered plan and ask for approval at the end.\n\n';

function banner(s, reasoning) {
  const { cfg, ctx } = s;
  const ready = cfg.keys.filter(usable).length;
  const w = Math.max(30, (process.stdout.columns || 80) - 16);
  const row = (label, value) => `${C.gray(pad(label, 11))}${value}`;
  const lines = [
    `${C.orange('◆')} ${C.bold('SyzerCLI')} ${C.gray(`v${pkg.version}`)}`,
    '',
    row(t('lbl_provider'), C.cyan(providers.current().name)),
    row(t('lbl_model'), C.cyan(s.model)),
    row(t('lbl_keys'), t('keys_summary', cfg.keys.length, ready, (cfg.active | 0) + 1) + C.gray(` · ${cfg.lang}`)),
    ...(reasoning !== false ? [row(t('lbl_effort'), C.cyan(s.effort))] : []),
    row(t('lbl_mode'), t(`perm_${s.perm}`)),
    row(t('lbl_dir'), trunc(s.cwd, w)),
    row(t('lbl_ctx'), t('ctx_summary', ctx.files.length, ctx.skills.length, ctx.commands.length)),
  ];
  return box(lines) + '\n' + C.gray(t('hint')) + '\n';
}

function makeOut() {
  let spin = null;
  let dock = null;
  let md = null;
  let thought = '';
  let thoughtChars = 0;
  const agents = new Map(); // çalışan alt ajanlar: id → { label, action }
  let paused = false;
  const agentRows = () => {
    const list = [...agents.values()];
    const cols = (process.stdout.columns || 100) - 4;
    return list.map((e, i) => {
      const mark = i === list.length - 1 ? '└' : '├';
      const secs = Math.floor((Date.now() - e.t0) / 1000);
      const tail = C.gray(` · ${e.steps} ${t('lbl_steps')} · ${secs}s`);
      const room = Math.max(20, cols - vlen(tail) - 6);
      const label = trunc(e.label, 40);
      const action = trunc(String(e.action).replace(/\s+/g, ' '), Math.max(8, room - vlen(label) - 2));
      return `  ${C.gray(mark)} ${C.bold(label)}  ${C.gray(action)}${tail}`;
    });
  };
  const out = {
    setDock(d) { dock = d; },
    waiting(on, label) {
      if (dock && dock.active) { dock.setStatus(on ? (label || t('thinking')) : null); return; }
      if (on) {
        if (paused) return;
        if (!spin) { thought = ''; thoughtChars = 0; spin = spinner(label || t('thinking')); }
        else if (label) spin.label(label);
      } else if (spin) { spin.stop(); spin = null; }
    },
    thinking(chunk) {
      thoughtChars += chunk.length;
      thought = (thought + chunk).replace(/\s+/g, ' ').slice(-400);
      if (dock && dock.active) { dock.setDetail(thought); dock.setMeta(`↓ ${Math.max(1, Math.round(thoughtChars / 4))} tok`); return; }
      if (spin) { spin.detail(thought); spin.meta(`↓ ${Math.max(1, Math.round(thoughtChars / 4))} tok`); }
    },
    text(txt) { (md ||= new MdStream()).push(txt); },
    endText() { if (md) { md.end(); md = null; } },
    tool(name, summary) {
      console.log(`${C.cyan('●')} ${C.bold(LABEL[name] || name)}${C.gray(`(${trunc(summary.replace(/\s+/g, ' '), 90)})`)}`);
    },
    toolResult(ok, text, ui) {
      const mark = ok ? C.gray('⎿') : C.red('⎿');
      if (ui) {
        console.log(`  ${mark} ${ok ? C.gray(ui.summary) : C.red(ui.summary)}`);
        if (ui.body) console.log(ui.body);
        return;
      }
      const first = String(text).split('\n').filter(Boolean)[0] || '';
      console.log(`  ${mark} ${ok ? C.gray(trunc(first, 100)) : C.red(trunc(first, 100))}`);
    },
    // Uyarı, spinner satırının üstüne binmesin diye önce satırı temizler
    warn(msg) { process.stderr.write(`\r\x1b[2K${C.yellow('⚠')} ${C.yellow(msg)}\n`); },
    notice(msg) { console.log(`  ${C.green('✔')} ${C.gray(msg)}`); },

    // --- alt ajanlar: tek spinner satırında her ajanın anlık işi ---
    agentStart(id, label) { agents.set(id, { label, action: '…', t0: Date.now(), steps: 0 }); out.refresh(); },
    agentUpdate(id, action, steps) { const e = agents.get(id); if (e) { e.action = action; if (steps != null) e.steps = steps; out.refresh(); } },
    agentDone(id) { agents.delete(id); out.refresh(); },
    refresh() {
      if (dock && dock.active) { dock.setAgents(agentRows()); return; }
      if (paused || !agents.size) return;
      out.waiting(true, t('agents_running', agents.size));
      spin.label(t('agents_running', agents.size));
      if (!out._tick) out._tick = setInterval(() => { if (agents.size) out.refresh(); else { clearInterval(out._tick); out._tick = null; } }, 1000);
      spin.detail('');
      spin.rows(agentRows());
    },
    // Onay sorusu sırasında spinner çizimini durdurur
    pause(on) { if (dock && dock.active) { dock.pause(on); return; } paused = on; if (on && spin) { spin.stop(); spin = null; } },
  };
  return out;
}

// @yol → dosya içeriğini mesaja ekler
function expandMentions(text, cwd) {
  const extra = [];
  const seen = new Set();
  for (const m of text.matchAll(/(^|\s)@([^\s]+)/g)) {
    const rel = m[2];
    if (seen.has(rel)) continue;
    seen.add(rel);
    const p = path.resolve(cwd, rel);
    try {
      if (!fs.statSync(p).isFile()) continue;
      const body = fs.readFileSync(p, 'utf8');
      extra.push(`<file path="${rel}">\n${body.length > 30000 ? body.slice(0, 30000) + '\n…(truncated)' : body}\n</file>`);
    } catch { /* dosya değil: @ olduğu gibi kalır */ }
  }
  return extra.length ? `${text}\n\n${extra.join('\n\n')}` : text;
}

async function buildContent(text, images, model, out) {
  if (!images.length) return text;
  const ok = await supportsImages(model);
  if (ok === false) { out.warn(t('img_no_vision')); return text; }
  const parts = [{ type: 'text', text }];
  for (const p of images) {
    try {
      const mime = MIME[path.extname(p).slice(1).toLowerCase()] || 'image/png';
      parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` } });
    } catch (e) { out.warn(t('img_bad', e.message)); }
  }
  return parts;
}

function setTitle(cfg, left, keyIndex) {
  if (!process.stdout.isTTY) return;
  const k = (keyIndex ?? (cfg.active | 0)) + 1;
  process.stdout.write(`\x1b]0;Syzer · ${providers.current().name} · key #${k}${left ? ` · ${left.remaining}/${left.limit}` : ''}\x07`);
}

function resume(s, saved) {
  s.messages = [s.messages[0], ...saved.messages.slice(1)];
  s.sessionId = saved.id;
  console.log(C.green(`✔ ${t('sess_resumed', trunc(saved.title, 50), saved.messages.length - 1)}`));
}

async function start(cfg, opts = {}, io = {}) {
  const editor = new Editor({
    ...io,
    complete: (text) => {
      if (!text.startsWith('/') || text.includes(' ')) return [];
      const names = [...BUILTIN, ...s.ctx.skills.map((k) => k.name), ...s.ctx.commands.map((k) => k.name)].map((n) => '/' + n);
      return [...new Set(names)].filter((n) => n.startsWith(text));
    },
  });
  const getPrompt = () => `${s.plan ? C.cyan('plan ') : ''}${C.orange('❯')} `;
  const ask = async (q) => { const r = await editor.read(q, { history: false }); return r.exit ? '' : r.text; };

  // Paralel alt ajanlar aynı anda onay isteyebilir: sorular sıraya girer, spinner soru süresince durur
  let confirmChain = Promise.resolve();
  const confirm = (kind, summary, preview) => {
    const run = async () => {
      s.out.pause(true);
      try {
        console.log(`${C.yellow('?')} ${C.bold(kind)} ${C.gray(trunc(summary.replace(/\s+/g, ' '), 100))}`);
        if (preview) console.log(preview.split('\n').map((l) => '  ' + l).join('\n'));
        console.log(`  ${C.gray(t('confirm_legend'))}`);
        const a = await editor.readKey(`  ${t('confirm_q')} ${C.gray('[y/n/a/r]')} `);
        if (a === 'a') return 'always';
        if (a === 'r') return 'rule';
        return /^(y|e|j|s|o|t)/.test(a) ? 'yes' : 'no';
      } finally { s.out.pause(false); s.out.refresh(); }
    };
    const p = confirmChain.then(run);
    confirmChain = p.catch(() => {});
    return p;
  };

  const s = createSession(cfg, { ...opts, canAsk: true, confirm, out: makeOut() });
  if (opts.resumeId) { const sv = sessions.find(opts.resumeId); if (sv) { if (sv.cwd && sv.cwd !== s.cwd) console.log(C.yellow(`⚠ ${sv.cwd}`)); resume(s, sv); } else console.log(C.yellow(t('unknown_cmd', `--resume ${opts.resumeId}`))); }
  else if (opts.resume) { const last = sessions.list(s.cwd)[0]; if (last) resume(s, last); }
  if (Object.keys(s.settings.mcpServers).length) {
    s.mcp = await new McpManager().load(s.settings.mcpServers, s.cwd);
  }
  console.log(banner(s, await supportsReasoning(s.model, { cacheOnly: true }))); // açılışta ağ isteği yok
  if (s.mcp) {
    s.mcp.errors.forEach((e) => s.out.warn(t('mcp_fail', e.name, e.message)));
    if (s.mcp.clients.length) console.log(C.gray(t('mcp_loaded', s.mcp.clients.length, s.mcp.defs.length)) + '\n');
  }
  setTitle(cfg, null);

  let ctrl = null;
  let webUi = null;
  editor.onInterrupt = () => { if (ctrl) ctrl.abort(); };
  const dock = new Dock({ editor });

  const doCompact = async (hint) => {
    console.log(C.gray(t('compact_start')));
    s.out.waiting(true, t('compact_start'));
    try {
      const r = await compactMod.compact(s, hint);
      s.out.waiting(false);
      console.log(r ? C.green(`✔ ${t('compact_done', r.before.toLocaleString(), r.after.toLocaleString())}`) : C.gray(t('compact_none')));
    } catch (e) { s.out.waiting(false); console.error(`${C.red('✖')} ${e.message}`); }
  };

  const chat = async (text, images = []) => {
    ctrl = new AbortController();
    let docked = false;
    const closeDock = () => { if (docked) { docked = false; s.out.setDock(null); dock.end(); } };
    try {
      // Bağlam %75'i aşarsa önce otomatik özetle
      const win = await windowOf(s.model);
      if (estimate(s.messages) > win * 0.75) await doCompact('');
      const content = await buildContent((s.plan ? PLAN_PREFIX : '') + expandMentions(text, s.cwd), images, s.model, s.out);
      docked = await dock.begin();
      if (docked) s.out.setDock(dock);
      let r;
      try { r = await runTurn(s, content, ctrl.signal); } finally { closeDock(); }
      sessions.save(s);
      const parts = [];
      const ratio = estimate(s.messages) / win;
      parts.push(ratio > 0.6 ? C.yellow(`ctx ${Math.round(ratio * 100)}%`) : `ctx ${Math.max(1, Math.round(ratio * 100))}%`);
      if (r.model !== s.model) parts.push(C.yellow(r.model.split('/').pop()));
      if (r.tokens) parts.push(`${r.tokens.toLocaleString()} tok`);
      parts.push(`${(r.ms / 1000).toFixed(1)}s`);
      let left = null;
      if (r.keyIndex >= 0) {
        const info = await cmds.fetchInfo(cfg.keys[r.keyIndex]);
        left = info.ok ? info.data.free_model_daily_requests : null;
        parts.push(`key #${r.keyIndex + 1}/${cfg.keys.length}` + (left ? ` (${left.remaining}/${left.limit} ↓)` : ''));
        setTitle(cfg, left, r.keyIndex);
      }
      console.log(C.gray(`  ╌ ${parts.join(' · ')}`));
      if (left && left.remaining > 0 && left.remaining <= 5) s.out.warn(t('low_keys', r.keyIndex + 1, left.remaining));
      console.log('');
    } catch (err) {
      closeDock();
      s.out.waiting(false);
      s.out.endText();
      if (err.name === 'AbortError') console.log(C.gray(t('aborted')) + '\n');
      else console.error(`${C.red('✖')} ${err.message}\n`);
    }
    ctrl = null;
  };

  const slash = async (line) => {
    const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'help': case '?': { const ls = t('help').split('\n'); const tip = ls.pop(); console.log([...ls, t('help2'), t('help3'), t('help4'), t('help5'), t('help6'), tip].join('\n')); return; }
      case 'exit': case 'quit': return 'exit';
      case 'clear': resetSession(s); console.log(C.gray(t('cleared'))); return;
      case 'usage': await cmds.usage(cfg); return;
      case 'keys':
        if (rest[0] === 'add') {
          const text = rest.length > 1 ? rest.slice(1).join('\n') : (console.log(C.gray(t('key_paste'))), await ask(getPrompt()));
          await cmds.keyAdd(cfg, text);
        } else if (rest[0] === 'use') cmds.keyUse(cfg, rest[1]);
        else cmds.keyList(cfg);
        return;
      case 'model':
        if (arg) { await cmds.modelSet(cfg, arg); s.model = cfg.model; }
        else console.log(t('model_current', C.cyan(s.model)));
        return;
      case 'models':
        if (arg) await cmds.modelsList(cfg, arg);
        else { await cmds.modelPick(cfg, ask); s.model = cfg.model; }
        return;
      case 'lang':
        if (arg) { cmds.langSet(cfg, arg); setLang(cfg.lang); } else cmds.langSet(cfg);
        return;
      case 'perm':
        if (arg) { if (cmds.permSet(cfg, arg)) s.perm = arg; } else console.log(t('perm_set', t(`perm_${s.perm}`)));
        return;
      case 'skills': {
        if (!s.ctx.skills.length && !s.ctx.commands.length) { console.log(t('skills_none')); return; }
        if (s.ctx.skills.length) {
          console.log(C.bold(t('skills_title')));
          s.ctx.skills.forEach((k) => console.log(`  /${C.cyan(k.name)} ${C.gray(trunc(k.description, 80))}`));
        }
        if (s.ctx.commands.length) {
          console.log(C.bold(t('cmds_title')));
          s.ctx.commands.forEach((k) => console.log(`  /${C.cyan(k.name)} ${C.gray(trunc(k.description, 80))}`));
        }
        return;
      }
      case 'effort': {
        if (arg) { if (await cmds.effortSet(cfg, arg, s.model)) s.effort = cfg.effort; return; }
        if ((await supportsReasoning(s.model)) === false) { console.log(C.yellow(t('effort_unsupported'))); return; }
        console.log(t('effort_current', C.cyan(s.effort)));
        const k = await editor.readKey(C.cyan(t('effort_pick')));
        const lvl = cmds.EFFORTS[parseInt(k, 10) - 1];
        if (lvl && (await cmds.effortSet(cfg, lvl, s.model))) s.effort = cfg.effort;
        return;
      }
      case 'runs': {
        const runs = s.runs || [];
        if (!runs.length) { console.log(C.gray('Henüz alt ajan çalışması yok.')); return; }
        runs.forEach((r, i) => console.log(`${C.orange(String(i + 1).padStart(2))}  ${C.bold(r.agent)}  ${C.gray(trunc(String(r.label).replace(/\s+/g, ' '), 60))}  ${r.ok ? C.green('✔') : C.red('✖')} ${C.gray(`${(r.steps || []).length} adım · ${r.secs || '?'}s`)}`));
        console.log(C.gray('Ayrıntı için: /run <no>'));
        return;
      }
      case 'run': {
        const r = (s.runs || [])[parseInt(arg, 10) - 1];
        if (!r) { console.log(C.yellow('Kullanım: /run <no>  (liste: /runs)')); return; }
        console.log(`${C.bold(r.agent)} ${C.gray(r.label)}${r.model ? C.gray(` · ${r.model}`) : ''}${r.secs ? C.gray(` · ${r.secs}s`) : ''}`);
        console.log(`${C.cyan('Görev:')}\n${String(r.prompt).split('\n').map((l) => '  ' + l).join('\n')}`);
        (r.steps || []).forEach((st, i) => console.log(`${C.gray(String(i + 1).padStart(2) + '.')} ${C.cyan(st.tool)}${C.gray(`(${trunc(String(st.summary).replace(/\s+/g, ' '), 90)})`)}${st.result ? `\n    ${st.ok === false ? C.red('⎿') : C.gray('⎿')} ${C.gray(trunc(String(st.result).replace(/\s+/g, ' '), 140))}` : ''}`));
        console.log(`${C.cyan('Rapor:')}\n${String(r.report).split('\n').map((l) => '  ' + l).join('\n')}`);
        return;
      }
      case 'web': {
        if (!webUi) webUi = await require('./web').start(cfg, { port: Number(arg) || 8788, cwd: s.cwd, quiet: true });
        else require('child_process').spawn('cmd', ['/c', 'start', '', webUi.url], { stdio: 'ignore', detached: true }).unref();
        console.log(`${C.green('✔')} ${t('web_open')} ${C.cyan(webUi.url)}`);
        return;
      }
      case 'provider': {
        const was = cfg.provider;
        if (!cmds.providerCmd(cfg, arg || undefined)) return;
        if (cfg.provider !== was) {
          s.model = cfg.model;
          s.effort = cfg.effort;
          console.log(banner(s, await supportsReasoning(s.model)));
          setTitle(cfg, null);
        }
        return;
      }
      case 'fallback': await cmds.fallbackSet(cfg, rest); return;
      case 'agents': cmds.agentsList(s.ctx.agents, cfg); return;
      case 'subagent': await cmds.subagentSet(cfg, rest); return;
      case 'stats': cmds.statsShow(); return;
      case 'undo': {
        const u = undoLast(s);
        console.log(u ? C.green(`✔ ${t(u.removed ? 'undo_removed' : 'undo_done', path.relative(s.cwd, u.path) || u.path)}`) : C.gray(t('undo_none')));
        return;
      }
      case 'plan':
        s.plan = !s.plan;
        console.log(C.cyan(t(s.plan ? 'plan_on' : 'plan_off')));
        return;
      case 'go':
        if (!s.plan) { console.log(C.gray(t('plan_off'))); return; }
        s.plan = false;
        console.log(C.cyan(t('plan_go')));
        await chat('The plan is approved. Execute it now.');
        return;
      case 'resume': {
        const list = sessions.list(s.cwd).slice(0, 9);
        if (!list.length) { console.log(C.gray(t('sess_none'))); return; }
        list.forEach((x, i) => console.log(`  ${C.gray(String(i + 1))}  ${trunc(x.title, 60)}  ${C.gray(`${new Date(x.ts).toLocaleString()} · ${x.messages.length - 1} msg`)}`));
        const k = await editor.readKey(C.cyan(t('sess_pick')));
        const pick = list[parseInt(k, 10) - 1];
        if (pick) resume(s, pick);
        return;
      }
      case 'rules': {
        if (rest[0] === 'remove') cmds2.ruleRemove(s.cwd, s.settings, rest.slice(1).join(' '));
        else cmds2.rulesList(s.settings);
        return;
      }
      case 'allow': cmds2.ruleAdd(s.cwd, s.settings, 'allow', arg); return;
      case 'deny': cmds2.ruleAdd(s.cwd, s.settings, 'deny', arg); return;
      case 'mcp': {
        if (!s.mcp || (!s.mcp.clients.length && !s.mcp.errors.length)) { console.log(C.gray(t('mcp_none'))); return; }
        console.log(C.bold(t('mcp_title')));
        s.mcp.clients.forEach((c) => console.log(`  ${C.green('●')} ${c.name} ${C.gray(c.tools.map((x) => x.name).join(', ').slice(0, 100))}`));
        s.mcp.errors.forEach((e) => console.log(`  ${C.red('✖')} ${e.name} ${C.gray(e.message)}`));
        return;
      }
      case 'compact': await doCompact(arg); return;
      case 'diff': cmds2.gitDiffShow(s.cwd); return;
      case 'commit': await cmds2.commitFlow(s, arg, (q) => editor.readKey(q)); return;
      case 'review': { const p = cmds2.reviewPrompt(s.cwd); if (p) await chat(p); return; }
      case 'checkpoints': cmds2.checkpointsShow(s); return;
      case 'restore': await cmds2.restoreFlow(s, (q) => editor.readKey(q)); return;
      case 'todos': cmds2.todosShow(s); return;
      case 'tasks': cmds2.tasksShow(s, rest[0] === 'stop' ? rest[1] : null); return;
      case 'init':
        console.log(C.gray(t('init_start')));
        await chat('Analyze this project using your tools (structure, package/config files, README, scripts, conventions). Then create SYZER.md in the project root: a concise guide for AI agents covering what the project is, how to build/test/run it, the code layout, and conventions to follow. Keep it under 60 lines.');
        return;
      case 'context':
        if (!s.ctx.files.length) console.log(t('ctx_none'));
        s.ctx.files.forEach((f) => console.log(`  ${C.gray('•')} ${f.path} ${C.gray(`(${f.text.length})`)}`));
        return;
      default: {
        const command = s.ctx.commands.find((k) => k.name === cmd);
        const skill = s.ctx.skills.find((k) => k.name === cmd);
        if (command) await chat(loadBody(command.file, arg));
        else if (skill) await chat(`Use the skill "${skill.name}" (call use_skill first).${arg ? `\n\nTask: ${arg}` : ''}`);
        else console.log(C.yellow(t('unknown_cmd', '/' + cmd)));
      }
    }
  };

  editor.start();
  try {
    while (true) {
      let r;
      if (dock.queue.length) { r = dock.queue.shift(); console.log(`${getPrompt()}${r.display || r.text}`); }
      else { r = await editor.read(getPrompt()); if (r.exit) break; }
      const text = r.text.trim();
      if (!text && !r.images.length) continue;
      if (/^#\s*\S/.test(text) && !text.includes('\n') && !r.images.length && !text.startsWith('##')) {
        cmds2.noteMemory(s.cwd, text.replace(/^#\s*/, ''));
      } else if (text.startsWith('/') && !r.images.length) {
        if ((await slash(text)) === 'exit') break;
      } else await chat(text, r.images);
    }
  } finally {
    killAll(s);
    if (s.mcp) s.mcp.close();
    editor.stop();
    const oh = require('./orca-hooks');
    oh.end();
    await oh.flush();
  }
}

module.exports = { start };
