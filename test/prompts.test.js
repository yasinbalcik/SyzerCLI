'use strict';

// Ana makinenin ~/.claude ve ~/.syzercli içeriği prompt ölçümünü etkilemesin (node --test dosya başına ayrı süreç)
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-home-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.SYZER_HOME = path.join(HOME, '.syzercli');

const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/prompts');
const { LIMITS } = require('../src/limits');

const ids = (s, tags) => tags.map((x) => s.indexOf(x));
const sorted = (a) => a.every((v, i) => v >= 0 && (i === 0 || v > a[i - 1]));

test('LIMITS: A0 values, frozen, positive numbers', () => {
  assert.deepStrictEqual({ ...LIMITS }, {
    instructionFile: 12000, mentionFile: 30000, toolOutput: 20000, subagentReport: 8000,
    orchestraReport: 3500, dependencyContext: 2500, transcript: 60000, summaryWords: 600,
  });
  assert.ok(Object.isFrozen(LIMITS));
  for (const v of Object.values(LIMITS)) assert.ok(typeof v === 'number' && v > 0);
});

test('base: identity, cwd, reply language, read-before-edit', () => {
  const s = P.base({ cwd: '/work', platform: 'linux', language: 'en' });
  assert.ok(s.startsWith('[BASE]'));
  assert.match(s, /Working directory: \/work/);
  assert.match(s, /Reply in English/);
  assert.match(s, /Read a file before editing/);
  assert.match(s, /sh/);
  assert.doesNotMatch(s, /undefined|\[object Object\]/);
});

test('leadSystem: layer order BASE < ROLE < MODE < DYNAMIC; no dynamic without sources', () => {
  const full = P.leadSystem({ cwd: '/w', platform: 'win32', language: 'en', skills: [{ name: 's1', description: 'd' }], instructionFiles: [{ path: '/w/CLAUDE.md', text: 'rules' }], agents: [{ name: 'explore', description: 'x' }] });
  assert.ok(sorted(ids(full, ['[BASE]', '[ROLE:lead]', '[MODE:normal]', '[DYNAMIC]'])));
  assert.match(full, /--- \/w\/CLAUDE\.md ---\nrules/);
  assert.match(full, /- s1: d/);
  assert.match(full, /PowerShell/);
  const bare = P.leadSystem({ cwd: '/w', platform: 'linux', language: 'en' });
  assert.ok(!bare.includes('[DYNAMIC]'));
  assert.doesNotMatch(bare, /undefined|\[object Object\]/);
  assert.ok(sorted(ids(bare, ['[BASE]', '[ROLE:lead]', '[MODE:normal]'])));
});

test('leadSystem: pure — input is not mutated, same input same output', () => {
  const input = Object.freeze({ cwd: '/w', platform: 'linux', language: 'en', skills: Object.freeze([Object.freeze({ name: 'a', description: 'b' })]) });
  assert.strictEqual(P.leadSystem(input), P.leadSystem(input));
});

test('role: explore / plan / general / summary', () => {
  const e = P.role({ name: 'explore' });
  assert.match(e, /\[ROLE:explore\]/);
  assert.match(e, /read-only|only read/i);
  assert.match(e, /file paths/);
  assert.match(e, /line numbers/);
  assert.match(e, /Never modify|Do not modify/i);
  const p = P.role({ name: 'plan' });
  assert.match(p, /read-only|only read/i);
  assert.match(p, /numbered plan/);
  assert.match(p, /exact files/);
  assert.match(p, /risks/);
  const g = P.role({ name: 'general' });
  assert.match(g, /assigned task/);
  assert.match(g, /tools/);
  assert.match(g, /concise final report/);
  assert.match(P.role({ name: 'summary' }), /faithful/);
  assert.match(P.role({ name: 'explore', tools: ['read_file', 'list_dir'] }), /read_file, list_dir/);
});

test('taskMode: plan has read-only + numbered plan + approval; normal has none of it', () => {
  const plan = P.taskMode('plan');
  assert.match(plan, /\[MODE:plan\]/);
  assert.match(plan, /read-only/i);
  assert.match(plan, /numbered plan/);
  assert.match(plan, /approval/);
  assert.deepStrictEqual(P.taskMode({ mode: 'plan' }), plan);
  const normal = P.taskMode('normal');
  assert.match(normal, /\[MODE:normal\]/);
  assert.doesNotMatch(normal, /read-only|numbered plan|approval/i);
  assert.match(P.taskMode('orchestra'), /\[MODE:orchestra\]/);
  assert.match(P.taskMode('summary'), /\[MODE:summary\]/);
});

test('planPrefix keeps the legacy [PLAN MODE] first line + blank line', () => {
  const s = P.planPrefix();
  assert.match(s, /^\[PLAN MODE\][^\n]*\n\n$/);
  assert.match(s, /read-only/i);
});

