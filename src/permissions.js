'use strict';

const path = require('path');
const { globToRegex } = require('./glob');

// Kendi araç adlarımız ↔ Claude tarzı kural adları
const CLAUDE_NAME = {
  read_file: 'Read', write_file: 'Write', edit_file: 'Edit', list_dir: 'LS', find_files: 'Glob',
  search_files: 'Grep', run_command: 'Bash', run_background: 'Bash', web_fetch: 'WebFetch', web_search: 'WebSearch',
  spawn_agent: 'Task', run_plan: 'Task', use_skill: 'Skill', todo_write: 'TodoWrite',
};

const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir']);

// Yıkıcı komutlar: hiçbir kural bunları açamaz
const DANGEROUS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r)[a-z]*\s+(\/|~|\$HOME|\*)(\s|$)/i,
  /\brm\s+(-[a-z]+\s+)*--no-preserve-root/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*\s(\/|[A-Za-z]:\\?|~|\$HOME|\$env:USERPROFILE|\$env:SystemRoot)(\s|$)/i,
  /\b(rd|rmdir)\s+\/s\b[^\n]*\s[A-Za-z]:\\?(\s|$)/i,
  /\bdel\s+(\/[a-z]\s+)*[A-Za-z]:\\\*?(\s|$)/i,
  /\bformat\s+[A-Za-z]:/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+[^\n]*\bof=\/dev\/(sd|nvme|hd|disk)/i,
  /:\(\)\s*\{[^}]*:\s*\|\s*:/,
  /\b(shutdown|Stop-Computer|Restart-Computer)\b/i,
  /\bgit\s+push\b[^\n]*\s(-f|--force)(\s|$)[^\n]*\b(main|master)\b/i,
];

function dangerous(command) {
  return DANGEROUS.some((re) => re.test(command || ''));
}

// "Bash(git status:*)" → { tool: 'bash', pattern: 'git status:*' }
function parseRule(rule) {
  const m = String(rule).trim().match(/^([\w.-]+)(?:\((.*)\))?$/s);
  return m ? { tool: m[1].toLowerCase(), pattern: m[2] } : null;
}

function toolMatches(ruleTool, name) {
  if (ruleTool === name.toLowerCase()) return true;
  if ((CLAUDE_NAME[name] || '').toLowerCase() === ruleTool) return true;
  // Claude'da Edit / Write / MultiEdit kuralları dosya değiştiren tüm araçları kapsar
  if ((name === 'write_file' || name === 'edit_file') && ['edit', 'write', 'multiedit'].includes(ruleTool)) return true;
  if (name.startsWith('mcp__') && name.toLowerCase().startsWith(ruleTool + '__')) return true; // "mcp__sunucu" tüm araçlarını kapsar
  return false;
}

function matchPattern(name, pattern, input, cwd) {
  if (pattern === undefined || pattern === '*' || pattern === '') return true;
  if (name === 'run_command' || name === 'run_background') {
    const cmd = String(input.command || '').trim();
    if (pattern.endsWith(':*')) { const p = pattern.slice(0, -2); return cmd === p || cmd.startsWith(p + ' '); }
    if (pattern.includes('*')) return new RegExp('^' + pattern.split('*').map((x) => x.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*') + '$', 'i').test(cmd);
    return cmd === pattern;
  }
  if (FILE_TOOLS.has(name)) {
    const abs = path.resolve(cwd, input.path || '.');
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    const re = globToRegex(pattern.replace(/\\/g, '/'));
    return re.test(rel) || re.test(abs.split(path.sep).join('/'));
  }
  if (name === 'web_fetch') return String(input.url || '').includes(pattern.replace(/^domain:/, ''));
  return false;
}

// 'deny' | 'allow' | null  (+ eşleşen kural)
function decide(settings, name, input, cwd) {
  if (!settings) return { verdict: null };
  for (const kind of ['deny', 'allow']) {
    for (const rule of settings[kind] || []) {
      const r = parseRule(rule);
      if (r && toolMatches(r.tool, name) && matchPattern(name, r.pattern, input, cwd)) return { verdict: kind, rule };
    }
  }
  return { verdict: null };
}

// "Hep izin ver" için önerilen kural
function suggestRule(name, input) {
  if (name === 'run_command' || name === 'run_background') {
    const words = String(input.command || '').trim().split(/\s+/);
    const n = ['git', 'npm', 'npx', 'pnpm', 'yarn', 'docker', 'cargo', 'go', 'dotnet', 'pip', 'node'].includes(words[0]) && words[1] ? 2 : 1;
    return `Bash(${words.slice(0, n).join(' ')}:*)`;
  }
  if (name.startsWith('mcp__')) return name;
  if (FILE_TOOLS.has(name)) return `${CLAUDE_NAME[name]}(${input.path})`;
  return CLAUDE_NAME[name] || name;
}

function isOutside(cwd, p) {
  const rel = path.relative(cwd, path.resolve(cwd, p || '.'));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

module.exports = { CLAUDE_NAME, dangerous, decide, suggestRule, parseRule, isOutside };
