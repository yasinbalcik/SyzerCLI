'use strict';

const fs = require('fs');
const path = require('path');
const { spawnShell, killTree } = require('./proc');
const { t } = require('./i18n');
const { C } = require('./ui');
const { diffLines, countOps, renderDiff } = require('./diff');
const { loadBody } = require('./context');
const { globToRegex } = require('./glob');
const perms = require('./permissions');
const hooks = require('./hooks');
const settingsMod = require('./settings');
const gitMod = require('./git');
const P = require('./prompts');
const { LIMITS } = require('./limits');

const MAX_OUT = LIMITS.toolOutput;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv']);

const clip = (s) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + '\n…(truncated)' : s);

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const DEFS = [
  fn('read_file', P.toolDescription('read_file'), {
    path: { type: 'string' }, offset: { type: 'integer', description: '1-based start line' }, limit: { type: 'integer', description: 'max lines' },
  }, ['path']),
  fn('write_file', P.toolDescription('write_file'), {
    path: { type: 'string' }, content: { type: 'string' },
  }, ['path', 'content']),
  fn('edit_file', P.toolDescription('edit_file'), {
    path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' },
    edits: { type: 'array', items: { type: 'object', properties: { old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['old_string', 'new_string'] } },
  }, ['path']),
  fn('list_dir', P.toolDescription('list_dir'), { path: { type: 'string', description: 'default: .' } }),
  fn('find_files', P.toolDescription('find_files'), { pattern: { type: 'string' } }, ['pattern']),
  fn('search_files', P.toolDescription('search_files'), {
    pattern: { type: 'string' }, path: { type: 'string', description: 'directory, default .' }, glob: { type: 'string', description: 'optional file filter, e.g. *.js' },
  }, ['pattern']),
  fn('run_command', P.toolDescription('run_command'), {
    command: { type: 'string' }, timeout_seconds: { type: 'integer', description: 'default 60' },
  }, ['command']),
  fn('run_background', P.toolDescription('run_background'), { command: { type: 'string' } }, ['command']),
  fn('bg_output', P.toolDescription('bg_output'), { id: { type: 'integer' } }, ['id']),
  fn('bg_stop', P.toolDescription('bg_stop'), { id: { type: 'integer' } }, ['id']),
  fn('web_fetch', P.toolDescription('web_fetch'), {
    url: { type: 'string' }, max_chars: { type: 'integer', description: 'default 12000' },
  }, ['url']),
  fn('web_search', P.toolDescription('web_search'), { query: { type: 'string' } }, ['query']),
  fn('todo_write', P.toolDescription('todo_write'), {
    todos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short unique id (default t1,t2,... by position)' },
          content: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          agent: { type: 'string', description: 'subagent that does this item (explore, plan, general, or a custom agent)' },
          prompt: { type: 'string', description: 'complete self-contained task for the subagent (defaults to content)' },
          model: { type: 'string', description: 'optional model id for this subagent' },
          depends_on: { type: 'array', items: { type: 'string' }, description: 'ids that must be completed first; their reports are passed to this agent' },
        },
        required: ['content', 'status'],
      },
    },
  }, ['todos']),
  fn('use_skill', P.toolDescription('use_skill'), { name: { type: 'string' } }, ['name']),
  fn('memory_save', P.toolDescription('memory_save'), {
    name: { type: 'string', description: 'short slug: letters, digits, - and _ (e.g. prefers-pnpm)' },
    description: { type: 'string', description: 'one-line summary shown in the memory index' },
    type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
    body: { type: 'string', description: 'the fact itself (markdown, concise)' },
  }, ['name', 'description', 'body']),
  fn('memory_forget', P.toolDescription('memory_forget'), { name: { type: 'string' } }, ['name']),
];
const MEMORY_TOOLS = new Set(['memory_save', 'memory_forget']);

