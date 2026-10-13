'use strict';

// Plugin paketleme: <config.DIR>/plugins/<ad>/ altında plugin.json {name, version, description}
// + isteğe bağlı commands/, skills/, agents/, output-styles/, hooks.json, mcp.json.
// Etkin pluginler context.js (commands/skills/agents), settings.js (hooks/mcp) ve output-styles.js ile birleşir.
// Kapatma: cfg.plugins === false veya SYZER_PLUGINS=off.

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { writeJsonAtomic } = require('./atomic-json');

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_FILES = 2000;
const MAX_BYTES = 25 * 1024 * 1024;
const ROOT_TOKENS = /\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|SYZER_PLUGIN_ROOT)\}/g;

const validName = (n) => typeof n === 'string' && NAME_RE.test(n) && !n.includes('..');
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const baseDir = (o) => (o && o.base) || path.join(config.DIR, 'plugins');
const stateFile = (o) => path.join(baseDir(o), 'state.json');

// Kapalı mı? raw verilmezse config dosyası okunur (context.js gibi cfg'siz çağıranlar için)
function enabled(raw) {
  if (/^(off|0|false|no)$/i.test(String(process.env.SYZER_PLUGINS || '').trim())) return false;
  let r = raw;
  if (r === undefined) r = readJson(config.FILE);
  return !(r && r.plugins === false);
}

function disabledSet(o) {
  const j = readJson(stateFile(o));
  return new Set(j && Array.isArray(j.disabled) ? j.disabled.filter(validName) : []);
}

// Manifest doğrulama → { ok, manifest } | { ok:false, error }
function readManifest(dir) {
  const m = readJson(path.join(dir, 'plugin.json'));
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'plugin.json is missing or not valid JSON' };
  if (!validName(m.name)) return { ok: false, error: 'plugin.json: "name" must match [a-z0-9][a-z0-9._-]{0,63}' };
  if (typeof m.version !== 'string' || !m.version.trim() || m.version.length > 40) return { ok: false, error: 'plugin.json: "version" must be a non-empty string' };
  if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > 500)) return { ok: false, error: 'plugin.json: "description" must be a string (max 500 chars)' };
  return { ok: true, manifest: { name: m.name, version: m.version.trim(), description: m.description || '' } };
}

// Kurulu pluginler (bozuklar error alanıyla listelenir)
function list(o = {}) {
  const base = baseDir(o);
  let names = [];
  try { names = fs.readdirSync(base).filter((n) => !n.startsWith('.') && validName(n)).sort(); } catch { return []; }
  const off = disabledSet(o);
  const out = [];
  for (const name of names) {
    const dir = path.join(base, name);
    if (!isDir(dir)) continue;
    const r = readManifest(dir);
    if (!r.ok) { out.push({ name, dir, error: r.error, enabled: false }); continue; }
    if (r.manifest.name !== name) { out.push({ name, dir, error: 'plugin.json name does not match its folder', enabled: false }); continue; }
    out.push({ ...r.manifest, dir, enabled: !off.has(name), hooks: fs.existsSync(path.join(dir, 'hooks.json')), mcp: fs.existsSync(path.join(dir, 'mcp.json')) });
  }
  return out;
}

function active(o = {}) {
  if (!enabled(o.raw)) return [];
  return list(o).filter((p) => p.enabled && !p.error);
}

// Etkin pluginlerin alt klasörleri (kind: commands | skills | agents | output-styles)
function roots(kind, o = {}) {
  if (!['commands', 'skills', 'agents', 'output-styles'].includes(kind)) return [];
  return active(o).map((p) => path.join(p.dir, kind)).filter(isDir);
}

const subst = (v, dir) => {
  if (typeof v === 'string') return v.replace(ROOT_TOKENS, () => dir);
  if (Array.isArray(v)) return v.map((x) => subst(x, dir));
  if (v && typeof v === 'object') { const r = {}; for (const [k, x] of Object.entries(v)) r[k] = subst(x, dir); return r; }
  return v;
};

function rawHooks(dir) {
  const j = readJson(path.join(dir, 'hooks.json'));
  if (!j || typeof j !== 'object') return {};
  const src = j.hooks && typeof j.hooks === 'object' && !Array.isArray(j.hooks) ? j.hooks : j;
  const out = {};
  for (const [ev, list_] of Object.entries(src)) if (/^\w+$/.test(ev) && Array.isArray(list_)) out[ev] = list_;
  return out;
}

function rawMcp(dir) {
  const j = readJson(path.join(dir, 'mcp.json'));
  if (!j || typeof j !== 'object') return {};
  const src = j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : j;
  const out = {};
  for (const [n, def] of Object.entries(src)) if (def && typeof def === 'object' && !Array.isArray(def)) out[n] = def;
  return out;
}

// Etkin pluginlerin kancaları: { olay: [ham giriş...] } (settings.js normalizeHooks ile işler)
function hooks(o = {}) {
  const out = {};
  for (const p of active(o)) {
    for (const [ev, l] of Object.entries(rawHooks(p.dir))) (out[ev] ||= []).push(...subst(l, p.dir));
  }
  return out;
}