test('subagentSystem: base, role, hierarchy, no questions, report language, file order', () => {
  const ctx = { header: P.base({ cwd: '/w', platform: 'linux', language: 'en' }), files: [{ path: 'A.md', text: 'aaa' }, { path: 'B.md', text: 'bbb' }] };
  const s = P.subagentSystem({ ctx, agent: { name: 'explore', builtin: true, prompt: P.role({ name: 'explore' }) }, language: 'tr' });
  assert.ok(sorted(ids(s, ['[BASE]', '[ROLE:explore]', 'alt ajan', '--- A.md ---', '--- B.md ---'])));
  assert.match(s, /kullanıcıya soru soramaz/i);
  assert.match(P.subagentSystem({ ctx, agent: { name: 'x', prompt: 'p' }, language: 'en' }), /subagent working for a lead agent. You cannot ask the user/);
  assert.match(s, /Son raporunu Türkçe yaz/);
  const custom = P.subagentSystem({ ctx, agent: { name: 'mine', prompt: 'Do X.' } });
  assert.match(custom, /\[ROLE:mine\]\nDo X\./);
  assert.match(custom, /same language as the task/);
});

test('todoReminder: tag, unfinished items, run_plan/todo_write, silent to user', () => {
  const s = P.todoReminder([{ content: 'a', status: 'pending' }, { content: 'b', status: 'in_progress' }]);
  assert.ok(s.startsWith('[system reminder]'));
  assert.match(s, /unfinished items: "a" \(pending\), "b" \(in_progress\)/);
  assert.match(s, /run_plan/);
  assert.match(s, /todo_write/);
  assert.match(s, /Do not mention this reminder/);
});

