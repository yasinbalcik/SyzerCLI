'use strict';

const { subSystem } = require('./context');
const { t } = require('./i18n');
const { trunc } = require('./ui');

const MAX_REPORT = 8000;
let counter = 0;

// Eşzamanlı alt ajan sayısını sınırlar (free modellerde dakika limiti var)
const gate = { active: 0, waiters: [] };
async function limited(max, fn) {
  while (gate.active >= max) await new Promise((r) => gate.waiters.push(r));
  gate.active++;
  try { return await fn(); }
  finally { gate.active--; const w = gate.waiters.shift(); if (w) w(); }
}

// Alt ajan oturumu: kendi mesaj geçmişi var; izin/plan/geri alma yığını ana oturumla paylaşılır.
function makeSub(parent, agent, label, id, run) {
  const cfg = parent.cfg;
  const po = parent.out;
  return {
    cfg,
    cwd: parent.cwd,
    ctx: parent.ctx,
    skills: parent.skills,
    agentName: agent.name,
    model: agent.model || cfg.subagentModel || parent.model,
    effort: cfg.subagentEffort || parent.effort,
    useTools: parent.useTools,
    canSpawn: false, // alt ajan alt ajan başlatamaz
    maxSteps: 12,
    spread: null,
    allowedTools: new Set(agent.tools),
    messages: [{ role: 'system', content: `${subSystem(parent.ctx, agent)}\n\nWrite your final report in ${require('./i18n').LANGS[cfg.lang] || 'the same language as the task'}.` }],
    todos: [],
    get perm() { return parent.perm; },
    set perm(v) { parent.perm = v; },
    get plan() { return parent.plan; },
    get undo() { return parent.undo; },
    set undo(v) { parent.undo = v; },
    get settings() { return parent.settings; },
    get mcp() { return parent.mcp; },
    get bg() { return parent.bg; },
    get checkpoints() { return parent.checkpoints; },
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
  try { a = JSON.parse(call.arguments || '{}'); } catch { return { ok: false, output: 'Invalid JSON arguments.' }; }
  if (!a.prompt) return { ok: false, output: 'prompt is required.' };

  const agents = parent.ctx.agents;
  const agent = agents.find((x) => x.name === (a.agent || 'general'));
  if (!agent) return { ok: false, output: `Unknown agent "${a.agent}". Available: ${agents.map((x) => x.name).join(', ')}` };

  const id = ++counter;
  const label = `${agent.name}: ${a.description || trunc(a.prompt.replace(/\s+/g, ' '), 40)}`;
  const po = parent.out;
  po.agentStart && po.agentStart(id, label);
  const hooks = require('./orca-hooks');
  const t0 = Date.now();
  const run = { id, label, agent: agent.name, prompt: a.prompt, steps: [], report: '', live: '', chars: 0, ok: false };
  parent.runs = parent.runs || [];
  parent.runs.push(run);
  try {
    hooks.subagentStart({ id: `syz-${process.pid}-${id}`, kind: agent.name });
    const sub = makeSub(parent, agent, label, id, run);
    po.agentModel && po.agentModel(id, sub.model);
    const r = await limited(parent.cfg.subagentConcurrency || 3, () => {
      po.agentRun && po.agentRun(id);
      sub.spread = gate.active > 1 ? id : null; // birden fazla ajan aynı anda çalışıyorsa key'lere dağıt
      return runTurn(sub, a.prompt, signal);
    });
    const report = (r.content || '').trim() || '(no output)';
    Object.assign(run, { report, ok: true, tokens: r.tokens, calls: r.toolCalls, model: sub.model });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const model = sub.model.split('/').pop().replace(':free', '');
    const lines = report.split('\n').filter((l) => l.trim());
    const body = lines.slice(0, 5).map((l) => '    ' + trunc(l, 110)).join('\n') + (lines.length > 5 ? `\n    ${t('sum_lines', lines.length - 5)}` : '');
    return {
      ok: true,
      output: report.length > MAX_REPORT ? report.slice(0, MAX_REPORT) + '\n…(truncated)' : report,
      ui: { summary: `${t('sub_summary', agent.name, r.toolCalls, r.tokens.toLocaleString(), secs)} · ${model}`, body },
    };
  } catch (err) {
    if (err.name === 'AbortError') { run.aborted = true; throw err; }
    run.report = `failed: ${err.message}`;
    return { ok: false, output: `Subagent failed: ${err.message}`, ui: { summary: `${agent.name}: ${err.message}` } };
  } finally {
    run.secs = ((Date.now() - t0) / 1000).toFixed(1);
    hooks.subagentStop({ id: `syz-${process.pid}-${id}` });
    po.agentDone && po.agentDone(id, run);
  }
}

module.exports = { spawn, makeSub };
