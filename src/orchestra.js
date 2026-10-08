'use strict';

// Orkestra: todo listesindeki `agent` atanmış maddeleri bağımlılık sırasına göre dalgalar halinde,
// her dalgada paralel alt ajanlarla çalıştırır. Ana model orkestratördür; alt ajanlar kendi (ucuz) modelleriyle çalışır.
const { renderTodos } = require('./tools');
const { trunc } = require('./ui');

const MAX_DEP_CONTEXT = 2500; // bağımlı ajana aktarılan rapor başına karakter
const MAX_REPORT = 3500; // orkestratöre dönen rapor başına karakter
const MAX_WAVES = 12;
const RULES = '\n\n(Rules: do only this assignment. Do NOT create, modify or delete any file unless the assignment above explicitly tells you to write that file. Finish with a concise report as your final message.)';
const RETRY_STEPS = 24; // ilk deneme adım sınırına çarparsa ikinci denemenin bütçesi

// Boş/yarım kalan sonuç başarı sayılmaz
const isBad = (r) => !r.ok || r.stopped || !String(r.output || '').trim() || String(r.output).trim() === '(no output)';

const isDone = (x) => x.status === 'completed';

// Hazır: tamamlanmamış (model in_progress yazmış olsa da), hatasız, tüm bağımlılıkları tamamlanmış agent maddeleri
function readyItems(list) {
  const byId = new Map(list.map((x) => [x.id, x]));
  return list.filter((x) => x.agent && !isDone(x) && !x.error && (x.depends_on || []).every((d) => byId.get(d) && isDone(byId.get(d))));
}

function depContext(item, reports) {
  const parts = (item.depends_on || []).filter((d) => reports.has(d)).map((d) => `### Result of [${d}]\n${trunc(reports.get(d), MAX_DEP_CONTEXT)}`);
  return parts.length ? `\n\n---\nResults from earlier steps you depend on:\n${parts.join('\n\n')}` : '';
}

// Kullanıcının son isteği dosya değiştirmemeyi söylüyor mu? (alt ajanlar bu kısıtı görmez, araçlardan zorlarız)
const NO_WRITE = /(değiştirme|düzenleme|dokunma|oluşturma|salt[- ]?okunur|do(es)? ?n[o']?t (modify|change|edit|write|create)|without (modifying|changing|editing|writing)|read[- ]?only)/i;
function readOnlyRequested(session) {
  const msgs = session.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(' ');
    if (text.startsWith('[system reminder]')) continue;
    return NO_WRITE.test(text);
  }
  return false;
}

// run_plan çağrısı → { ok, output, ui }
async function runPlan(session, call, signal) {
  const { spawn } = require('./subagents'); // döngüsel bağımlılığı önlemek için geç yükleme
  const list = session.todos || [];
  if (!list.some((x) => x.agent)) {
    return { ok: false, output: 'No todo item has an "agent". Use todo_write with agent (+ prompt, depends_on) on the items subagents should do, then call run_plan.' };
  }
  let argsIn = {};
  try { argsIn = JSON.parse(call.arguments || '{}'); } catch { /* boş kabul */ }
  const readOnly = argsIn.read_only === true || readOnlyRequested(session);
  const reports = new Map();
  const results = [];
  let waves = 0;

  while (waves < MAX_WAVES) {
    const ready = readyItems(list);
    if (!ready.length) break;
    waves++;
    ready.forEach((x) => { x.status = 'in_progress'; delete x.error; });
    session.out.toolResult(true, '', { summary: `wave ${waves}: ${ready.length} agent${ready.length > 1 ? 's' : ''}`, body: renderTodos(list, true) });

    await Promise.all(ready.map(async (item) => {
      const args = { agent: item.agent, description: trunc(item.content, 40), prompt: `${item.prompt || item.content}${depContext(item, reports)}${RULES}` };
      if (item.model) args.model = item.model;
      if (readOnly) args.read_only = true;
      let r;
      try {
        r = await spawn(session, { arguments: JSON.stringify(args) }, signal);
        if (isBad(r) && !(signal && signal.aborted)) { // geçici hata / adım sınırı: bir kez daha, daha geniş bütçeyle
          const why = r.stopped ? 'ran out of steps' : r.ok ? 'returned no report' : 'failed';
          if (session.out.warn) session.out.warn(`[${item.agent}: ${trunc(item.content, 30)}] ${why}; retrying once`);
          const retry = { ...args, max_steps: RETRY_STEPS, prompt: `${args.prompt}\n\n(Your previous attempt ${why}. Be efficient: read only what you need, then finish with your final report.)` };
          r = await spawn(session, { arguments: JSON.stringify(retry) }, signal);
        }
      } catch (err) { item.status = 'pending'; throw err; } // iptal: madde bekleyen kalsın
      const bad = isBad(r);
      if (!bad) { item.status = 'completed'; reports.set(item.id, r.output); (session.planDone ||= new Set()).add(item.id); }
      else { item.status = 'pending'; item.error = (r.stopped ? 'stopped at step limit' : r.ok ? 'empty report' : String(r.output || 'failed')).replace(/\s+/g, ' ').slice(0, 160); }
      results.push({ item, ok: !bad, output: r.output });
    }));
    if (signal && signal.aborted) break;
  }

  const failed = list.filter((x) => x.agent && x.error);
  const blocked = list.filter((x) => x.agent && !isDone(x) && !x.error);
  const mine = list.filter((x) => !x.agent && !isDone(x));
  const allDone = list.every(isDone);
  const body = renderTodos(list, true);
  if (allDone) { session.todos = []; session.planDone = new Set(); }

  const sections = results.map(({ item, ok, output }) => `### [${item.id}] ${item.content} (${item.agent}${item.model ? ' · ' + item.model : ''}) — ${ok ? 'done' : 'FAILED'}\n${trunc(String(output), MAX_REPORT)}`);
  const tail = [];
  if (failed.length) tail.push(`Failed (fix the prompt/agent and re-send the list, or do it yourself): ${failed.map((x) => `[${x.id}] ${x.error}`).join('; ')}`);
  if (blocked.length) tail.push(`Blocked by unfinished dependencies: ${blocked.map((x) => `[${x.id}]`).join(', ')}`);
  if (mine.length) tail.push(`Left for you (no agent): ${mine.map((x) => `[${x.id}] ${x.content}`).join('; ')}`);
  tail.push(allDone ? 'All items completed; the list was cleared. Verify the reports for consistency, then write the final answer.'
    : 'Verify the reports, do your own items, update the list with todo_write (keep completed items completed), and call run_plan again if agent items remain.');

  const done = list.filter(isDone).length;
  const total = list.length;
  return {
    ok: true,
    output: `${sections.join('\n\n') || '(no agent item was ready)'}\n\n${tail.join('\n')}`,
    ui: { summary: `${waves} wave${waves === 1 ? '' : 's'} · ${results.filter((r) => r.ok).length}/${results.length} ok · ${allDone ? total : done}/${total}`, body },
  };
}

module.exports = { runPlan, readyItems, readOnlyRequested };
