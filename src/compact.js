'use strict';

// Bağlam sıkıştırma. İki aşama:
//   1) trimToolResults  — modelsiz, deterministik: eski büyük araç çıktılarını baş+son bırakıp kısaltır
//   2) summarizePass    — tek model çağrısı: en eski yarıyı (kullanıcı mesajı sınırında) tek özet mesajına çevirir
// Saf fonksiyonlar enjekte edilebilir (estimate/summarize/persist) → test/compact.test.js

const fs = require('fs');
const path = require('path');
const { allModels } = require('./models');
const P = require('./prompts');
const { LIMITS } = require('./limits');

const textOf = (m) => {
  let s = typeof m.content === 'string' ? m.content : (m.content || []).map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ');
  if (m.tool_calls) s += m.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`).join(' ');
  return s || '';
};

// Kabaca token tahmini (≈ 3.5 karakter / token)
function estimate(messages) {
  return Math.round(messages.reduce((n, m) => n + textOf(m).length, 0) / 3.5);
}

// Bilinen bağlam penceresi (yoksa null)
async function windowKnown(modelId) {
  try {
    const m = (await allModels()).find((x) => x.id === modelId);
    return (m && m.context_length) || null;
  } catch { return null; }
}
async function windowOf(modelId) { return (await windowKnown(modelId)) || 128000; }

// ---------- eşik ----------
const DEFAULT_FRACTION = 0.7;
const DEFAULT_TOKENS = 60000;

// "50k" | "70%" | 0.7 | 80000 | "off" → token sayısı | Infinity (kapalı) | undefined (geçersiz/boş)
function parseThreshold(v, win) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  if (['off', 'none', 'false', '0'].includes(s)) return Infinity;
  let m = /^(\d+(?:\.\d+)?)%$/.exec(s);
  if (m) return win ? Math.floor((win * Number(m[1])) / 100) : undefined;
  m = /^(\d+(?:\.\d+)?)k$/.exec(s);
  if (m) return Math.floor(Number(m[1]) * 1000);
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  if (n > 0 && n <= 1) return win ? Math.floor(win * n) : undefined;
  return n > 1 ? Math.floor(n) : undefined;
}

// Öncelik: SYZER_COMPACT_TOKENS > config compact.threshold > %70 pencere (biliniyorsa) > 60k
function resolveThreshold({ cfg = {}, env = process.env, win = null } = {}) {
  const e = parseThreshold(env.SYZER_COMPACT_TOKENS, win);
  if (e !== undefined) return e;
  const c = parseThreshold(cfg.compact && cfg.compact.threshold, win);
  if (c !== undefined) return c;
  return win ? Math.floor(win * DEFAULT_FRACTION) : DEFAULT_TOKENS;
}

// ---------- aşama 1: araç çıktılarını kısalt ----------
const OPTS = { keep: 6, minChars: 2000, head: 600, tail: 300 };
const MARK = (n) => `…[trimmed ${n} chars]…`;
const TRIM_RE = /…\[trimmed \d+ chars\]…/;

// Son `keep` araç sonucu ve sistem/kullanıcı/asistan mesajları dokunulmaz; eşleşme (tool_call_id) korunur.
// Saf: yeni dizi + { trimmed, saved } döner (mesaj sayısı ve sırası aynı).
function trimToolResults(messages, opts = {}) {
  const o = { ...OPTS, ...opts };
  const toolIdx = [];
  messages.forEach((m, i) => { if (m.role === 'tool') toolIdx.push(i); });
  const protectedSet = new Set(o.keep > 0 ? toolIdx.slice(-o.keep) : []);
  let trimmed = 0;
  let saved = 0;
  const out = messages.map((m, i) => {
    if (m.role !== 'tool' || protectedSet.has(i) || typeof m.content !== 'string' || m.content.length <= o.minChars) return m;
    const cut = m.content.length - o.head - o.tail;
    const content = `${m.content.slice(0, o.head)}\n${MARK(cut)}\n${m.content.slice(-o.tail)}`;
    if (content.length >= m.content.length) return m;
    trimmed++;
    saved += m.content.length - content.length;
    return { ...m, content };
  });
  return { messages: out, trimmed, saved };
}

// ---------- aşama 2: özet ----------
const SUMMARY_TAG = P.SUMMARY_TAG;
const SUMMARY_MAX_CHARS = 3200; // ≈ 800 token

// Kesim noktası: kullanıcı mesajı indeksi; en eski ~yarıyı (token olarak) özetler.
// En son kullanıcı mesajı ve sonrası korunur. Uygun nokta yoksa null.
function pickCut(messages, est = estimate) {
  const start = messages[0] && messages[0].role === 'system' ? 1 : 0;
  let lastUser = -1;
  messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  const cands = [];
  for (let i = start + 1; i <= lastUser; i++) if (messages[i].role === 'user') cands.push(i);
  if (!cands.length) return null;
  const sizes = messages.map((m) => est([m]));
  const total = sizes.slice(start).reduce((a, b) => a + b, 0);
  let acc = 0;
  let best = null;
  let bestD = Infinity;
  let ci = 0;
  for (let i = start; i < messages.length && ci < cands.length; i++) {
    if (i === cands[ci]) { const d = Math.abs(acc - total / 2); if (d < bestD) { bestD = d; best = i; } ci++; }
    acc += sizes[i];
  }
  return best;
}

const roleLabel = { user: 'USER', assistant: 'ASSISTANT', tool: 'TOOL', system: 'SYSTEM' };
function transcriptOf(msgs) {
  const t = msgs.map((m) => `${roleLabel[m.role] || String(m.role).toUpperCase()}: ${textOf(m).slice(0, 2500)}`).join('\n\n');
  return t.length > LIMITS.transcript ? `…\n${t.slice(-LIMITS.transcript)}` : t;
}

const SUMMARY_SYSTEM = P.summarySystem();
const summaryPrompt = (transcript, hint) => P.summaryPrompt({ transcript, hint });

// summarize(transcript, hint) → string (başarısızlıkta throw ya da boş). Başarısızsa null (geçmiş değişmez).
async function summarizePass(messages, { summarize, est = estimate, hint = '', persist = null } = {}) {
  const cut = pickCut(messages, est);
  if (cut === null) return null;
  const start = messages[0] && messages[0].role === 'system' ? 1 : 0;
  if (cut - start < 1) return null;
  let summary;
  try { summary = String(await summarize(transcriptOf(messages.slice(start, cut)), hint) || '').trim(); } catch { return null; }
  if (!summary) return null;
  if (summary.length > SUMMARY_MAX_CHARS) summary = `${summary.slice(0, SUMMARY_MAX_CHARS)}…`;
  if (persist) persist(); // atmadan önce tam kayıt diske (throw → özet uygulanmaz)
  return {
    messages: [
      ...messages.slice(0, start),
      { role: 'user', content: `${SUMMARY_TAG}\n${summary}` },
      { role: 'assistant', content: P.summaryAck() },
      ...messages.slice(cut),
    ],
    summarized: cut - start,
  };
}

// ---------- kalıcı yedek ----------
// <oturum>/precompact-<ts>.json — oturum klasörüyle birlikte silinir (sessions.save budaması), /resume listesine girmez
function precompactDir(sessionId) {
  return path.join(require('./config').DIR, 'sessions', String(sessionId || 'unsaved'));
}
function persistPrecompact(dir, messages, now = Date.now) {
  const { slim } = require('./sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `precompact-${now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ ts: Date.now(), messages: slim(messages) }, null, 2)}\n`);
  return file;
}
function precompactCount(sessionId) {
  try { return fs.readdirSync(precompactDir(sessionId)).filter((f) => /^precompact-\d+\.json$/.test(f)).length; } catch { return 0; }
}

// ---------- orkestrasyon ----------
const line = (r) => `compacted: ~${r.before.toLocaleString('en-US')} → ~${r.after.toLocaleString('en-US')} tokens (trimmed ${r.trimmed} tool outputs${r.summarized ? `, summarized ${r.summarized} messages` : ''})`;

// mode: 'auto' (yalnızca eşik aşılırsa; önce kısalt, yetmezse özetle) | 'trim' | 'force' (her ikisi)
// deps: { summarize, persist(messages), est, threshold }. Hiçbir koşulda geçmişi kaybetmez.
async function compactMessages(messages, { mode = 'auto', threshold = Infinity, hint = '', deps = {} } = {}) {
  const est = deps.est || estimate;
  const before = est(messages);
  const res = { messages, before, after: before, trimmed: 0, summarized: 0, file: null, summaryFailed: false };
  if (mode === 'auto' && before <= threshold) return res;

  const orig = messages;
  let cur = messages;
  let persisted = false;
  const persistOnce = () => {
    if (persisted || !deps.persist) return;
    res.file = deps.persist(orig); // throw → çağıran tarafı iptal eder
    persisted = true;
  };

  const tr = trimToolResults(cur);
  if (tr.trimmed) {
    persistOnce();
    cur = tr.messages;
    res.trimmed = tr.trimmed;
  }
  const need = mode === 'force' || (mode === 'auto' && est(cur) > threshold);
  if (need && mode !== 'trim' && deps.summarize && (mode === 'force' ? before >= 1500 : true)) {
    const sp = await summarizePass(cur, { summarize: deps.summarize, est, hint, persist: persistOnce });
    if (sp) { cur = sp.messages; res.summarized = sp.summarized; } else res.summaryFailed = true;
  }
  res.messages = cur;
  res.after = est(cur);
  return res;
}

const quiet = { waiting() {}, thinking() {}, text() {}, endText() {}, tool() {}, toolResult() {}, warn() {} };

// Araçsuz, geçmişsiz tek seferlik model sorusu (özet / commit mesajı vb. için).
// agentName → alt ajan gibi davranır (yerel hook/checkpoint/oturum kaydı yok); budget paylaşılır:
// token sayacına eklenir ama araç çağrısı olmadığı için bütçe durdurması bu çağrıdan tetiklenmez.
async function quickAsk(session, prompt, system = 'You are a concise assistant.', { model } = {}) {
  const { runTurn } = require('./agent');
  const temp = {
    cfg: session.cfg, model: model || session.model, effort: session.effort === 'auto' ? 'auto' : 'low', useTools: false, canSpawn: false,
    agentName: 'quick', budget: session.budget,
    perm: 'readonly', plan: false, maxSteps: 1, cwd: session.cwd, out: session.out && session.out.warn ? { ...quiet, warn: session.out.warn } : quiet,
    messages: [{ role: 'system', content: system }],
  };
  return (await runTurn(temp, prompt)).content.trim();
}

// Oturumu yerinde sıkıştırır. → { before, after, trimmed, summarized, file } | null (değişiklik yok)
// opts: { mode, hint, win, say(line) }
async function compactSession(session, { mode = 'auto', hint = '', win, say, threshold: thr } = {}) {
  let threshold = thr;
  if (threshold === undefined) {
    const w = win !== undefined ? win : await windowKnown(session.model);
    threshold = resolveThreshold({ cfg: session.cfg || {}, win: w });
    session.compactThreshold = threshold;
  }
  if (session.settings && !session.agentName) { // PreCompact kancası (engellemez; hata sıkıştırmayı bozmaz)
    try {
      const trig = mode === 'auto' || mode === 'trim' ? 'auto' : 'manual';
      await require('./hooks').fire(session.settings, 'PreCompact', { session_id: session.sessionId, trigger: trig, custom_instructions: hint }, session.cwd, trig);
    } catch { /* önemsiz */ }
  }
  const rt = require('./routing');
  const cheap = session.cfg && ((rt.explicit('summarize', session.cfg) || {}).model || session.cfg.subagentModel); // routing.summarize > subagentModel > oturum modeli
  const deps = {
    persist: (msgs) => persistPrecompact(precompactDir(session.sessionId), msgs),
    summarize: async (transcript, h) => {
      session.out && session.out.waiting && session.out.waiting(true, 'compacting…');
      try { return await quickAsk(session, summaryPrompt(transcript, h), SUMMARY_SYSTEM, { model: cheap || undefined }); }
      finally { session.out && session.out.waiting && session.out.waiting(false); }
    },
  };
  let r;
  try { r = await compactMessages(session.messages, { mode, threshold, hint, deps }); } catch (e) {
    if (say) say(`compact skipped: ${e.message}`);
    return null; // persist başarısız → hiçbir şey değiştirilmedi
  }
  if (!r.trimmed && !r.summarized) return null;
  session.messages.splice(0, session.messages.length, ...r.messages);
  if (say) say(line(r));
  return r;
}

// Geriye dönük: /compact [odak] → tam sıkıştırma
async function compact(session, hint = '') {
  const r = await compactSession(session, { mode: 'force', hint });
  return r ? { before: r.before, after: r.after } : null;
}

// /context için durum özeti
async function status(session) {
  const win = await windowKnown(session.model);
  const threshold = resolveThreshold({ cfg: session.cfg || {}, win });
  const msgs = session.messages;
  return {
    tokens: estimate(msgs), threshold, win, messages: msgs.length,
    toolResults: msgs.filter((m) => m.role === 'tool').length,
    trimmedResults: msgs.filter((m) => m.role === 'tool' && typeof m.content === 'string' && TRIM_RE.test(m.content)).length,
    hasSummary: msgs.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SUMMARY_TAG)),
    snapshots: precompactCount(session.sessionId),
  };
}

module.exports = {
  estimate, windowOf, windowKnown, compact, quickAsk, parseThreshold, resolveThreshold, trimToolResults, pickCut, summarizePass,
  compactMessages, compactSession, persistPrecompact, precompactDir, status, line, SUMMARY_TAG, OPTS,
};
