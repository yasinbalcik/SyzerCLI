'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { LANGS, getLang } = require('./i18n');

const MAX_FILE = 12000;
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// --- Talimat dosyaları (CLAUDE.md, AGENTS.md, OPENROUTER.md) ---

function instructionFiles(cwd) {
  const names = ['SYZER.md', 'OPENROUTER.md', 'CLAUDE.md', 'AGENTS.md', path.join('.claude', 'CLAUDE.md')];
  const dirs = [];
  let d = cwd;
  for (let i = 0; i < 5; i++) {
    dirs.push(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  const candidates = [
    path.join(config.DIR, 'SYZER.md'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    ...dirs.reverse().flatMap((dir) => names.map((n) => path.join(dir, n))),
  ];
  const seen = new Set();
  const out = [];
  for (const p of candidates) {
    const txt = readSafe(p);
    if (txt == null) continue;
    let real = p;
    try { real = fs.realpathSync(p); } catch { /* yok say */ }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({ path: p, text: txt.length > MAX_FILE ? txt.slice(0, MAX_FILE) + '\n…(truncated)' : txt });
  }
  return out;
}

// --- Frontmatter ---

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === '>' || v === '|' || v === '>-' || v === '|-') {
      const parts = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(' ');
    }
    meta[kv[1]] = v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

// --- Skill'ler: <dir>/<ad>/SKILL.md ---

function findSkills(cwd) {
  const roots = [
    path.join(cwd, '.syzer', 'skills'),
    path.join(cwd, '.openrouter', 'skills'),
    path.join(cwd, '.claude', 'skills'),
    path.join(config.DIR, 'skills'),
    path.join(os.homedir(), '.claude', 'skills'),
  ];
  const skills = new Map();
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const file = path.join(root, name, 'SKILL.md');
      const src = readSafe(file);
      if (src == null || skills.has(name)) continue; // proje, global'den önce gelir
      const { meta } = parseFrontmatter(src);
      skills.set(name, { name: meta.name || name, description: meta.description || '', file });
    }
  }
  return [...skills.values()];
}

// --- Özel komutlar: <dir>/<ad>.md ---

function findCommands(cwd) {
  const roots = [
    path.join(cwd, '.syzer', 'commands'),
    path.join(cwd, '.openrouter', 'commands'),
    path.join(cwd, '.claude', 'commands'),
    path.join(config.DIR, 'commands'),
    path.join(os.homedir(), '.claude', 'commands'),
  ];
  const cmds = new Map();
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith('.md')) continue;
      const name = f.slice(0, -3);
      if (cmds.has(name)) continue;
      const file = path.join(root, f);
      const src = readSafe(file);
      if (src == null) continue;
      const { meta } = parseFrontmatter(src);
      cmds.set(name, { name, description: meta.description || '', file });
    }
  }
  return [...cmds.values()];
}

function loadBody(file, args = '') {
  const { body } = parseFrontmatter(readSafe(file) || '');
  return body.replace(/\$ARGUMENTS/g, args).trim();
}

// --- Alt ajan tanımları: <dir>/<ad>.md (Claude .claude/agents biçimi) ---

const READ_TOOLS = ['read_file', 'list_dir', 'find_files', 'search_files', 'use_skill', 'web_fetch', 'web_search'];
const ALL_TOOLS = [...READ_TOOLS, 'write_file', 'edit_file', 'run_command', 'run_background', 'bg_output', 'bg_stop', 'mcp']; // todo_write alt ajanlara verilmez (liste ana oturumda görünür)
const CLAUDE_TOOL = {
  read: 'read_file', write: 'write_file', edit: 'edit_file', multiedit: 'edit_file',
  bash: 'run_command', grep: 'search_files', glob: 'find_files', ls: 'list_dir',
  webfetch: 'web_fetch', websearch: 'web_search',
};

const BUILTIN_AGENTS = [
  {
    name: 'explore', builtin: true, model: null, tools: READ_TOOLS,
    description: 'Fast read-only exploration of the codebase or a topic. Returns findings with file paths and line numbers.',
    prompt: 'You are an exploration agent. You can only read: list, find, search and read files. Never modify anything. ' +
      'Investigate thoroughly but efficiently, then report concrete findings (file paths, line numbers, short quotes).',
  },
  {
    name: 'plan', builtin: true, model: null, tools: READ_TOOLS,
    description: 'Read-only planner. Studies the code and returns a step-by-step implementation plan.',
    prompt: 'You are a planning agent. You can only read. Study the relevant code, then return a concise numbered ' +
      'implementation plan listing the exact files to change and the risks. Do not modify anything.',
  },
  {
    name: 'general', builtin: true, model: null, tools: ALL_TOOLS,
    description: 'General-purpose worker that can read and edit files and run commands to complete a self-contained task.',
    prompt: 'You are a worker agent. Complete the assigned task fully using your tools, then report what you did.',
  },
];