const SPAWN_DEF = fn(
  'spawn_agent',
  P.toolDescription('spawn_agent'),
  {
    agent: { type: 'string', description: 'agent name (default: general)' },
    description: { type: 'string', description: 'short 3-6 word label' },
    prompt: { type: 'string', description: 'complete, self-contained task: goal, relevant file paths, constraints and the exact output format wanted; the subagent sees nothing else' },
    isolation: { type: 'string', enum: ['worktree'], description: 'optional: "worktree" runs the subagent in its own temporary git worktree/branch so parallel edits cannot collide; unchanged worktrees are deleted, changed ones are kept (NOT merged) and reported' },
  },
  ['prompt'],
);

const WORKER_DEF = fn(
  'spawn_syzer',
  P.toolDescription('spawn_syzer'),
  {
    title: { type: 'string', description: 'short 2-5 word tab title' },
    prompt: { type: 'string', description: 'complete task instructions; the worker sees nothing else' },
    agent: { type: 'string', description: 'optional agent profile name (explore, plan, general)' },
  },
  ['prompt'],
);

const RUN_PLAN_DEF = fn(
  'run_plan',
  P.toolDescription('run_plan'),
  { read_only: { type: 'boolean', description: 'true: subagents get read-only tools (set it whenever the user said not to modify files; it is also auto-detected from their request)' } },
  [],
);

// Oturumun görebileceği araçlar: alt ajanlar kısıtlı liste alır, ana ajan spawn_agent ve MCP araçlarını da görür
function toolDefsFor(session) {
  let defs = DEFS;
  // hafıza araçları yalnızca ana oturumda ve hafıza açıkken
  if (session.agentName || !require('./memory').enabled(session.cfg)) defs = defs.filter((d) => !MEMORY_TOOLS.has(d.function.name));
  if (session.allowedTools) defs = defs.filter((d) => session.allowedTools.has(d.function.name));
  if (session.mcp && session.mcp.defs.length && (!session.allowedTools || session.allowedTools.has('mcp'))) defs = [...defs, ...session.mcp.defs];
  if (!session.canSpawn) return defs;
  const hasTodo = defs.some((d) => d.function.name === 'todo_write');
  const extra = hasTodo ? [SPAWN_DEF, RUN_PLAN_DEF] : [SPAWN_DEF];
  return require('./orca-workers').available() ? [...defs, ...extra, WORKER_DEF] : [...defs, ...extra];
}

const MUTATING = new Set(['write_file', 'edit_file', 'run_command', 'run_background']);
const FILE_WRITE = new Set(['write_file', 'edit_file']);

function* walk(dir, base = dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(path.join(dir, e.name), base);
    } else yield { full: path.join(dir, e.name), rel: path.relative(base, path.join(dir, e.name)).split(path.sep).join('/') };
  }
}

// ---------- kabuk / arka plan ----------

function runShell(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawnShell(command, cwd);
    let out = '';
    const add = (d) => { if (out.length < MAX_OUT * 2) out += d.toString(); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { killTree(child); out += `\n[timeout after ${timeoutMs / 1000}s]`; }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

let bgCounter = 0;
function startBackground(session, command) {
  const child = spawnShell(command, session.cwd);
  const entry = { id: ++bgCounter, command, child, out: '', read: 0, done: false, code: null, started: Date.now() };
  const add = (d) => { entry.out += d.toString(); if (entry.out.length > 200000) { const cut = entry.out.length - 200000; entry.out = entry.out.slice(cut); entry.read = Math.max(0, entry.read - cut); } };
  child.stdout.on('data', add);
  child.stderr.on('data', add);
  child.on('error', (e) => { add(e.message); entry.done = true; entry.code = -1; });
  child.on('close', (code) => { entry.done = true; entry.code = code; });
  session.bg.set(entry.id, entry);
  return entry;
}

function killAll(session) {
  for (const e of (session.bg || new Map()).values()) if (!e.done) killTree(e.child);
}

// ---------- web ----------

function htmlToText(html) {
  const ent = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|pre)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|nbsp|apos|#39);/g, (m) => ent[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function webFetch(url, maxChars) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are supported.');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SyzerCLI)' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const type = res.headers.get('content-type') || '';
  const body = await res.text();
  const text = /html/i.test(type) ? htmlToText(body) : body;
  const out = text.length > maxChars ? text.slice(0, maxChars) + '\n…(truncated)' : text;
  return `HTTP ${res.status} ${url}\n\n${out}`;
}

async function webSearch(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
    signal: AbortSignal.timeout(20000),
  });
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && results.length < 8) {
    let url = m[1].replace(/&amp;/g, '&');
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    results.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3] || '') });
  }
  if (!results.length) throw new Error(`No results (search backend returned HTTP ${res.status}).`);
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
}

