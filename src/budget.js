'use strict';

// Görev başına bütçe koruması: token / araç turu / dakika. Hepsi isteğe bağlı (null = kapalı).
// Saf modül: saat enjekte edilebilir; ayar/ortam çözümü ve doğrulama burada.

const P = require('./prompts');

const DIMS = ['tokens', 'turns', 'minutes'];
const ENV = { tokens: 'SYZER_BUDGET_TOKENS', turns: 'SYZER_BUDGET_TURNS', minutes: 'SYZER_BUDGET_MINUTES' };
const WARN_AT = 0.8;

// Tek değeri doğrular: null/''/off → null (kapalı); pozitif sayı → sayı; aksi halde undefined (geçersiz)
function parseLimit(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '' || s === 'off' || s === 'none' || s === '0') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Kayıtlı ayardan temiz { tokens, turns, minutes } üretir (geçersiz alanlar kapalı sayılır)
function normalize(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const r = {};
  for (const d of DIMS) { const v = parseLimit(o[d]); r[d] = v === undefined ? null : v; }
  return r;
}

// Etkin sınırlar: ortam değişkeni > CLI bayrağı (overrides) > kayıtlı ayar
function resolve(saved, env = process.env, overrides = {}) {
  const r = normalize(saved);
  for (const d of DIMS) {
    const ov = parseLimit(overrides[d]);
    if (ov !== undefined && overrides[d] !== undefined && overrides[d] !== null) r[d] = ov;
    const ev = parseLimit(env[ENV[d]]);
    if (ev !== undefined && env[ENV[d]] !== undefined && String(env[ENV[d]]).trim() !== '') r[d] = ev;
  }
  return r;
}

const fmt = (d, v) => (d === 'minutes' ? (Math.round(v * 10) / 10) : Math.round(v)).toLocaleString('en-US');
const UNIT = { tokens: 'tokens', turns: 'tool turns', minutes: 'min' };

function createTracker(limits, now = Date.now) {
  const lim = normalize(limits);
  const st = { tokens: 0, turns: 0, t0: now() };
  const warned = new Set();
  let hit = null; // aşılan ilk boyut

  const used = () => ({ tokens: st.tokens, turns: st.turns, minutes: (now() - st.t0) / 60000 });
  const active = () => DIMS.some((d) => lim[d] !== null);

  return {
    limits: lim,
    active,
    used,
    reset() { st.tokens = 0; st.turns = 0; st.t0 = now(); warned.clear(); hit = null; },
    addTokens(n) { if (n > 0 && Number.isFinite(n)) st.tokens += n; },
    addTurn() { st.turns += 1; },
    // → { warn: [{dim, used, limit}], exceeded: {dim, used, limit}|null }; her boyut için uyarı yalnızca bir kez
    check() {
      const u = used();
      const warn = [];
      for (const d of DIMS) {
        if (lim[d] === null) continue;
        if (u[d] >= lim[d]) { if (!hit) hit = { dim: d, used: u[d], limit: lim[d] }; continue; }
        if (u[d] >= lim[d] * WARN_AT && !warned.has(d)) { warned.add(d); warn.push({ dim: d, used: u[d], limit: lim[d] }); }
      }
      return { warn, exceeded: hit };
    },
    exceeded() { return hit || this.check().exceeded; },
    summary() {
      const u = used();
      return DIMS.filter((d) => lim[d] !== null).map((d) => `${fmt(d, u[d])}/${fmt(d, lim[d])} ${UNIT[d]}`).join(' · ');
    },
  };
}

const warnText = (w) => `Budget ${Math.round((w.used / w.limit) * 100)}% of ${UNIT[w.dim]}: ${fmt(w.dim, w.used)}/${fmt(w.dim, w.limit)}`;
const exceededText = (tr) => `${UNIT[tr.exceeded().dim]} limit reached (${tr.summary()})`;

// Girdi karakter sayısından kaba token tahmini
const estimateTokens = (chars) => Math.ceil((chars || 0) / 4);

// Ajan döngüsü kancaları. tr yoksa/kapalıysa hiçbir şey yapmaz.
// Model yanıtından sonra: token (API usage, yoksa chars/4) + araç turu say, %80 uyarısı ver.
function charsOf(messages) {
  let n = 0;
  for (const m of messages || []) n += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
  return n;
}
function onResponse(tr, res, messages, warn) {
  if (!tr || !tr.active()) return;
  const real = res.usage && res.usage.total_tokens;
  tr.addTokens(real || estimateTokens(charsOf(messages) + String(res.content || '').length));
  if (res.toolCalls && res.toolCalls.length) tr.addTurn();
  tr.check().warn.forEach((w) => warn(warnText(w)));
}
// Araç grubundan sonra: aşıldıysa durdurma metni, değilse null
function stopReason(tr, warn) {
  if (!tr || !tr.active()) return null;
  const c = tr.check();
  c.warn.forEach((w) => warn(warnText(w)));
  return c.exceeded ? exceededText(tr) : null;
}
const stopMessage = (reason) => P.budgetNotice({ kind: 'stop', reason });

module.exports = { onResponse, stopReason, stopMessage, DIMS, ENV, WARN_AT, parseLimit, normalize, resolve, createTracker, warnText, exceededText, estimateTokens, fmt };