function findAgents(cwd) {
  const roots = [
    path.join(cwd, '.syzer', 'agents'),
    path.join(cwd, '.openrouter', 'agents'),
    path.join(cwd, '.claude', 'agents'),
    path.join(config.DIR, 'agents'),
    path.join(os.homedir(), '.claude', 'agents'),
  ];
  const custom = new Map();
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const f of fs.readdirSync(root)) {
      if (!f.endsWith('.md')) continue;
      const src = readSafe(path.join(root, f));
      if (src == null) continue;
      const { meta, body } = parseFrontmatter(src);
      const name = meta.name || f.slice(0, -3);
      if (custom.has(name)) continue;
      let tools = ALL_TOOLS;
      if (meta.tools) {
        const mapped = meta.tools.split(/[,\s]+/).filter(Boolean)
          .map((x) => CLAUDE_TOOL[x.toLowerCase()] || (ALL_TOOLS.includes(x) ? x : null)).filter(Boolean);
        if (mapped.length) tools = [...new Set([...mapped, 'use_skill'])];
      }
      custom.set(name, {
        name, builtin: false, file: path.join(root, f), tools,
        model: meta.model && meta.model.includes('/') ? meta.model : null, // Claude model adları (sonnet vb.) yok sayılır
        description: meta.description || '',
        prompt: body.trim(),
      });
    }
  }
  const merged = BUILTIN_AGENTS.filter((b) => !custom.has(b.name));
  return [...merged, ...custom.values()];
}

// Alt ajanın sistem istemi
function subSystem(ctx, agent) {
  return [
    ctx.header,
    agent.prompt,
    'You are a subagent working for a lead agent. You cannot ask the user questions. ' +
      'Finish the task, then reply with a concise final report (findings, file paths, results). The lead only sees that report.',
    ...ctx.files.map((f) => `--- ${f.path} ---\n${f.text}`),
  ].filter(Boolean).join('\n\n');
}

// --- Sistem istemi ---

function buildContext(cwd) {
  const files = instructionFiles(cwd);
  const skills = findSkills(cwd);
  const commands = findCommands(cwd);
  const agents = findAgents(cwd);

  const parts = [
    `You are SyzerCLI, a capable coding and general-purpose agent running in the user's terminal.`,
    `Working directory: ${cwd}`,
    `Platform: ${process.platform}. Shell for run_command: ${process.platform === 'win32' ? 'PowerShell' : 'sh'}.`,
    `Reply in ${LANGS[getLang()] || 'English'} unless the user writes in another language.`,
    `Use tools to inspect and change files instead of guessing. Read a file before editing it. ` +
      `Prefer edit_file for small changes (several at once via its edits array) and write_file for new files. Keep answers concise. ` +
      `Use todo_write only for substantial work with 3+ genuinely distinct steps (or when asked); never for single-step tasks, questions or chat. ` +
      `Keep exactly one item in_progress, mark items completed right after finishing them, and do not end your turn with unfinished items. ` +
      `Use web_search/web_fetch when you need current information. Use run_background for servers or long-running commands.`,
  ];
  const header = parts.join('\n');

  if (skills.length) {
    parts.push(
      'Available skills (call the use_skill tool with the exact name to load full instructions when relevant):\n' +
        skills.slice(0, 40).map((s) => `- ${s.name}: ${s.description.slice(0, 140)}`).join('\n'),
    );
  }
  parts.push(
    'Subagents: for independent or exploratory subtasks, delegate with the spawn_agent tool. Each subagent starts with a ' +
      'fresh context and only sees the prompt you give it, so make the prompt self-contained. Call spawn_agent several ' +
      'times in ONE response to run subagents in parallel. Do trivial work yourself. ' +
      'ORCHESTRA: for a big job you are the orchestrator. Write the plan with todo_write, giving each item an id, an agent, a self-contained prompt and depends_on ids ' +
      '(independent items have none and run in parallel; later items get the reports of what they depend on). Optionally set a per-item model. ' +
      'Subagents only see their own prompt: copy the user constraints (read-only, do not modify files, language, scope) into every agent prompt, and use read-only agents (explore, plan) for analysis items. ' +
      'Plan FIRST: write the todo_write plan before reading files yourself, and never do an agent item yourself (it cannot be marked completed except by run_plan). ' +
      'Then call run_plan; it runs the ready items in waves, retries a stalled agent once, and marks items completed. Afterwards verify the reports. ' +
      'The final synthesis/report is YOURS: add it as a last item WITHOUT an agent (never delegate writing the final answer), and if one item needs the output of another, list it in depends_on. ' +
      'Use this only when the work splits into 3+ separable pieces; otherwise just work directly. Available agents:\n' +
      agents.map((a) => `- ${a.name}: ${a.description.slice(0, 140)}`).join('\n'),
  );
  for (const f of files) parts.push(`--- ${f.path} ---\n${f.text}`);

  return { system: parts.join('\n\n'), header, files, skills, commands, agents };
}

module.exports = { buildContext, loadBody, findSkills, findCommands, findAgents, subSystem, parseFrontmatter };
