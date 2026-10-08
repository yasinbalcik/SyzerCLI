'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');

const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// Okunan dosyalar (sıra: kullanıcı → proje).
// Kendi dosyalarımız tam yetkilidir. Claude Code ayarlarından yalnızca `deny` kuralları alınır:
// Claude'un allow/hook ayarları bu CLI'da sessizce çalışmasın (güvenli taraf).
function files(cwd) {
  return [
    { file: path.join(config.DIR, 'settings.json'), own: true },
    { file: path.join(os.homedir(), '.claude', 'settings.json'), own: false },
    { file: path.join(cwd, '.claude', 'settings.json'), own: false },
    { file: path.join(cwd, '.claude', 'settings.local.json'), own: false },
    { file: path.join(cwd, '.openrouter', 'settings.json'), own: true },
    { file: path.join(cwd, '.syzer', 'settings.json'), own: true },
    { file: path.join(cwd, '.syzer', 'settings.local.json'), own: true },
    { file: path.join(cwd, '.openrouter', 'settings.local.json'), own: true },
  ];
}

// Hook girdisini { matcher, command, timeout } listesine çevirir (Claude'un iç içe biçimi + düz biçim)
function normalizeHooks(list) {
  const out = [];
  for (const h of list || []) {
    const matcher = h.matcher || '*';
    const cmds = h.hooks ? h.hooks : [h];
    for (const c of cmds) if (c && c.command) out.push({ matcher, command: c.command, timeout: c.timeout || 30 });
  }
  return out;
}

function load(cwd) {
  const s = { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [] }, mcpServers: {}, sources: [] };
  for (const { file, own } of files(cwd)) {
    const j = read(file);
    if (!j) continue;
    s.deny.push(...(j.permissions?.deny || []));
    if (!own) { if ((j.permissions?.deny || []).length) s.sources.push(file); continue; }
    s.sources.push(file);
    s.allow.push(...(j.permissions?.allow || []));
    s.hooks.PreToolUse.push(...normalizeHooks(j.hooks?.PreToolUse));
    s.hooks.PostToolUse.push(...normalizeHooks(j.hooks?.PostToolUse));
    Object.assign(s.mcpServers, j.mcpServers || {});
  }
  // MCP: Claude'un .mcp.json dosyası ve bizim mcp.json dosyaları
  for (const f of [path.join(config.DIR, 'mcp.json'), path.join(cwd, '.mcp.json'), path.join(cwd, '.openrouter', 'mcp.json'), path.join(cwd, '.syzer', 'mcp.json')]) {
    const j = read(f);
    if (j && j.mcpServers) Object.assign(s.mcpServers, j.mcpServers);
  }
  return s;
}

// Kalıcı kural yazma: proje içindeki .openrouter/settings.json
function projectFile(cwd) { return path.join(cwd, '.syzer', 'settings.json'); }

function writeRule(cwd, kind, rule) {
  const file = projectFile(cwd);
  const j = read(file) || {};
  j.permissions ||= {};
  const list = (j.permissions[kind] ||= []);
  if (!list.includes(rule)) list.push(rule);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return file;
}

function removeRule(cwd, kind, rule) {
  const file = projectFile(cwd);
  const j = read(file);
  if (!j || !j.permissions || !j.permissions[kind]) return false;
  const before = j.permissions[kind].length;
  j.permissions[kind] = j.permissions[kind].filter((r) => r !== rule);
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return j.permissions[kind].length < before;
}

module.exports = { load, writeRule, removeRule, projectFile };
