'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DIR = path.join(config.DIR, 'sessions');
const MAX = 30;

function newId() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6); }

// Base64 görsel verisini diske yazma
function slim(messages) {
  return messages.map((m) => (Array.isArray(m.content)
    ? { ...m, content: m.content.map((p) => (p.type === 'image_url' ? { type: 'text', text: '[image omitted]' } : p)) }
    : m));
}

function save(s) {
  const user = s.messages.find((m) => m.role === 'user');
  if (!user) return;
  const first = typeof user.content === 'string' ? user.content : (user.content.find((p) => p.type === 'text') || {}).text || '';
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${s.sessionId}.json`), JSON.stringify({
      id: s.sessionId, cwd: s.cwd, model: s.model, ts: Date.now(),
      title: first.replace(/^\[PLAN MODE\][^\n]*\n\n/, '').replace(/\s+/g, ' ').slice(0, 70), messages: slim(s.messages),
    }));
    exportToOrca(s, first);
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    for (const old of files.slice(0, -MAX)) fs.unlinkSync(path.join(DIR, old));
  } catch { /* önemsiz */ }
}

// Orca "Agent Session History" paneli Hermes biçimini okur: ~/.hermes/sessions/session_<id>.json (başlık "[Syzer]" ile ayrışır)
function exportToOrca(s, first) {
  if (!process.env.ORCA_PANE_KEY && !process.env.SYZER_ORCA_EXPORT) return; // yalnızca Orca içinde
  try {
    const dir = path.join(require('os').homedir(), '.hermes', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    const NL = String.fromCharCode(10);
    const text = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join(NL));
    const msgs = s.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && text(m).trim()).map((m) => ({ role: m.role, content: text(m) }));
    const fu = msgs.findIndex((m) => m.role === 'user');
    if (fu >= 0) msgs[fu] = { ...msgs[fu], content: `[Syzer] ${msgs[fu].content}` };
    const id = s.sessionId; // YYYYMMDDHHMMSS-xxxx (UTC)
    const startMs = Date.UTC(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8), +id.slice(8, 10), +id.slice(10, 12), +id.slice(12, 14));
    const body = { session_id: `syzer-${s.sessionId}`, model: s.model, cwd: s.cwd, session_start: new Date(Number.isFinite(startMs) ? startMs : Date.now()).toISOString(), last_updated: new Date().toISOString(), message_count: msgs.length, messages: msgs };
    const file = path.join(dir, `session_syzer-${s.sessionId}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(body));
    fs.renameSync(`${file}.tmp`, file);
  } catch { /* önemsiz */ }
}

function list(cwd) {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; }
    }).filter((x) => x && x.cwd === cwd).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

// Kimliğe göre ara (Orca geçmişinden gelen "syzer-<id>" öneki de kabul edilir); tüm klasörlerde
function find(id) {
  const want = String(id).replace(/^syzer-/, '');
  try {
    const f = path.join(DIR, `${want}.json`);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { return null; }
}

module.exports = { newId, save, list, find };
