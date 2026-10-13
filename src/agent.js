'use strict';

const { chatStream, KeyError } = require('./api');
const { withRotation } = require('./keys');
const { toolDefsFor, execute, describe } = require('./tools');
const { spawn } = require('./subagents');
const { fallbackChain, supportsReasoning } = require('./models');
const stats = require('./stats');
const { t, getLang } = require('./i18n');
const P = require('./prompts');
const hooks = require('./orca-hooks');

const MAX_STEPS = 30;
const MAX_STOP_HOOKS = 3; // Stop kancasının bir turda modeli geri çevirme sınırı

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

// Zayıf/küçük model profili: sistem istemi sonuna [SCAFFOLD] bloğu eklenir/çıkarılır (model değişince yeniden hesaplanır)
function applyScaffold(session, on) {
  const m = session.messages[0];
  if (!m || m.role !== 'system' || typeof m.content !== 'string') return;
  const i = m.content.indexOf('\n\n[SCAFFOLD]');
  const base = i >= 0 ? m.content.slice(0, i) : m.content;
  m.content = on ? `${base}\n\n${P.scaffold({ language: getLang() })}` : base;
}

async function runTurn(session, userContent, signal) {
  const { out } = session;
  const top = !session.agentName; // Orca durum olayları yalnızca ana oturum için
  const B = require('./budget');
  if (top || !session.budget) { // ana tur bütçeyi sıfırlar; süreç içi alt ajanlar aynı sayaca yazar
    session.budget = B.createTracker(B.resolve(session.cfg.budget, process.env, session.budgetFlags));
  }
  const bud = session.budget;
  // Kullanıcı kancaları (yalnızca ana oturum): SessionStart (oturumun ilk turu) + UserPromptSubmit
  const userHooks = require('./hooks');
  const hookCtx = [];
  const rawContent = userContent; // hook bağlamı eklenmemiş özgün istek (görev metni/Orca/checkpoint için)
  if (top && session.settings && !userHooks.disabled()) {
    const promptText = typeof userContent === 'string' ? userContent : ((userContent.find((p) => p.type === 'text') || {}).text || '');
    if (!session.sessionStartFired) {
      session.sessionStartFired = true;
      const r = await userHooks.fire(session.settings, 'SessionStart', { session_id: session.sessionId, source: 'startup' }, session.cwd, 'startup');
      if (r.context) hookCtx.push(r.context);
    }
    const r = await userHooks.fire(session.settings, 'UserPromptSubmit', { session_id: session.sessionId, prompt: promptText }, session.cwd);
    if (r.block) return { content: r.message, blocked: true, tokens: 0, ms: 0, keyIndex: -1, model: session.model, toolCalls: 0 };
    if (r.context) hookCtx.push(r.context);
  }
  if (hookCtx.length) { // hook bağlamı kullanıcı mesajına [system reminder] olarak eklenir
    const extra = `\n\n[system reminder]\n${hookCtx.join('\n')}`;
    if (typeof userContent === 'string') userContent += extra;
    else userContent = [...userContent, { type: 'text', text: extra.trim() }];
  }
  const compactMod = require('./compact');
  const sayCompact = (l) => { try { process.stderr.write(`${l}\n`); } catch { /* önemsiz */ } };
  if (top && !session.noAutoCompact) { // bağlam eşiği aşılmışsa tur başında sıkıştır (geçmiş yedeklenir, hata turu bozmaz)
    try { await compactMod.compactSession(session, { mode: 'auto', say: sayCompact }); } catch { /* önemsiz */ }
  }
  const startLen = session.messages.length;
  if (session.canSpawn !== false || !session.agentName) session.cpDone = false; // her tur için yeni git checkpoint hakkı
  session.messages.push({ role: 'user', content: userContent });
  if (top) require('./rewind').mark(session, startLen, userContent); // /rewind işareti (checkpoint'ten önce: cp numarası)
  if (!session.agentName) require('./checkpoints').store().beginTurn(session.sessionId, typeof userContent === 'string' ? userContent : (userContent.find((p) => p.type === 'text') || {}).text || '');
  if (top) { hooks.setSession(session.sessionId); try { require('./sessions').save(session); } catch { /* önemsiz */ } } // oturum dosyası ilk olaydan önce diskte olsun
  if (top) hooks.promptSubmitted(typeof userContent === 'string' ? userContent : (userContent.find((p) => p.type === 'text') || {}).text || '');
  if (top) hooks.plan(session.todos || []); // bekleyen todo'lar yeni turda Orca listesinde yeniden görünsün

  // doğrulama kapısı + zayıf model iskelesi (yalnızca ana oturum; ayarla kapatılabilir)
  const verifyMod = require('./verify');
  const ver = top ? verifyMod.settings(session) : { enabled: false };
  const taskText = typeof rawContent === 'string' ? rawContent : ((rawContent.find((p) => p.type === 'text') || {}).text || '');
  const scaffolded = top && require('./models').scaffoldFor(session.cfg, session.model);
  if (top) applyScaffold(session, scaffolded);
  if (top) { try { require('./output-styles').apply(session); } catch { /* stil hatası turu bozmasın */ } } // [STYLE] bloğu (iskeleden sonra)
  let dirty = false; // bu turda dosya yazıldı ve testler henüz geçmedi
  let wrote = false;
  let verifyTries = 0;
  let reqChecked = false;
  let verifyFailed = null;
  let stopTries = 0; // Stop kancası geri bildirim sayacı (doğrulama sayacından bağımsız)

  const totals = { tokens: 0, ms: 0, keyIndex: -1, model: session.model, toolCalls: 0 };
  const t0 = Date.now();
  let finalText = '';
  let nagged = false;
  let budgetStop = null;

  try {
    const maxSteps = session.maxSteps || MAX_STEPS;
    for (let step = 0; step < maxSteps; step++) {
      if (step > 0 && top && !session.noAutoCompact && session.compactThreshold && compactMod.estimate(session.messages) > session.compactThreshold) {
        // tur ortasında yalnızca ucuz kısaltma (mesaj sayısı/sırası değişmez → startLen geçerli kalır)
        try { await compactMod.compactSession(session, { mode: 'trim', threshold: session.compactThreshold, say: sayCompact }); } catch { /* önemsiz */ }
      }
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
      try { require('./cost').record(session, call); } catch { /* /cost için kayıt; hata turu bozmasın */ }
      finalText = res.content;
      B.onResponse(bud, res, session.messages, (m) => out.warn(m));

      const assistant = { role: 'assistant', content: res.content || '' };
      if (res.toolCalls.length) {
        assistant.tool_calls = res.toolCalls.map((c) => ({
          id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' },
        }));
      }
      session.messages.push(assistant);
      if (!res.toolCalls.length) {
        // Tamamlanmamış todo maddesiyle tur bitmesin: bir kez hatırlat
        const open = top && !nagged && (session.todos || []).filter((x) => x.status !== 'completed');
        if (open && open.length && step < maxSteps - 1) {
          nagged = true;
          session.messages.push({ role: 'user', content: P.todoReminder(open, { language: getLang() }) });
          continue;
        }
        if (top && ver.enabled && step < maxSteps - 1) {
          // 1) test doğrulama kapısı: komut yoksa sessizce atlanır
          if (dirty) {
            const det = verifyMod.detect(session.cwd, { taskText, command: ver.command });
            if (det) {
              out.tool('verify', det.cmd);
              out.waiting(true, t('running', 'verify'));
              let v;
              try { v = await verifyMod.run(session, det.cmd, ver.timeoutSec); } finally { out.waiting(false); }
              if (v.status === 'pass') {
                dirty = false;
                out.toolResult(true, 'tests passed', { summary: 'tests passed' });
              } else if (v.status === 'fail') {
                out.toolResult(false, v.output, { summary: `tests failed (exit ${v.code})`, body: verifyMod.summarize(v.output, 600) });
                if (verifyTries < ver.retries) {
                  verifyTries++;
                  session.messages.push({ role: 'user', content: P.verifyFailure({ command: det.cmd, code: v.code, output: verifyMod.summarize(v.output), attempt: verifyTries, max: ver.retries, language: getLang() }) });
                  continue;
                }
                verifyFailed = { command: det.cmd, attempts: verifyTries, output: v.output };
              }
            }
          }
          // 2) şartname kontrol listesi: gereksinim başına kanıt iste (tur başına bir kez)
          if (wrote && !reqChecked && !verifyFailed) {
            reqChecked = true;
            const reqs = P.requirementsFrom(verifyMod.taskSource(session.cwd, taskText));
            if (reqs.length >= 3) {
              session.messages.push({ role: 'user', content: P.requirementsCheck(reqs, { language: getLang() }) });
              continue;
            }
          }
        }
        // 3) Stop kancaları (doğrulama kapısından sonra): çıkış 2 → stderr modele döner, tur sürer (turda en çok 3 kez)
        if (top && session.settings && stopTries < MAX_STOP_HOOKS && step < maxSteps - 1) {
          const sr = await userHooks.fire(session.settings, 'Stop', { session_id: session.sessionId, stop_hook_active: stopTries > 0, last_assistant_message: res.content || '' }, session.cwd);
          if (sr.block) {
            stopTries++;
            session.messages.push({ role: 'user', content: `[Stop hook] ${sr.message}` });
            continue;
          }
        }
        break;
      }

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
        } else if (calls[k].name === 'run_plan' && session.canSpawn) {
          const tc = calls[k++];
          out.tool(tc.name, label(tc));
          out.waiting(true, t('agents_running', 1));
          let r;
          try { r = await require('./orchestra').runPlan(session, tc, signal); } finally { out.waiting(false); }
          record(tc, r);
        } else {
          const tc = calls[k++];
          out.tool(tc.name, label(tc));
          if (top) hooks.toolStarted(tc.name);
          out.waiting(true, t('running', tc.name));
          let r;
          try { r = await execute(tc, session); } finally { out.waiting(false); }
          if (r.ok && (tc.name === 'write_file' || tc.name === 'edit_file')) {
            dirty = true; wrote = true;
            if (scaffolded && ver.enabled) { // her dosya yazımından sonra testi koştur, sonucu aracın çıktısına ekle
              const note = await verifyMod.autoTest(session, tc, { taskText, ver });
              if (note) r.output = `${r.output}\n\n${note}`;
            }
          }
          record(tc, r);
        }
      }
      budgetStop = B.stopReason(bud, (m) => out.warn(m));
      if (budgetStop) break; // geçerli araç grubu bitti; bütçe aşıldı
      if (step === maxSteps - 1) out.warn(t('max_iter'));
    }
  } catch (err) {
    session.messages.length = startLen; // geçersiz yarım geçmiş bırakma
    if (top) hooks.turnDone('');
    throw err;
  }

  let budgetExceeded;
  if (budgetStop) {
    budgetExceeded = B.stopMessage(budgetStop);
    if (top) {
      out.warn(`BUDGET EXCEEDED: ${budgetExceeded}`);
      session.messages.push({ role: 'assistant', content: P.budgetNotice({ kind: 'assistant', reason: budgetStop }) });
    } else finalText = `${finalText || ''}\n${P.budgetNotice({ kind: 'subagent', reason: budgetStop })}`.trim();
  }
  if (verifyFailed) { // deneme hakkı bitti ve testler hâlâ geçmiyor: durumu açıkça bildir
    const note = P.verifyGaveUp({ command: verifyFailed.command, attempts: verifyFailed.attempts, output: verifyFailed.output, language: getLang() });
    out.warn(note);
    finalText = `${finalText || ''}\n\n${note}`.trim();
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === 'assistant') last.content = `${last.content || ''}\n\n${note}`.trim();
  }
  totals.ms = Date.now() - t0;
  if (top) { try { require('./cost').noteTurn(session, { ms: totals.ms, verifyTries, verifyFailed: !!verifyFailed }); } catch { /* önemsiz */ } }
  if (top) hooks.turnDone(finalText);
  return { content: finalText, ...totals, ...(budgetExceeded ? { budgetExceeded } : {}), ...(verifyFailed ? { verifyFailed: true } : {}) };
}

module.exports = { runTurn };
