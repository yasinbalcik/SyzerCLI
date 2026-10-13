'use strict';

const P = require('./prompts');
const { LIMITS } = require('./limits');
const { t } = require('./i18n');
const { trunc, head } = require('./ui');

const MAX_REPORT = LIMITS.subagentReport;
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'find_files', 'search_files', 'use_skill', 'web_fetch', 'web_search']);
let counter = 0;

// Eşzamanlı alt ajan sayısını sınırlar (free modellerde dakika limiti var)
function abortError() { const err = new Error('The operation was aborted'); err.name = 'AbortError'; return err; }
function createLimiter() {
  const gate = { active: 0, waiters: [] };
  async function limited(max, fn, signal) {
    if (signal && signal.aborted) throw abortError();
    while (gate.active >= max) {
      await new Promise((resolve, reject) => {
        const waiter = () => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); };
        const onAbort = () => {
          const i = gate.waiters.indexOf(waiter);
          if (i >= 0) gate.waiters.splice(i, 1);
          signal.removeEventListener('abort', onAbort);
          reject(abortError());
        };
        gate.waiters.push(waiter);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
      if (signal && signal.aborted) throw abortError();
    }
    gate.active++;
    try { return await fn(); }
    finally { gate.active--; const w = gate.waiters.shift(); if (w) w(); }
  }
  return { gate, limited };
}
const limiter = createLimiter();
const { gate, limited } = limiter;

// Alt ajan oturumu: kendi mesaj geçmişi var; izin/plan/geri alma yığını ana oturumla paylaşılır.
function makeSub(parent, agent, label, id, run, modelOverride, routedModel) {
  const cfg = parent.cfg;
  const po = parent.out;
  return {
    cfg,
    cwd: parent.cwd,
    ctx: parent.ctx,
    skills: parent.skills,
    agentName: agent.name,
    parentSession: parent, // /cost: alt ajan kullanımı ana oturumun defterine yazılır
    model: modelOverride || agent.model || routedModel || cfg.subagentModel || parent.model, // routedModel: routing.<rol> (açıkça ayarlıysa)
    effort: cfg.subagentEffort || parent.effort,
    useTools: parent.useTools,
    canSpawn: false, // alt ajan alt ajan başlatamaz
    maxSteps: 12,
    spread: null,
    allowedTools: new Set(agent.tools),
    messages: [{ role: 'system', content: P.subagentSystem({ ctx: parent.ctx, agent, language: cfg.lang }) }],
    todos: [],
    get perm() { return parent.perm; },
    set perm(v) { parent.perm = v; },
    get plan() { return parent.plan; },
    get sessionId() { return parent.sessionId; }, // süreç içi alt ajan düzenlemeleri ana turun checkpoint'ine yazılır
    get undo() { return parent.undo; },
    set undo(v) { parent.undo = v; },
    get settings() { return parent.settings; },
    get mcp() { return parent.mcp; },
    get bg() { return parent.bg; },
    get checkpoints() { return parent.checkpoints; },
    get budget() { return parent.budget; }, // görev bütçesi ana turla paylaşılır
    set budget(v) { parent.budget = v; },
    get cpDone() { return parent.cpDone; },
    set cpDone(v) { parent.cpDone = v; },
    get canAsk() { return parent.canAsk; },
    confirm: (kind, summary, preview) => parent.confirm(`${agent.name}:${kind}`, summary, preview),
    out: {
      waiting() {},
      thinking(chunk) { if (run) run.chars += String(chunk || '').length; po.agentUpdate && po.agentUpdate(id, '…'); },
      text(chunk) { if (run) { const c = String(chunk || ''); run.chars += c.length; run.live = (run.live + c).slice(-6000); } },
      endText() {},
      tool(name, summary) { if (run) run.steps.push({ tool: name, summary: String(summary).slice(0, 300) }); po.agentUpdate && po.agentUpdate(id, `${name}(${trunc(String(summary).replace(/\s+/g, ' '), 48)})`, run ? run.steps.length : undefined, run ? Math.round(run.chars / 4) : undefined); },
      toolResult(ok, text, ui) { if (run && run.steps.length) { const st = run.steps[run.steps.length - 1]; st.ok = ok; st.result = (ui && ui.summary ? ui.summary : String(text)).slice(0, 600); run.chars += String(text || '').length; } },
      warn(msg) { if (run && msg === t('max_iter')) run.stopped = true; po.warn(`[${label}] ${msg}`); },
    },
  };
}

