'use strict';

const { chatStream, KeyError } = require('./api');
const { withRotation } = require('./keys');
const { toolDefsFor, execute, describe } = require('./tools');
const { spawn } = require('./subagents');
const { fallbackChain, supportsReasoning } = require('./models');
const stats = require('./stats');
const { t } = require('./i18n');
const hooks = require('./orca-hooks');

const MAX_STEPS = 30;

// Yoğun (5xx/ağ) model kısa süre atlanır; süreçler (alt ajan, Orca işçileri) arasında dosyadan paylaşılır
const BUSY_MS = 5 * 60 * 1000;
const busyFile = () => require('path').join(require('./config').DIR, 'busy-models.json');
function readBusy() {
  try { const j = JSON.parse(require('fs').readFileSync(busyFile(), 'utf8')); const now = Date.now(); return Object.fromEntries(Object.entries(j).filter(([, ts]) => ts > now)); } catch { return {}; }
}
function markBusy(model) {
  try { const b = readBusy(); b[model] = Date.now() + BUSY_MS; require('fs').writeFileSync(busyFile(), JSON.stringify(b)); } catch { /* önemsiz */ }
}

/*
 * session: { cfg, model, effort, messages, cwd, perm, plan, useTools, skills, confirm, out }
 * out:     { waiting(bool, label), thinking(str), text(str), endText(), tool(name, summary), toolResult(ok, text), warn(str) }
 */

// Tek bir model çağrısı: key rotasyonu + yedek model zinciri + araç/effort reddi kurtarma.
async function callModel(session, signal, hooks) {
  const { cfg, out } = session;
  const models = [session.model];
  let chainLoaded = false;
  let i = 0;
  if (readBusy()[session.model]) { // bu model az önce yoğundu: yedek zincirinden sıradaki sağlam modelle başla
    models.push(...(await fallbackChain(cfg, session.model)));
    chainLoaded = true;
    const busy = readBusy();
    const k = models.findIndex((m) => !busy[m]);
    i = k < 0 ? 0 : k;
  }

  while (true) {
    const model = models[i];
    const effort = (await supportsReasoning(model)) === false ? 'auto' : session.effort;
    try {
      const { result, index } = await withRotation(
        cfg,
        (entry) => chatStream({
          key: entry.key,
          model,
          messages: session.messages,
          tools: session.useTools ? toolDefsFor(session) : null,
          effort,
          signal,
          onText: hooks.onText,
          onThinking: hooks.onThinking,
        }),
        {
          signal,
          spread: session.spread,
          onSwitch: hooks.onSwitch,
          onRetry: (status, delay) => out.warn(t('retrying', status, delay)),
        },
      );
      stats.record({ model, keyIndex: index, tokens: result.usage?.total_tokens, usage: result.usage, cwd: session.cwd });
      return { res: result, index, model };
    } catch (err) {
      if (!(err instanceof KeyError)) throw err;
      const msg = err.message || '';

      if (err.status === 400 && /reasoning|effort/i.test(msg) && session.effort !== 'auto') {
        session.effort = 'auto';
        out.warn(t('effort_rejected'));
        continue;
      }
      if ([400, 404].includes(err.status) && /tool/i.test(msg) && session.useTools) {
        session.useTools = false;
        out.warn(t('no_tools'));
        continue;
      }
      // Model tarafı sorunu (5xx / uç nokta yok): yedek modele geç
      if (err.status >= 500 || (err.status === 404 && /endpoint|provider/i.test(msg))) {
        markBusy(model);
        if (!chainLoaded) { models.push(...(await fallbackChain(cfg, session.model))); chainLoaded = true; }
        if (i + 1 < models.length) {
          out.warn(t('fallback_switch', model, models[i + 1]));
          i++;
          continue;
        }
      }
      throw err;
    }
  }
}