// ---------- geri alma ----------

function snapshot(session, p) {
  let content = null;
  try { content = fs.readFileSync(p, 'utf8'); } catch { /* dosya yoktu */ }
  (session.undo ||= []).push({ path: p, existed: content !== null, content });
  if (session.undo.length > 50) session.undo.shift();
}

function undoLast(session) {
  const e = session.undo && session.undo.pop();
  if (!e) return null;
  if (e.existed) fs.writeFileSync(e.path, e.content);
  else { try { fs.unlinkSync(e.path); } catch { /* zaten yok */ } }
  return { path: e.path, removed: !e.existed };
}

// ---------- düzenleme (tam eşleşme + esnek eşleşme) ----------

function exactMatches(src, needle) {
  const out = [];
  if (!needle) return out;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) { out.push({ start: i, end: i + needle.length }); i += needle.length; }
  return out;
}

// Satır başı/sonu boşluk farklarını yok sayan eşleşme (modeller girintiyi sık bozar)
function trimmedMatches(src, needle) {
  const sl = src.split('\n');
  const nl = needle.replace(/\r/g, '').split('\n').map((l) => l.trim());
  while (nl.length && nl[nl.length - 1] === '') nl.pop();
  if (!nl.length) return [];
  const offsets = [];
  let o = 0;
  for (const l of sl) { offsets.push(o); o += l.length + 1; }
  const out = [];
  for (let i = 0; i + nl.length <= sl.length; i++) {
    let ok = true;
    for (let k = 0; k < nl.length; k++) if (sl[i + k].replace(/\r$/, '').trim() !== nl[k]) { ok = false; break; }
    if (ok) out.push({ start: offsets[i], end: offsets[i + nl.length - 1] + sl[i + nl.length - 1].replace(/\r$/, '').length });
  }
  return out;
}

function applyEdit(src, oldStr, newStr, all) {
  if (!oldStr) return { err: { code: 'TOOL_FAILED', detail: 'old_string is empty', hint: 'Provide the exact text to replace.' } };
  let ms = exactMatches(src, oldStr);
  let neu = newStr;
  if (!ms.length && src.includes('\r\n') && !oldStr.includes('\r\n')) {
    ms = exactMatches(src, oldStr.replace(/\n/g, '\r\n'));
    neu = newStr.replace(/\r?\n/g, '\r\n');
  }
  let fuzzy = false;
  if (!ms.length) { ms = trimmedMatches(src, oldStr); fuzzy = ms.length > 0; }
  if (!ms.length) return { err: { code: 'EDIT_NOT_FOUND', detail: 'old_string was not found', hint: 'Re-read the file and copy the exact current text.' } };
  if (ms.length > 1 && !all) return { err: { code: 'EDIT_AMBIGUOUS', detail: `old_string matches ${ms.length} times`, hint: 'Add context or set replace_all=true.' } };
  const use = all ? ms : [ms[0]];
  let out = src;
  for (const m of [...use].reverse()) out = out.slice(0, m.start) + neu + out.slice(m.end);
  return { content: out, n: use.length, fuzzy };
}

const lineCount = (s) => (s === '' ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0));

function prepareChange(name, a, abs) {
  const p = abs(a.path);
  if (name === 'write_file') {
    let before = '';
    let existed = true;
    try { before = fs.readFileSync(p, 'utf8'); } catch { existed = false; }
    return { p, before, after: a.content ?? '', existed };
  }
  const src = fs.readFileSync(p, 'utf8');
  const edits = Array.isArray(a.edits) && a.edits.length ? a.edits : [{ old_string: a.old_string, new_string: a.new_string, replace_all: a.replace_all }];
  let cur = src;
  let n = 0;
  let fuzzy = false;
  for (const [i, e] of edits.entries()) {
    const r = applyEdit(cur, e.old_string, e.new_string ?? '', e.replace_all || a.replace_all);
    if (r.err) return { err: edits.length > 1 ? { ...r.err, detail: `edit #${i + 1}: ${r.err.detail}` } : r.err };
    cur = r.content; n += r.n; fuzzy = fuzzy || r.fuzzy;
  }
  return { p, before: src, after: cur, existed: true, n, fuzzy };
}