// Etkin pluginlerin MCP sunucuları: { ad: tanım }
function mcpServers(o = {}) {
  const out = {};
  for (const p of active(o)) {
    for (const [n, def] of Object.entries(rawMcp(p.dir))) if (!(n in out)) out[n] = subst(def, p.dir);
  }
  return out;
}

// Kurulumda kullanıcıya gösterilecek çalıştırılabilir şeyler
function describeExec(dir) {
  const lines = [];
  for (const [ev, l] of Object.entries(rawHooks(dir))) {
    for (const h of l) {
      const cmds = h && h.hooks ? h.hooks : [h];
      for (const c of cmds) if (c && c.command) lines.push(`hook ${ev}: ${String(c.command).slice(0, 200)}`);
    }
  }
  for (const [n, d] of Object.entries(rawMcp(dir))) {
    lines.push(`mcp ${n}: ${[d.command || d.url || '?', ...(Array.isArray(d.args) ? d.args : [])].join(' ').slice(0, 200)}`);
  }
  return lines;
}

// Boyut/dosya sayısı denetimi (.git ve symlink'ler sayılmaz)
function measure(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; try { bytes += fs.statSync(p).size; } catch { /* önemsiz */ } }
      if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error('plugin is too large');
    }
  };
  walk(dir);
  return { files, bytes };
}

const isGitUrl = (s) => /^(https?:\/\/|ssh:\/\/|git:\/\/|git@)/i.test(s);

function gitClone(url, dest) {
  require('child_process').execFileSync('git', ['clone', '--depth', '1', '--quiet', '--', url, dest], {
    stdio: 'pipe', timeout: 120000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* önemsiz */ } }

// install(src, { readKey, out, base, clone }) → { ok, name, version, error }
async function install(src, o = {}) {
  const say = o.out || (() => {});
  const arg = String(src || '').trim();
  if (!arg) return { ok: false, error: 'Usage: /plugin install <path-or-git-url>' };
  if (arg.startsWith('-')) return { ok: false, error: 'Invalid source' };
  const base = baseDir(o);
  fs.mkdirSync(base, { recursive: true });
  const tmp = path.join(base, `.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);
  try {
    const local = path.resolve(arg);
    if (isDir(local)) {
      measure(local);
      fs.cpSync(local, tmp, {
        recursive: true,
        filter: (s) => { if (path.basename(s) === '.git') return false; try { return !fs.lstatSync(s).isSymbolicLink(); } catch { return false; } },
      });
    } else if (isGitUrl(arg) || /\.git$/i.test(arg)) {
      (o.clone || gitClone)(arg, tmp);
      rmrf(path.join(tmp, '.git'));
      measure(tmp);
    } else {
      return { ok: false, error: `Not a directory or git URL: ${arg}` };
    }
    const r = readManifest(tmp);
    if (!r.ok) return { ok: false, error: r.error };
    const { name, version } = r.manifest;
    const dest = path.join(base, name);
    if (path.dirname(path.resolve(dest)) !== path.resolve(base)) return { ok: false, error: 'Invalid plugin name' };
    if (fs.existsSync(dest)) return { ok: false, error: `Plugin "${name}" is already installed (remove it first)` };
    const exec = describeExec(tmp);
    if (exec.length) {
      say(`Plugin "${name}" ${version} runs code on your machine:`);
      for (const l of exec) say(`  ${l}`);
      if (typeof o.readKey !== 'function') return { ok: false, error: 'Plugin has hooks/MCP servers and needs interactive confirmation' };
      const k = String(await o.readKey('  Install and allow these? [y/N] ') || '');
      if (!/^y/i.test(k)) return { ok: false, error: 'Cancelled' };
    }
    fs.renameSync(tmp, dest);
    return { ok: true, name, version, exec };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message).split('\n')[0] : 'install failed' };
  } finally {
    rmrf(tmp);
  }
}

function remove(name, o = {}) {
  if (!validName(name)) return { ok: false, error: 'Invalid plugin name' };
  const base = path.resolve(baseDir(o));
  const dir = path.resolve(base, name);
  if (path.dirname(dir) !== base || !isDir(dir)) return { ok: false, error: `No such plugin: ${name}` };
  rmrf(dir);
  const off = disabledSet(o);
  if (off.delete(name)) writeJsonAtomic(stateFile(o), { disabled: [...off] }, { space: 2 });
  return { ok: true };
}

function setEnabled(name, on, o = {}) {
  if (!validName(name)) return { ok: false, error: 'Invalid plugin name' };
  const base = path.resolve(baseDir(o));
  if (!isDir(path.join(base, name))) return { ok: false, error: `No such plugin: ${name}` };
  const off = disabledSet(o);
  if (on) off.delete(name); else off.add(name);
  writeJsonAtomic(stateFile(o), { disabled: [...off].sort() }, { space: 2 });
  return { ok: true };
}

module.exports = { enabled, validName, readManifest, list, active, roots, hooks, mcpServers, describeExec, install, remove, setEnabled, baseDir };