async function runTurn(session, userContent, signal) {
  const { out } = session;
  const startLen = session.messages.length;
  if (session.canSpawn !== false || !session.agentName) session.cpDone = false; // her tur için yeni git checkpoint hakkı
  session.messages.push({ role: 'user', content: userContent });
  const top = !session.agentName; // Orca durum olayları yalnızca ana oturum için
  if (top) { hooks.setSession(session.sessionId); try { require('./sessions').save(session); } catch { /* önemsiz */ } } // oturum dosyası ilk olaydan önce diskte olsun
  if (top) hooks.promptSubmitted(typeof userContent === 'string' ? userContent : (userContent.find((p) => p.type === 'text') || {}).text || '');

  const totals = { tokens: 0, ms: 0, keyIndex: -1, model: session.model, toolCalls: 0 };
  const t0 = Date.now();
  let finalText = '';

  try {
    const maxSteps = session.maxSteps || MAX_STEPS;
    for (let step = 0; step < maxSteps; step++) {
      let waiting = true;
      out.waiting(true);
      const stopWaiting = () => { if (waiting) { waiting = false; out.waiting(false); } };

      let call;
      try {
        call = await callModel(session, signal, {
          onText: (txt) => { stopWaiting(); out.text(txt); },
          onThinking: (txt) => out.thinking && out.thinking(txt),
          onSwitch: (key, status, msg) => { stopWaiting(); out.warn(t('switching', key, status, msg)); waiting = true; out.waiting(true); },
        });
      } finally {
        stopWaiting();
        out.endText();
      }
      const { res } = call;
      totals.keyIndex = call.index;
      totals.model = call.model;
      if (res.usage?.total_tokens) totals.tokens += res.usage.total_tokens;
      finalText = res.content;

      const assistant = { role: 'assistant', content: res.content || '' };
      if (res.toolCalls.length) {
        assistant.tool_calls = res.toolCalls.map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' },
        }));
      }
      session.messages.push(assistant);
      if (!res.toolCalls.length) break;

      totals.toolCalls += res.toolCalls.length;
      const label = (tc) => {
        let args = {};
        try { args = JSON.parse(tc.arguments || '{}'); } catch { /* execute raporlar */ }
        return describe(tc.name, args, session.cwd);
      };
      const record = (tc, r) => {
        out.toolResult(r.ok, r.output, r.ui);
        session.messages.push({ role: 'tool', tool_call_id: tc.id, content: r.output });
      };

      const calls = res.toolCalls;
      for (let k = 0; k < calls.length;) {
        const isSpawn = (n) => n === 'spawn_agent' || n === 'spawn_syzer';
        if (isSpawn(calls[k].name) && session.canSpawn) {
          // Ardışık spawn_agent çağrıları paralel çalışır
          let e = k;
          while (e < calls.length && isSpawn(calls[e].name)) e++;
          const batch = calls.slice(k, e);
          batch.forEach((tc) => out.tool(tc.name, label(tc)));
          out.waiting(true, t('agents_running', batch.length));
          let results;
          try { results = await Promise.all(batch.map((tc) => (tc.name === 'spawn_syzer' ? require('./orca-workers').spawnWorker(session, tc, signal) : spawn(session, tc, signal)))); }
          finally { out.waiting(false); }
          batch.forEach((tc, i) => record(tc, results[i]));
          k = e;
        } else {
          const tc = calls[k++];
          out.tool(tc.name, label(tc));
          if (top) hooks.toolStarted(tc.name);
          out.waiting(true, t('running', tc.name));
          let r;
          try { r = await execute(tc, session); } finally { out.waiting(false); }
          record(tc, r);
        }
      }
      if (step === maxSteps - 1) out.warn(t('max_iter'));
    }
  } catch (err) {
    session.messages.length = startLen; // geçersiz yarım geçmiş bırakma
    if (top) hooks.turnDone('');
    throw err;
  }

  totals.ms = Date.now() - t0;
  if (top) hooks.turnDone(finalText);
  return { content: finalText, ...totals };
}

module.exports = { runTurn };