// ---------- görünüm ----------

function describe(name, a, cwd) {
  const rel = (p) => { if (!p || !cwd) return p || ''; const r = path.relative(cwd, path.resolve(cwd, p)); return r && !r.startsWith('..') ? r : p; };
  switch (name) {
    case 'run_command': case 'run_background': return a.command;
    case 'search_files': return `${a.pattern}${a.path ? ` in ${a.path}` : ''}`;
    case 'find_files': return a.pattern;
    case 'use_skill': return a.name;
    case 'memory_save': case 'memory_forget': return a.name;
    case 'web_fetch': return a.url;
    case 'web_search': return a.query;
    case 'bg_output': case 'bg_stop': return `#${a.id}`;
    case 'todo_write': return `${(a.todos || []).length} items`;
    case 'run_plan': return 'orchestra';
    case 'spawn_syzer': return `worker: ${a.title || String(a.prompt || '').slice(0, 50)}`;
    case 'spawn_agent': return `${a.agent || 'general'}: ${a.description || String(a.prompt || '').slice(0, 50)}`;
    default:
      if (name.startsWith('mcp__')) return name.replace(/^mcp__/, '').replace('__', ' · ');
      return rel(a.path);
  }
}

const TODO_STATUS = ['pending', 'in_progress', 'completed'];
const DEP_WORDS = /(depends? on|depending on|based on (the )?(results?|reports?|output|findings)|after (the )?(other|previous|first)|using the (results?|reports?|output) of)|bağlı|bağımlı|önceki (adım|madde|sonuç|rapor)|(sonuçlar|raporlar|bulgular)ına göre/i;

// Katı doğrulama: model neyi düzelteceğini hata mesajından anlar
function validateTodos(todos, planDone = null) {
  if (!Array.isArray(todos) || !todos.length) return { error: 'todos must be a non-empty array of {content, status}.' };
  const list = [];
  const seen = new Set();
  const ids = new Set();
  for (const [i, x] of todos.entries()) {
    const content = String((x && x.content) || '').trim();
    if (!content) return { error: `todos[${i}] has empty content.` };
    if (!x || !TODO_STATUS.includes(x.status)) return { error: `todos[${i}] has invalid status "${x && x.status}"; use pending, in_progress or completed.` };
    if (seen.has(content.toLowerCase())) return { error: `todos[${i}] duplicates another item ("${content}").` };
    seen.add(content.toLowerCase());
    const id = String(x.id || `t${i + 1}`).trim();
    if (ids.has(id)) return { error: `todos[${i}] reuses id "${id}"; ids must be unique.` };
    ids.add(id);
    const item = { id, content, status: x.status };
    if (x.agent) item.agent = String(x.agent).trim();
    if (x.model) item.model = String(x.model).trim();
    if (x.prompt) item.prompt = String(x.prompt);
    if (Array.isArray(x.depends_on) && x.depends_on.length) item.depends_on = x.depends_on.map((d) => String(d).trim());
    if (item.depends_on && !item.agent) return { error: `todos[${i}] ("${id}") has depends_on but no agent; only agent items are scheduled by run_plan.` };
    list.push(item);
  }
  // Metin başka maddelerin çıktısına dayandığını söylüyor ama depends_on boş: aynı dalgada girdisiz çalışır
  for (const x of list) {
    if (x.agent && !x.depends_on && DEP_WORDS.test(`${x.content} ${x.prompt || ''}`)) {
      return { error: `item "${x.id}" says it depends on other items but has no depends_on. Set depends_on to their ids (give items explicit short ids), or reword it if it is really independent.` };
    }
  }
  // bağımlılıklar: var olan id'ler, kendine bağlanma yok, döngü yok
  const byId = new Map(list.map((x) => [x.id, x]));
  for (const x of list) for (const d of x.depends_on || []) {
    if (!byId.has(d)) return { error: `item "${x.id}" depends on unknown id "${d}".` };
    if (d === x.id) return { error: `item "${x.id}" depends on itself.` };
  }
  const state = new Map();
  const cyc = (id) => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const d of byId.get(id).depends_on || []) if (cyc(d)) return true;
    state.set(id, 2);
    return false;
  };
  for (const x of list) if (cyc(x.id)) return { error: `dependency cycle involving "${x.id}".` };

  // Ajan atanmış madde yalnızca run_plan ile tamamlanır; model kendi yaptıysa `agent` alanını kaldırmalı
  if (planDone) {
    const cheat = list.find((x) => x.agent && x.status === 'completed' && !planDone.has(x.id));
    if (cheat) return { error: `item "${cheat.id}" has agent "${cheat.agent}" but was not run by run_plan. Do not do agent items yourself: leave it pending and call run_plan, or remove its "agent" if you really did it yourself.` };
  }
  const orchestrated = list.some((x) => x.agent); // run_plan paralel çalıştırır: birden çok in_progress olabilir
  const active = list.filter((x) => x.status === 'in_progress').length;
  const finished = list.every((x) => x.status === 'completed');
  if (!orchestrated) {
    if (active > 1) return { error: `${active} items are in_progress; keep exactly one in_progress.` };
    if (!active && !finished) return { error: 'No item is in_progress; mark the one you are working on as in_progress.' };
  }
  return { list, orchestrated };
}