test('orchestra: rules, dependency context (limit, order), retry notice', () => {
  assert.match(P.orchestraRules(), /do only this assignment/);
  assert.strictEqual(P.dependencyContext([]), '');
  const d = P.dependencyContext([{ id: 'a', report: 'x'.repeat(5000) }, { id: 'b', report: 'short' }]);
  assert.match(d, /### Result of \[a\]\nx+\n…\(truncated\)/);
  assert.strictEqual(P.dependencyContext(new Map([['m', 'x']])), '---\nResults from earlier steps you depend on:\n### Result of [m]\nx');
  assert.match(d, /### Result of \[b\]\nshort/);
  assert.ok(d.indexOf('[a]') < d.indexOf('[b]'));
  assert.ok(d.length < 2500 + 400);
  assert.match(P.dependencyContext([{ id: 'a', report: 'x'.repeat(50) }], { limit: 10 }), /x{10}\n…\(truncated\)$/);
  assert.match(P.retryNotice({ why: 'ran out of steps' }), /previous attempt ran out of steps/);
});

test('budgetNotice: texts stay identical to the legacy ones', () => {
  assert.strictEqual(P.budgetNotice({ kind: 'stop', reason: 'tokens limit reached' }), 'tokens limit reached. Reply to continue (counters reset on your next prompt) or raise the limit with /budget.');
  assert.strictEqual(P.budgetNotice({ kind: 'assistant', reason: 'r' }), '[budget exceeded: r. Stopped after the last tool batch; the user may continue.]');
  assert.strictEqual(P.budgetNotice({ kind: 'subagent', reason: 'r' }), '[budget exceeded: r; stopped early]');
});

test('summary: system, prompt (~600 words, hint), ack, tag', () => {
  assert.match(P.summarySystem(), /faithful/);
  const p = P.summaryPrompt({ transcript: 'T', hint: 'focus' });
  assert.match(p, /goals/);
  assert.match(p, /decisions/);
  assert.match(p, /files/);
  assert.match(p, /TODOs/);
  assert.match(p, /commands/);
  assert.match(p, /~600 words/);
  assert.match(p, /Extra focus: focus/);
  assert.ok(p.endsWith('\n\nT'));
  assert.doesNotMatch(P.summaryPrompt({ transcript: 'T' }), /Extra focus/);
  assert.strictEqual(P.summaryAck(), 'Understood. I will continue from this summary.');
  assert.strictEqual(P.SUMMARY_TAG, '[Conversation summary]');
});

test('toolDescription: edit_file and todo_write carry the key rules; every tool has one', () => {
  const e = P.toolDescription('edit_file');
  assert.match(e, /Read the file first/);
  assert.match(e, /exactly once/);
  assert.match(e, /edits/);
  assert.match(e, /in order/);
  assert.match(e, /replace_all/);
  assert.match(e, /re-read/i);
  const t = P.toolDescription('todo_write');
  assert.match(t, /3\+/);
  assert.match(t, /full list/i);
  assert.match(t, /in_progress/);
  assert.match(t, /depends_on/);
  assert.match(t, /run_plan/);
  const { DEFS, SPAWN_DEF, RUN_PLAN_DEF } = require('../src/tools');
  for (const d of [...DEFS, SPAWN_DEF, RUN_PLAN_DEF]) assert.strictEqual(d.function.description, P.toolDescription(d.function.name), d.function.name);
  assert.throws(() => P.toolDescription('nope'));
});

test('error: single ERR_ line, detail + hint, no stack', () => {
  assert.strictEqual(P.error('INVALID_JSON', 'tool arguments are not valid JSON', 'Retry with an object.'), 'ERR_INVALID_JSON: tool arguments are not valid JSON. Retry with an object.');
  assert.strictEqual(P.error('TOOL_FAILED', 'boom'), 'ERR_TOOL_FAILED: boom');
  assert.strictEqual(P.error('X', 'ends with dot.', 'Hint.'), 'ERR_X: ends with dot. Hint.');
  const multi = P.error('TOOL_FAILED', new Error('a\nb\n   at foo (file.js:1:1)'));
  assert.ok(!multi.includes('\n'));
  assert.doesNotMatch(multi, /\n/);
});

test('formatToolResult: ok boolean, string output, ui optional, input untouched, extras kept', () => {
  const input = Object.freeze({ ok: 1, output: '', model: 'm' });
  const r = P.formatToolResult(input);
  assert.deepStrictEqual(r, { ok: true, output: '(no output)', model: 'm' });
  assert.ok(!('ui' in r));
  const u = P.formatToolResult({ ok: false, output: 5, ui: { summary: 's' } });
  assert.deepStrictEqual(u, { ok: false, output: '5', ui: { summary: 's' } });
  const f = P.failure('UNKNOWN_AGENT', 'agent "x" is not available', 'Choose one of: a.', { routedRole: null });
  assert.strictEqual(f.ok, false);
  assert.strictEqual(f.output, 'ERR_UNKNOWN_AGENT: agent "x" is not available. Choose one of: a.');
  assert.strictEqual(f.ui.summary, 'agent "x" is not available. Choose one of: a.');
  assert.strictEqual(f.routedRole, null);
});

test('language policy: tr sentences are Turkish, tool names / keys stay English; en unchanged', () => {
  const tr = P.leadSystem({ cwd: '/w', platform: 'linux', language: 'tr' });
  assert.match(tr, /Çalışma dizini: \/w/);
  assert.match(tr, /Türkçe/);
  assert.match(tr, /todo_write/);
  assert.match(tr, /edit_file/);
  assert.match(tr, /\[ROLE:lead\]/);
  assert.doesNotMatch(tr, /Reply in/);
  const en = P.leadSystem({ cwd: '/w', platform: 'linux', language: 'en' });
  assert.match(en, /Reply in English unless the user writes in another language/);
  assert.match(P.todoReminder([{ content: 'a', status: 'pending' }], { language: 'tr' }), /^\[system reminder\] .*tamamlanmamış/);
});

test('dynamic: empty parts are skipped, no placeholder text', () => {
  assert.strictEqual(P.dynamic({}), '');
  assert.strictEqual(P.dynamic({ skills: [], instructionFiles: [], todo: [] }), '');
  const d = P.dynamic({ todo: [{ content: 'a', status: 'pending' }], retry: 'ran out of steps', budget: 'b' });
  assert.ok(d.startsWith('[DYNAMIC]'));
  assert.match(d, /unfinished items/);
  assert.match(d, /previous attempt ran out of steps/);
  assert.doesNotMatch(d, /undefined|\[object Object\]/);
});

test('buildContext wires leadSystem; empty-fixture system prompt does not grow (<= 2578 chars)', () => {
  const cwd = '/proj'; // sabit cwd: eski buildContext('/proj').system = 2578 karakter (en, boş beceri/talimat)
  const { setLang, getLang } = require('../src/i18n');
  const prev = getLang();
  try {
    setLang('en');
    const { buildContext, subSystem } = require('../src/context');
    const ctx = buildContext(cwd);
    assert.ok(ctx.system.startsWith('[BASE]'));
    assert.ok(ctx.system.includes(`Working directory: ${cwd}`));
    assert.ok(ctx.header.startsWith('[BASE]'));
    assert.ok(ctx.system.includes('- explore:'));
    assert.ok(subSystem(ctx, ctx.agents[0]).includes('[ROLE:explore]'));
    assert.ok(ctx.system.length <= 2578, `system prompt grew: ${ctx.system.length}`);
  } finally {
    setLang(prev);
    fs.rmSync(HOME, { recursive: true, force: true });
  }
});
