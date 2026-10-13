'use strict';

// Kalıcı otomatik hafıza: proje başına <config.DIR>/memory/<cwd-hash>/ altında tek-olgu markdown dosyaları + MEMORY.md dizini.
// Talimat dosyalarından (SYZER.md/CLAUDE.md) ayrıdır; model memory_save/memory_forget ile yazar, dizin bağlama eklenir.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const TYPES = ['user', 'feedback', 'project', 'reference'];
const LIMITS = Object.freeze({ name: 60, description: 200, body: 4000, facts: 200, index: 4000 });
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const INDEX_FILE = 'MEMORY.md';
const SECRET_RE = /sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,}/;

class MemoryError extends Error {}
const fail = (m) => { throw new MemoryError(m); };

// Kapatma: SYZER_MEMORY=off|0|false veya cfg.memory === false
function enabled(cfg) {
  const env = String(process.env.SYZER_MEMORY || '').trim().toLowerCase();
  if (env === 'off' || env === '0' || env === 'false') return false;
  return !(cfg && cfg.memory === false);
}

function cwdHash(cwd) {
  let p = path.resolve(cwd || '.');
  if (process.platform === 'win32') p = p.toLowerCase();
  return crypto.createHash('sha1').update(p).digest('hex').slice(0, 16);
}

const dir = (cwd) => path.join(config.DIR, 'memory', cwdHash(cwd));

// Yol gezintisi yok: yalnızca küçük harf/rakam/_/- ; MEMORY ayrılmış
function normName(name) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  if (!n) fail('name is required');
  if (n.length > LIMITS.name) fail(`name is too long (max ${LIMITS.name} chars)`);
  if (!NAME_RE.test(n)) fail('invalid name: use only letters, digits, "-" and "_" (no paths or dots)');
  if (n === 'memory') fail('name "memory" is reserved');
  return n;
}

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* rename sonrası yok */ }
  }
}

function parseFact(src) {
  const m = String(src).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  let body = String(src);
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  return { name: meta.name || '', description: meta.description || '', type: TYPES.includes(meta.type) ? meta.type : 'project', body: body.trim() };
}

function readFact(file) {
  try { return parseFact(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function list(cwd) {
  const d = dir(cwd);
  let files = [];
  try { files = fs.readdirSync(d).filter((f) => f.endsWith('.md') && f !== INDEX_FILE); } catch { return []; }
  const out = [];
  for (const f of files) {
    const name = f.slice(0, -3);
    if (!NAME_RE.test(name)) continue;
    const fact = readFact(path.join(d, f));
    if (!fact) continue;
    let mtime = 0;
    try { mtime = fs.statSync(path.join(d, f)).mtimeMs; } catch { /* yok say */ }
    out.push({ name, description: fact.description, type: fact.type, mtime });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function read(cwd, name) {
  const n = normName(name);
  const fact = readFact(path.join(dir(cwd), `${n}.md`));
  return fact ? { ...fact, name: n } : null;
}

// Dizin: olgu başına tek satır; dosyalardan yeniden üretilir
function index(cwd) {
  const items = list(cwd);
  const file = path.join(dir(cwd), INDEX_FILE);
  if (!items.length) {
    try { fs.unlinkSync(file); } catch { /* zaten yok */ }
    return '';
  }
  const text = items.map((i) => `- [${i.name}](${i.name}.md) (${i.type}) — ${i.description}`).join('\n') + '\n';
  atomicWrite(file, text);
  return text;
}

function save(cwd, { name, description, type = 'project', body } = {}) {
  const n = normName(name);
  const desc = oneLine(description);
  const content = String(body == null ? '' : body).trim();
  if (!desc) fail('description is required (one line)');
  if (desc.length > LIMITS.description) fail(`description is too long (max ${LIMITS.description} chars)`);
  if (!TYPES.includes(type)) fail(`invalid type: use one of ${TYPES.join(', ')}`);
  if (!content) fail('body is required');
  if (content.length > LIMITS.body) fail(`body is too long (max ${LIMITS.body} chars)`);
  if (SECRET_RE.test(`${desc}\n${content}`)) fail('looks like a secret or API key; never store secrets in memory');
  const file = path.join(dir(cwd), `${n}.md`);
  const existed = fs.existsSync(file);
  if (!existed && list(cwd).length >= LIMITS.facts) fail(`memory is full (max ${LIMITS.facts} facts); forget old ones first`);
  atomicWrite(file, `---\nname: ${n}\ndescription: ${desc}\ntype: ${type}\n---\n${content}\n`);
  index(cwd);
  return { name: n, created: !existed };
}

function forget(cwd, name) {
  const n = normName(name);
  const file = path.join(dir(cwd), `${n}.md`);
  let removed = false;
  try { fs.unlinkSync(file); removed = true; } catch { /* yok */ }
  if (removed) index(cwd);
  return removed;
}

// Bağlama eklenecek metin; hafıza yoksa ''
function loadIndex(cwd, { maxChars = LIMITS.index } = {}) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir(cwd), INDEX_FILE), 'utf8').trim(); } catch { return ''; }
  if (!text) return '';
  const head = 'Persistent project memory (facts saved from earlier sessions; verify against the code before relying on them, update with memory_save, remove with memory_forget):\n';
  const budget = Math.max(0, maxChars - head.length);
  if (text.length > budget) {
    const cut = text.slice(0, budget);
    text = cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0)) + '\n…(index truncated)';
  }
  return head + text;
}

module.exports = { enabled, dir, list, read, save, forget, index, loadIndex, TYPES, LIMITS, MemoryError, cwdHash };
