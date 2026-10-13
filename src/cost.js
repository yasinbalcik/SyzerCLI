'use strict';

// Oturum kullanım defteri (/cost): model başına token, anahtar sayısı, tur/süre, doğrulama denemeleri,
// alt ajan kullanımı. Yalnızca bellekte tutulur (oturum yeniden başlatılınca sıfırlanır); ağ yok.

const rootOf = (s) => { let r = s; for (let i = 0; r && r.parentSession && i < 8; i++) r = r.parentSession; return r || s; };

function blank(sessionId) {
  return {
    sessionId, t0: Date.now(), calls: 0, turns: 0, ms: 0,
    models: {}, keys: {}, // keys: "anahtarIndeksi" → çağrı sayısı
    verify: { turns: 0, tries: 0, failed: 0 },
    sub: { calls: 0, tokens: 0, byAgent: {} },
  };
}

// Defter oturum kimliğine bağlıdır: /new (resetSession) kimliği değiştirince otomatik sıfırlanır
function ledger(session) {
  const root = rootOf(session);
  if (!root) return null;
  if (!root.costLedger || root.costLedger.sessionId !== root.sessionId) root.costLedger = blank(root.sessionId);
  return root.costLedger;
}

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

// callModel sonucu: { res: { usage }, index, model }
function record(session, call) {
  const L = ledger(session);
  if (!L || !call) return;
  const u = (call.res && call.res.usage) || {};
  const total = num(u.total_tokens) || (num(u.prompt_tokens) + num(u.completion_tokens));
  const model = call.model || session.model || '?';
  const m = (L.models[model] ||= { calls: 0, tokens: 0, in: 0, out: 0, cache: 0 });
  m.calls++; m.tokens += total; m.in += num(u.prompt_tokens); m.out += num(u.completion_tokens);
  m.cache += num(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens);
  L.calls++;
  if (Number.isInteger(call.index) && call.index >= 0) L.keys[call.index + 1] = (L.keys[call.index + 1] || 0) + 1;
  if (session.agentName) {
    L.sub.calls++; L.sub.tokens += total;
    const a = (L.sub.byAgent[session.agentName] ||= { calls: 0, tokens: 0 });
    a.calls++; a.tokens += total;
  }
}

function noteTurn(session, { ms = 0, verifyTries = 0, verifyFailed = false } = {}) {
  const L = ledger(session);
  if (!L) return;
  L.turns++; L.ms += num(ms);
  if (verifyTries > 0 || verifyFailed) L.verify.turns++;
  L.verify.tries += verifyTries;
  if (verifyFailed) L.verify.failed++;
}

const n0 = (n) => Math.round(n || 0).toLocaleString('en-US');
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Salt-okunur özet metni. Veri yoksa "no information" der.
function report(session) {
  const L = session && ledger(session);
  const lines = ['Session cost / usage'];
  if (!L || (!L.calls && !L.turns)) {
    lines.push('  Usage: no information (no model calls recorded in this session yet)');
  } else {
    const main = { calls: 0, tokens: 0 };
    lines.push('  Models (this session):');
    const rows = Object.entries(L.models).sort((a, b) => b[1].tokens - a[1].tokens);
    for (const [model, m] of rows) {
      main.calls += m.calls; main.tokens += m.tokens;
      const detail = m.in || m.out ? ` (in ${n0(m.in)} / out ${n0(m.out)}${m.cache ? ` / cached ${n0(m.cache)}` : ''})` : '';
      lines.push(`    ${model}: ${n0(m.tokens)} tokens, ${m.calls} calls${detail}`);
    }
    lines.push(`  Total: ${n0(main.tokens)} tokens, ${main.calls} model calls`);
    lines.push(`  Turns: ${L.turns}, active time ${fmtDur(L.ms)}, session age ${fmtDur(Date.now() - L.t0)}`);
    const keys = Object.keys(L.keys);
    lines.push(keys.length
      ? `  Keys used: ${keys.length} (${keys.sort((a, b) => a - b).map((k) => `#${k}:${L.keys[k]}`).join(' ')})`
      : '  Keys used: no information');
    if (L.sub.calls) {
      const per = Object.entries(L.sub.byAgent).map(([a, v]) => `${a} ${n0(v.tokens)}`).join(', ');
      lines.push(`  Subagents: ${n0(L.sub.tokens)} tokens in ${L.sub.calls} calls (included above) - ${per}`);
    } else lines.push('  Subagents: none used');
    if (L.verify.tries || L.verify.failed) {
      lines.push(`  Verification: ${L.verify.tries} retry attempt(s) over ${L.verify.turns} turn(s), ${L.verify.failed} gave up`);
    } else lines.push('  Verification: no retries recorded');
  }
  const bud = session && session.budget;
  if (bud && typeof bud.active === 'function' && bud.active()) lines.push(`  Budget (current task): ${bud.summary()}`);
  else lines.push('  Budget: no limits set');
  return lines.join('\n');
}

module.exports = { record, noteTurn, ledger, report };