// spawn_agent çağrısını çalıştırır → { ok, output, ui }
async function spawn(parent, call, signal) {
  const { runTurn } = require('./agent'); // döngüsel bağımlılığı önlemek için geç yükleme
  let a;
  try { a = JSON.parse(call.arguments || '{}'); } catch { return P.failure('INVALID_JSON', 'tool arguments are not valid JSON', 'Retry with an object.'); }
  if (!a.prompt) return P.failure('MISSING_PROMPT', 'prompt is required', 'Provide a complete task.');

  const agents = parent.ctx.agents;
  const agent = agents.find((x) => x.name === (a.agent || 'general'));
  if (!agent) return P.failure('UNKNOWN_AGENT', `agent "${a.agent}" is not available`, `Choose one of: ${agents.map((x) => x.name).join(', ')}.`);

  const id = ++counter;
  const label = `${agent.name}: ${a.description || head(a.prompt, 70)}`;
  const po = parent.out;
  po.agentStart && po.agentStart(id, label);
  const hooks = require('./orca-hooks');
  const t0 = Date.now();
  let routedRole = null; // modeli routing verdiyse rolü (orkestra yükseltmesi için)
  const run = { id, label, agent: agent.name, prompt: a.prompt, steps: [], report: '', live: '', chars: 0, ok: false };
  parent.runs = parent.runs || [];
  parent.runs.push(run);
  let wt = null; // isolation: "worktree" ise açılan worktree
  let wtInfo = null; // bitişte korunan worktree bilgisi
  try {
    hooks.subagentStart({ id: `syz-${process.pid}-${id}`, kind: agent.name, description: a.description || head(a.prompt, 120) });
    const route = require('./routing').subagentRoute(agent, a.read_only === true, parent.cfg);
    const sub = makeSub(parent, agent, label, id, run, a.model || null, route && route.model);
    routedRole = route && !a.model && !agent.model ? route.role : null;
    if (a.read_only) sub.allowedTools = new Set([...sub.allowedTools].filter((n) => READ_ONLY_TOOLS.has(n))); // yazma/komut araçları kaldırılır
    if (a.max_steps) sub.maxSteps = Math.max(1, Math.min(40, a.max_steps | 0)); // orkestra yeniden denemesi daha geniş bütçe verir
    run.model = sub.model;
    po.agentModel && po.agentModel(id, sub.model);
    const r = await limited(parent.cfg.subagentConcurrency || 3, async () => {
      po.agentRun && po.agentRun(id);
      sub.spread = gate.active > 1 ? id : null; // birden fazla ajan aynı anda çalışıyorsa key'lere dağıt
      let prompt = a.prompt;
      if (a.isolation === 'worktree' && !a.read_only) {
        const w = require('./worktree').create(parent.cwd);
        if (w.ok) {
          wt = w; sub.cwd = w.cwd;
          prompt = `[Isolated git worktree] Your working directory is ${w.cwd} (branch ${w.branch}, started from HEAD). Work only inside it; use relative paths. Your changes are not merged automatically.

${a.prompt}`;
        } else po.warn(`[${label}] worktree isolation unavailable (${w.reason}); running in the normal working tree`);
      }
      try { return await runTurn(sub, prompt, signal); } finally { if (wt) wtInfo = require('./worktree').finish(wt); }
    }, signal);
    let report = (r.content || '').trim() || '(no output)';
    if (parent.settings) { // SubagentStop kancası (engellemez; stdout/stderr rapora not olarak eklenir)
      try {
        const h = await require('./hooks').fire(parent.settings, 'SubagentStop', { session_id: parent.sessionId, agent_type: agent.name, agent_description: a.description || '' }, parent.cwd, agent.name);
        const note = h.context || h.message;
        if (note) report = `${report}\n\n[SubagentStop hook] ${note}`;
      } catch { /* önemsiz */ }
    }
    if (wtInfo && wtInfo.kept) report = `${report}

${require('./worktree').note(wtInfo)}`;
    Object.assign(run, { report, ok: true, tokens: r.tokens, calls: r.toolCalls, model: sub.model });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const model = sub.model.split('/').pop().replace(':free', '');
    const lines = report.split('\n').filter((l) => l.trim());
    const body = lines.slice(0, 5).map((l) => '    ' + trunc(l, 110)).join('\n') + (lines.length > 5 ? `\n    ${t('sum_lines', lines.length - 5)}` : '');
    return {
      ok: true,
      stopped: !!run.stopped, // adım sınırına çarpıp yarıda kesildi: rapor eksik olabilir
      model: sub.model, routedRole,
      output: report.length > MAX_REPORT ? report.slice(0, MAX_REPORT) + '\n…(truncated)' : report,
      ui: { summary: `${t('sub_summary', agent.name, r.toolCalls, r.tokens.toLocaleString(), secs)} · ${model}`, body },
    };
  } catch (err) {
    if (err.name === 'AbortError') { run.aborted = true; if (wtInfo && wtInfo.kept) run.report = require('./worktree').note(wtInfo); throw err; }
    const wtNote = wtInfo && wtInfo.kept ? '\n' + require('./worktree').note(wtInfo) : '';
    run.report = `failed: ${err.message}${wtNote}`;
    return { ...P.failure('TOOL_FAILED', `subagent failed: ${err.message}${wtNote}`, undefined, { model: run.model || null, routedRole }), ui: { summary: `${agent.name}: ${err.message}` } };
  } finally {
    run.secs = ((Date.now() - t0) / 1000).toFixed(1);
    hooks.subagentStop({ id: `syz-${process.pid}-${id}` });
    po.agentDone && po.agentDone(id, run);
  }
}

module.exports = { spawn, makeSub, READ_ONLY_TOOLS, createLimiter, limited };
