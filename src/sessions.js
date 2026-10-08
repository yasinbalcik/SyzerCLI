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
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    for (const old of files.slice(0, -MAX)) fs.unlinkSync(path.join(DIR, old));
  } catch { /* önemsiz */ }
}

function list(cwd) {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; }
    }).filter((x) => x && x.cwd === cwd).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

module.exports = { newId, save, list };