// compact: biten maddeler tek satıra katlanır (her güncellemede ekranı doldurmasın)
function renderTodos(todos, compact = false) {
  const tag = (x) => (x.agent ? C.gray(`  [${x.agent}${x.model ? ' · ' + String(x.model).split('/').pop().replace(':free', '') : ''}${x.depends_on ? ' ← ' + x.depends_on.join(',') : ''}]`) : '');
  const line = (x) => {
    if (x.status === 'completed') return `    ${C.green('☑')} ${C.dim(x.content)}${tag(x)}`;
    if (x.status === 'in_progress') return `    ${C.cyan('▶')} ${C.bold(x.content)}${tag(x)}`;
    if (x.error) return `    ${C.red('✗')} ${x.content}${tag(x)} ${C.red(String(x.error).slice(0, 60))}`;
    return `    ${C.gray('☐')} ${x.content}${tag(x)}`;
  };
  const done = todos.filter((x) => x.status === 'completed');
  if (!compact || done.length < 3 || done.length === todos.length) return todos.map(line).join('\n');
  return [`    ${C.green('☑')} ${C.dim(`${done.length} completed`)}`, ...todos.filter((x) => x.status !== 'completed').map(line)].join('\n');
}

// ---------- ana yürütücü ----------

const rootOf = (s) => s; // alt ajan oturumları paylaşılan alanları getter ile ana oturuma bağlar

async function execute(call, session) {
  let a;
  try { a = JSON.parse(call.arguments || '{}'); }
  catch { return P.failure('INVALID_JSON', 'tool arguments are not valid JSON', 'Retry with an object.'); }

  const name = call.name;
  const cwd = session.cwd;
  const isMcp = name.startsWith('mcp__');
  if (session.allowedTools && !isMcp && !session.allowedTools.has(name)) return P.failure('TOOL_FAILED', `tool not available to this agent: ${name}`);

  // 1) kurallar ve tehlikeli komut engeli
  const { verdict, rule } = perms.decide(session.settings, name, a, cwd);
  if (verdict === 'deny') return P.failure('TOOL_FAILED', t('blocked_rule', rule));
  if ((name === 'run_command' || name === 'run_background') && perms.dangerous(a.command)) return P.failure('TOOL_FAILED', t('blocked_danger'));

  // 2) PreToolUse hook'ları
  const pre = await hooks.pre(session.settings, name, a, cwd);
  if (pre.block) return P.failure('TOOL_FAILED', t('hook_blocked', pre.message));

  const result = await runTool(name, a, call, session, verdict === 'allow', verdict === 'ask');

  // Kendi kodundaki hata (AttributeError/ImportError/NameError…): modele düzeltme ipucu ekle
  if ((name === 'run_command' || name === 'bg_output') && typeof result.output === 'string') {
    const hint = P.tracebackHint(result.output, { language: require('./i18n').getLang() });
    if (hint) result.output = `${result.output}\n\n${hint}`;
  }

  // 3) PostToolUse hook'ları
  if (result.ok) {
    const note = await hooks.post(session.settings, name, a, result, cwd);
    if (note) {
      result.output = `${result.output}\n\n${note}`;
      result.ui = result.ui || { summary: '' };
      result.ui.body = `${result.ui.body ? result.ui.body + '\n' : ''}${C.gray('    ' + note.split('\n')[0].slice(0, 120))}`;
    }
  }
  return P.formatToolResult(result);
}

