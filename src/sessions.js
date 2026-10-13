'use strict';

// Oturum kayıtları (kendi biçimimiz): ~/.syzercli/sessions/<id>.json
//   parent:    { id, cwd, model, ts, title, messages: [...] }
//   alt ajanlar: ~/.syzercli/sessions/<id>/subagents/agent-<n>.json = { id, agentType, description, status, messages: [{role, content}] }
// Orca entegrasyonu (yamalı tarayıcı) bu dosyaları doğrudan okur; başka bir ajanın biçimine bağlı değil.
// Dosyalar girintili ve sonda yeni satırla yazılır (Orca "View Log" son \n'e kadar olan kısmı gösterir).
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

const NL = String.fromCharCode(10);
const json = (o) => JSON.stringify(o, null, 2) + NL;
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

// Bir alt ajan / işçi çalışmasını okunabilir bir transkripte çevirir
function subagentFile(run, n) {
  const messages = [{ role: 'user', content: String(run.prompt || '') }];
  for (const st of run.steps || []) {
    messages.push({ role: 'assistant', content: `${st.tool}(${st.summary || ''})` });
    if (st.result) messages.push({ role: 'user', content: `${st.ok === false ? '✖' : '⎿'} ${st.result}` });
  }
  messages.push({ role: 'assistant', content: String(run.report || '') });
  const failed = !run.ok && /^(failed|ERROR)/.test(String(run.report || ''));
  return { id: `agent-${n}`, agentType: run.agent || 'general', description: String(run.label || `agent ${n}`).slice(0, 120), status: failed ? 'failed' : 'completed', secs: run.secs || null, model: run.model || null, messages };
}

function save(s) {
  const user = s.messages.find((m) => m.role === 'user');
  if (!user) return;
  const first = typeof user.content === 'string' ? user.content : (user.content.find((p) => p.type === 'text') || {}).text || '';
  try {
    writeAtomic(path.join(DIR, `${s.sessionId}.json`), json({
      id: s.sessionId, cwd: s.cwd, model: s.model, ts: Date.now(),
      title: first.replace(/^\[PLAN MODE\][^\n]*\n\n/, '').replace(/\s+/g, ' ').slice(0, 70), messages: slim(s.messages),
    }));
    (s.runs || []).forEach((run, i) => writeAtomic(path.join(DIR, s.sessionId, 'subagents', `agent-${i + 1}.json`), json(subagentFile(run, i + 1))));
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    for (const old of files.slice(0, -MAX)) {
      fs.unlinkSync(path.join(DIR, old));
      fs.rmSync(path.join(DIR, old.slice(0, -5)), { recursive: true, force: true });
      fs.rmSync(path.join(config.DIR, 'checkpoints', old.slice(0, -5)), { recursive: true, force: true });
    }
  } catch { /* önemsiz */ }
}

function list(cwd) {
  try {
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; }
    }).filter((x) => x && x.cwd === cwd).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

// Kimliğe göre ara (Orca geçmişinden gelen "syzer-<id>" öneki de kabul edilir)
function find(id) {
  const want = String(id).replace(/^syzer-/, '');
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${want}.json`), 'utf8')); } catch { return null; }
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  if (value && typeof value === 'object') return typeof value.text === 'string' ? value.text : '';
  return '';
}

function dayStart(time) {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dateQuery(query, now) {
  const q = query.toLowerCase();
  const base = dayStart(now);
  if (base === null) return null;
  if (q === 'today') return base;
  if (q === 'yesterday') return base - 86400000;
  const ago = /^(\d+)\s+d$/.exec(q);
  if (ago) return base - Number(ago[1]) * 86400000;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  if (!iso) return null;
  const target = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return target.getFullYear() === Number(iso[1]) && target.getMonth() === Number(iso[2]) - 1 && target.getDate() === Number(iso[3]) ? target.getTime() : null;
}

// Oturum seçicisi için saf filtre: sıralamayı ve girdiyi korur.
function filterSessions(items, query = '', now = Date.now()) {
  if (!Array.isArray(items)) return [];
  const q = String(query || '').trim();
  if (!q) return items.slice();
  const date = dateQuery(q, now);
  if (date !== null) return items.filter((session) => dayStart(session && session.ts) === date);
  const needle = q.toLowerCase();
  return items.filter((session) => {
    if (!session || typeof session !== 'object') return false;
    const messageText = Array.isArray(session.messages) ? session.messages.map((message) => textOf(message && message.content)).join(' ') : '';
    return [session.id, session.title, messageText].some((value) => String(value || '').toLowerCase().includes(needle));
  });
}

module.exports = { newId, save, list, find, slim, filterSessions };
