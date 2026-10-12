'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { getLang } = require('./i18n');
const P = require('./prompts');
const { LIMITS } = require('./limits');

const MAX_FILE = LIMITS.instructionFile;
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
    prompt: P.role({ name: 'explore' }),
  },
  {
    name: 'plan', builtin: true, model: null, tools: READ_TOOLS,
    description: 'Read-only planner. Studies the code and returns a step-by-step implementation plan.',
    prompt: P.role({ name: 'plan' }),
  },
  {
    name: 'general', builtin: true, model: null, tools: ALL_TOOLS,
    description: 'General-purpose worker that can read and edit files and run commands to complete a self-contained task.',
    prompt: P.role({ name: 'general' }),
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
function subSystem(ctx, agent, language = getLang()) {
  return P.subagentSystem({ ctx, agent, language });
}

// --- Sistem istemi ---

function buildContext(cwd) {
  const files = instructionFiles(cwd);
  const skills = findSkills(cwd);
  const commands = findCommands(cwd);
  const agents = findAgents(cwd);

  const input = { cwd, platform: process.platform, language: getLang(), skills, instructionFiles: files, agents };
  return { system: P.leadSystem(input), header: P.base(input), files, skills, commands, agents };
}

module.exports = { buildContext, loadBody, findSkills, findCommands, findAgents, subSystem, parseFrontmatter };
