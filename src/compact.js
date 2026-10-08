'use strict';

const { allModels } = require('./models');

const textOf = (m) => {
  let s = typeof m.content === 'string' ? m.content : (m.content || []).map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ');
  if (m.tool_calls) s += m.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`).join(' ');
  return s || '';
};

// Kabaca token tahmini (≈ 3.5 karakter / token)
function estimate(messages) {
  return Math.round(messages.reduce((n, m) => n + textOf(m).length, 0) / 3.5);
}

async function windowOf(modelId) {
  try {
    const m = (await allModels()).find((x) => x.id === modelId);
    return (m && m.context_length) || 128000;
  } catch { return 128000; }
}

const quiet = { waiting() {}, thinking() {}, text() {}, endText() {}, tool() {}, toolResult() {}, warn() {} };

// Araçsuz, geçmişsiz tek seferlik model sorusu (özet / commit mesajı vb. için)
async function quickAsk(session, prompt, system = 'You are a concise assistant.') {
  const { runTurn } = require('./agent');
  const temp = {
    cfg: session.cfg, model: session.model, effort: session.effort === 'auto' ? 'auto' : 'low', useTools: false, canSpawn: false,
    perm: 'readonly', plan: false, maxSteps: 1, cwd: session.cwd, out: session.out && session.out.warn ? { ...quiet, warn: session.out.warn } : quiet,
    messages: [{ role: 'system', content: system }],
  };
  return (await runTurn(temp, prompt)).content.trim();
}

// Eski mesajları özetleyip geçmişi kısaltır. Son kullanıcı mesajından itibarengeri kalan korunur.
async function compact(session, hint = '') {
  const msgs = session.messages;
  const keepFrom = msgs.map((m) => m.role).lastIndexOf('user');
  if (keepFrom <= 1) return null; // özetlenecek eski içerik yok
  const old = msgs.slice(1, keepFrom);
  let transcript = old.map((m) => `${m.role.toUpperCase()}: ${textOf(m).slice(0, 2500)}`).join('\n\n');
  if (transcript.length > 60000) transcript = '…\n' + transcript.slice(-60000);

  const before = estimate(msgs);
  if (before < 1500) return null; // kısa sohbetleri özetlemek yarar sağlamaz
  const summary = await quickAsk(
    session,
    `Summarize this conversation so work can continue without it. Keep: the user's goals, decisions made, files created/changed ` +
      `(with paths), commands run and their outcomes, open problems and next steps. Be dense and factual.${hint ? `\nExtra focus: ${hint}` : ''}\n\n${transcript}`,
    'You compress conversations into faithful working summaries.',
  );
  if (!summary) return null;
  session.messages = [
    msgs[0],
    { role: 'user', content: `[Summary of the earlier conversation]\n${summary}` },
    { role: 'assistant', content: 'Understood. I will continue from this summary.' },
    ...msgs.slice(keepFrom),
  ];
  return { before, after: estimate(session.messages) };
}

module.exports = { estimate, windowOf, compact, quickAsk };