async function runTool(name, a, call, session, allowedByRule, forceAsk = false) {
  const cwd = session.cwd;
  const abs = (p) => path.resolve(cwd, p || '.');
  const isMcp = name.startsWith('mcp__');

  try {
    let change = null;
    let ops = null;
    if (MUTATING.has(name) || isMcp) {
      if (session.plan) return P.failure('TOOL_FAILED', t('plan_block'));
      if (session.perm === 'readonly') return P.failure('TOOL_FAILED', t('readonly_block'));
      const outside = FILE_WRITE.has(name) && perms.isOutside(cwd, a.path, undefined, session.settings && session.settings.additionalDirectories);
      if (outside && session.perm === 'auto' && session.canAsk === false) {
        return P.failure('E_OUTSIDE_WORKSPACE', 'path is outside the workspace');
      }
      if (FILE_WRITE.has(name)) {
        change = prepareChange(name, a, abs);
        if (change.err) return P.failure(change.err.code, change.err.detail, change.err.hint);
        ops = diffLines(change.before, change.after);
      }
      // `ask` kuralı auto modda bile onay ister (allow'dan önce değerlendirilir)
      const needAsk = forceAsk || (!allowedByRule && (session.perm === 'ask' || (session.perm === 'auto' && outside && session.canAsk)));
      if (needAsk) {
        let preview = '';
        if (ops) preview = renderDiff(ops, { maxRows: change.existed ? 30 : 15, indent: 2 });
        else if (isMcp) preview = `  ${C.gray(JSON.stringify(a).slice(0, 300))}`;
        const top = !session.agentName;
        if (top) require('./orca-hooks').waiting(name);
        const verdict = await session.confirm(name, describe(name, a, cwd), preview);
        if (top) require('./orca-hooks').resumed();
        if (verdict === 'always') session.perm = 'auto';
        else if (verdict === 'rule') {
          const r = perms.suggestRule(name, a);
          settingsMod.writeRule(cwd, 'allow', r);
          session.settings.allow.push(r);
          session.out.notice && session.out.notice(t('rule_added', 'allow', r));
        } else if (verdict === 'session') { // "bu oturum için": kalıcı yazmadan yalnızca bellekteki kurallara ekle
          const r = perms.suggestRule(name, a);
          if (session.settings) {
            const al = (session.settings.allow ||= []);
            if (!al.includes(r)) al.push(r);
          }
        } else if (verdict !== 'yes') return P.failure('TOOL_FAILED', t('denied'));
      }
      // git checkpoint: turdaki ilk değişiklikten önce
      if (!isMcp && !session.cpDone) {
        session.cpDone = true;
        try {
          const h = gitMod.checkpoint(cwd);
          if (h) (session.checkpoints ||= []).push({ hash: h, ts: Date.now(), label: describe(name, a, cwd).slice(0, 60) });
        } catch { /* git yok */ }
      }
    }

    if (isMcp) {
      if (!session.mcp) return P.failure('TOOL_FAILED', 'MCP is not available');
      const r = await session.mcp.call(name, a);
      return { ok: r.ok, output: r.ok ? clip(r.text) : P.error('TOOL_FAILED', r.text || 'MCP tool reported an error'), ui: { summary: String(r.text || '').split('\n')[0].slice(0, 80) || 'ok' } };
    }

    switch (name) {
      case 'read_file': {
        const lines = fs.readFileSync(abs(a.path), 'utf8').split('\n');
        const start = Math.max(1, a.offset || 1);
        const end = a.limit ? start + a.limit - 1 : lines.length;
        const slice = lines.slice(start - 1, end);
        return { ok: true, output: clip(slice.map((l, i) => `${start + i}\t${l}`).join('\n')), ui: { summary: t('sum_read', slice.length) } };
      }
      case 'write_file':
      case 'edit_file': {
        snapshot(session, change.p);
        const cps = require('./checkpoints').store();
        cps.record(session.sessionId, change.p);
        fs.mkdirSync(path.dirname(change.p), { recursive: true });
        fs.writeFileSync(change.p, change.after);
        cps.wrote(session.sessionId, change.p);
        const { added, removed } = countOps(ops);
        const isNew = name === 'write_file' && !change.existed;
        const summary = isNew ? t('sum_wrote', lineCount(change.after)) : t('sum_diff', added, removed);
        return {
          ok: true,
          output: name === 'write_file' ? `Wrote ${change.p}` : `Edited ${change.p} (${change.n} replacement(s)${change.fuzzy ? ', whitespace-insensitive match' : ''})`,
          ui: { summary, body: renderDiff(ops, { maxRows: isNew ? 15 : 40 }), stat: { add: added, del: removed, path: path.relative(session.cwd, change.p) || change.p } },
        };
      }
      case 'list_dir': {
        const entries = fs.readdirSync(abs(a.path), { withFileTypes: true });
        return { ok: true, output: entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') || '(empty)', ui: { summary: t('sum_found', entries.length) } };
      }
      case 'find_files': {
        const re = globToRegex(a.pattern);
        const hits = [];
        for (const f of walk(cwd)) { if (re.test(f.rel)) hits.push(f.rel); if (hits.length >= 200) break; }
        return { ok: true, output: hits.join('\n') || '(no matches)', ui: { summary: hits.length ? t('sum_found', hits.length) : t('sum_none') } };
      }
      case 'search_files': {
        const re = new RegExp(a.pattern, 'i');
        const filter = a.glob ? globToRegex(a.glob.includes('/') ? a.glob : `**/${a.glob}`) : null;
        const hits = [];
        for (const f of walk(abs(a.path))) {
          if (filter && !filter.test(f.rel)) continue;
          let text;
          try { if (fs.statSync(f.full).size > 1_000_000) continue; text = fs.readFileSync(f.full, 'utf8'); } catch { continue; }
          if (text.includes('\0')) continue;
          const ls = text.split('\n');
          for (let i = 0; i < ls.length && hits.length < 100; i++) if (re.test(ls[i])) hits.push(`${f.rel}:${i + 1}: ${ls[i].trim().slice(0, 200)}`);
          if (hits.length >= 100) break;
        }
        return { ok: true, output: hits.join('\n') || '(no matches)', ui: { summary: hits.length ? t('sum_found', hits.length) : t('sum_none') } };
      }
      case 'run_command': {
        const { code, out } = await runShell(a.command, cwd, (a.timeout_seconds || 60) * 1000);
        const lines = out.trim().split('\n').filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1));
        const shown = lines.slice(0, 8).map((l) => C.gray('    ' + l.slice(0, 160)));
        if (lines.length > 8) shown.push(C.gray('    ' + t('sum_lines', lines.length - 8)));
        return { ok: code === 0, output: code === 0 ? clip(`${out.trim()}\n[exit ${code}]`) : `${P.error('TOOL_FAILED', `command exited with code ${code}`)}${out.trim() ? `\n${clip(out.trim())}` : ''}`, ui: { summary: `exit ${code}`, body: shown.join('\n') } };
      }
      case 'run_background': {
        const e = startBackground(session, a.command);
        return { ok: true, output: `Started background task #${e.id}: ${a.command}`, ui: { summary: `#${e.id}` } };
      }
      case 'bg_output': {
        const e = session.bg.get(a.id);
        if (!e) return P.failure('TOOL_FAILED', `no such task: ${a.id}`);
        const fresh = e.out.slice(e.read);
        e.read = e.out.length;
        const status = e.done ? `exited ${e.code}` : 'running';
        return { ok: true, output: clip(`[${status}]\n${fresh.trim() || '(no new output)'}`), ui: { summary: status } };
      }
      case 'bg_stop': {
        const e = session.bg.get(a.id);
        if (!e) return P.failure('TOOL_FAILED', `no such task: ${a.id}`);
        if (!e.done) killTree(e.child);
        return { ok: true, output: `Stopped #${a.id}`, ui: { summary: `#${a.id}` } };
      }
      case 'web_fetch': {
        const text = await webFetch(a.url, a.max_chars || 12000);
        return { ok: true, output: text, ui: { summary: `${text.split('\n')[0]}`.slice(0, 80) } };
      }
      case 'web_search': {
        const text = await webSearch(a.query);
        return { ok: true, output: text, ui: { summary: t('sum_found', text.split('\n').filter((l) => /^\d+\./.test(l)).length) } };
      }
      case 'todo_write': {
        const v = validateTodos(a.todos, session.planDone || new Set());
        if (v.error) return P.failure('TOOL_FAILED', v.error);
        const list = v.list;
        const done = list.filter((x) => x.status === 'completed').length;
        const cur = list.find((x) => x.status === 'in_progress');
        const next = list.find((x) => x.status === 'pending');
        const planned = v.orchestrated && list.some((x) => x.agent && x.status === 'pending');
        if (done === list.length) {
          session.todos = []; // hepsi bitti: liste temizlenir
          session.planDone = new Set();
          if (!session.agentName) require('./orca-hooks').plan([]);
          return { ok: true, output: `All ${done} tasks completed. Todo list cleared.`, ui: { summary: `${done}/${done}`, body: renderTodos(list, true) } };
        }
        session.todos = list;
        if (!session.agentName) require('./orca-hooks').plan(list);
        const state = planned ? 'agent items are pending: call run_plan to execute the ready ones' : cur ? `now: "${cur.content}"` : `next: "${next.content}" (mark it in_progress before starting)`;
        return { ok: true, output: `Todo list updated: ${done}/${list.length} done, ${state}.`, ui: { summary: `${done}/${list.length}`, body: renderTodos(list, true) } };
      }
      case 'use_skill': {
        const s = (session.skills || []).find((x) => x.name === a.name);
        if (!s) return P.failure('TOOL_FAILED', `unknown skill: ${a.name}`);
        return { ok: true, output: clip(`Skill file: ${s.file}\n\n${loadBody(s.file)}`), ui: { summary: s.name } };
      }
      case 'memory_save':
      case 'memory_forget': {
        const mem = require('./memory');
        if (session.agentName || !mem.enabled(session.cfg)) return P.failure('TOOL_FAILED', 'memory is disabled');
        if (session.perm === 'readonly') return P.failure('TOOL_FAILED', t('readonly_block'));
        try {
          if (name === 'memory_save') {
            const r = mem.save(cwd, a);
            return { ok: true, output: `${r.created ? 'Saved' : 'Updated'} memory "${r.name}"`, ui: { summary: `${r.created ? 'saved' : 'updated'} ${r.name}` } };
          }
          const gone = mem.forget(cwd, a.name);
          if (!gone) return P.failure('TOOL_FAILED', `no such memory: ${a.name}`);
          return { ok: true, output: `Forgot memory "${String(a.name).trim().toLowerCase()}"`, ui: { summary: `forgot ${a.name}` } };
        } catch (e) {
          if (e instanceof mem.MemoryError) return P.failure('TOOL_FAILED', e.message);
          throw e;
        }
      }
      default:
        return P.failure('TOOL_FAILED', `unknown tool: ${name}`);
    }
  } catch (e) {
    return P.failure('TOOL_FAILED', e.message);
  }
}

module.exports = { DEFS, SPAWN_DEF, RUN_PLAN_DEF, toolDefsFor, execute, describe, MUTATING, undoLast, killAll, renderTodos, validateTodos, rootOf, htmlToText, webSearch, webFetch };
