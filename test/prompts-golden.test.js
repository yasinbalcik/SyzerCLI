'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const H = require('../src/headless');
const context = require('../src/context');

let prompts;
let limits;
try {
  prompts = require('../src/prompts');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}
try {
  limits = require('../src/limits');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}

const a2Ready = Boolean(prompts);
const limitsReady = Boolean(limits || (prompts && prompts.LIMITS));
const skipPrompt = (!a2Ready && !process.env.A2_STRICT) ? 'waiting for A2 implementation in src/prompts.js' : false;
const skipLimits = (!limitsReady && !process.env.A2_STRICT) ? 'waiting for A2 implementation in src/limits.js' : false;

function getPrompts() {
  if (!prompts) assert.fail('src/prompts.js has not been implemented yet (A2 implementation required)');
  return prompts;
}

function getLimits() {
  const l = limits || (prompts && prompts.LIMITS);
  if (!l) assert.fail('src/limits.js has not been implemented yet (A2 implementation required)');
  return l;
}

test('golden: LIMITS: A0 values, Object.freeze, positive numbers', { skip: skipLimits }, () => {
  const L = getLimits();
  assert.ok(L && typeof L === 'object', 'LIMITS must be an object');
  assert.ok(Object.isFrozen(L), 'LIMITS must be frozen with Object.freeze');

  // Exact values from Spec 5.3 & A0 inventory
  assert.strictEqual(L.instructionFile, 12000, 'instructionFile limit');
  assert.strictEqual(L.mentionFile, 30000, 'mentionFile limit');
  assert.strictEqual(L.toolOutput, 20000, 'toolOutput limit');
  assert.strictEqual(L.subagentReport, 8000, 'subagentReport limit');
  assert.strictEqual(L.orchestraReport, 3500, 'orchestraReport limit');
  assert.strictEqual(L.dependencyContext, 2500, 'dependencyContext limit');
  assert.strictEqual(L.transcript, 60000, 'transcript limit');
  assert.strictEqual(L.summaryWords, 600, 'summaryWords limit');

  // Every limit must be a positive integer
  for (const [k, v] of Object.entries(L)) {
    assert.ok(typeof v === 'number' && Number.isInteger(v) && v > 0, `LIMITS.${k} must be positive integer`);
  }
});

test('golden: base() contains [BASE], cwd, platform, language, read-before-edit', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const input = { cwd: '/test/workspace', platform: 'win32', language: 'English' };
  const out1 = P.base(input);
  const out2 = P.base(input);

  assert.strictEqual(out1, out2, 'base() must be pure and deterministic');
  assert.ok(out1.includes('[BASE]'), 'must contain [BASE]');
  assert.ok(out1.includes('/test/workspace'), 'must contain cwd');
  assert.ok(out1.includes('PowerShell') || out1.includes('win32'), 'must mention shell/platform');
  assert.ok(out1.includes('English'), 'must mention language');
  assert.ok(/read a file before editing|inspect before changing/i.test(out1), 'must mention reading before editing');
  assert.ok(/concise/i.test(out1), 'must mention concise replies');
  assert.ok(!out1.includes('undefined'), 'must not contain undefined');
  assert.ok(!out1.includes('[object Object]'), 'must not contain [object Object]');
});

test('golden: leadSystem() layer order: BASE < ROLE < MODE < DYNAMIC', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const fullInput = {
    cwd: '/test/lead-work',
    platform: 'linux',
    language: 'English',
    mode: 'normal',
    skills: [{ name: 'test_skill', description: 'a skill description' }],
    instructionFiles: [{ path: 'SYZER.md', text: 'rule 1' }],
    todo: [{ id: 1, content: 'step 1', status: 'pending' }],
    dependencies: new Map([['dep1', 'result 1']]),
    retry: { why: 'stalled' },
    budget: 'warning',
  };
  const out = P.leadSystem(fullInput);

  assert.ok(typeof out === 'string', 'leadSystem must return string');
  assert.ok(!out.includes('undefined'), 'must not contain undefined');
  assert.ok(!out.includes('[object Object]'), 'must not contain [object Object]');

  const idxBase = out.indexOf('[BASE]');
  const idxRole = out.indexOf('[ROLE:lead]');
  const idxMode = out.indexOf('[MODE:');
  const idxDyn = out.indexOf('[DYNAMIC]');

  assert.ok(idxBase !== -1, 'must contain [BASE]');
  assert.ok(idxRole !== -1, 'must contain [ROLE:lead]');
  assert.ok(idxMode !== -1, 'must contain [MODE:...]');
  assert.ok(idxDyn !== -1, 'must contain [DYNAMIC] when dynamic data exists');

  assert.ok(idxBase < idxRole, 'BASE must precede ROLE');
  assert.ok(idxRole < idxMode, 'ROLE must precede MODE');
  assert.ok(idxMode < idxDyn, 'MODE must precede DYNAMIC');
});

test('golden: leadSystem() omits DYNAMIC when no dynamic items provided', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const minimalInput = {
    cwd: '/test/minimal',
    platform: 'linux',
    language: 'English',
    mode: 'normal',
  };
  const out = P.leadSystem(minimalInput);

  assert.ok(out.includes('[BASE]'), 'must contain [BASE]');
  assert.ok(out.includes('[ROLE:lead]'), 'must contain [ROLE:lead]');
  assert.ok(out.includes('[MODE:normal]'), 'must contain [MODE:normal]');
  assert.ok(!out.includes('[DYNAMIC]'), 'must not include [DYNAMIC] when no dynamic items present');
  assert.ok(!out.includes('undefined'), 'must not contain undefined');
  assert.ok(!out.includes('[object Object]'), 'must not contain [object Object]');
});

test('golden: leadSystem() character count does not exceed baseline buildContext()', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const cwd = process.cwd();
  const baseline = context.buildContext(cwd).system;

  const leadOut = P.leadSystem({
    cwd,
    platform: process.platform === 'win32' ? 'PowerShell' : 'sh',
    language: 'English',
    mode: 'normal',
  });

  // Spec section 1.5, 6: leadSystem character count on empty dynamic fixture must not exceed baseline
  assert.ok(leadOut.length <= baseline.length, `leadSystem (${leadOut.length}) exceeds baseline buildContext (${baseline.length})`);
});

test('golden: role({ name: "explore" }) is read-only, mentions file paths, line numbers, no modification', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const out = P.role({ name: 'explore' });
  assert.ok(/read-only|salt-okunur/i.test(out), 'must mention read-only');
  assert.ok(/file paths/i.test(out), 'must mention file paths');
  assert.ok(/line numbers/i.test(out), 'must mention line numbers');
  assert.ok(/never modify|do not modify|cannot modify/i.test(out), 'must prohibit modification');
});

test('golden: role({ name: "plan" }) is read-only, numbered plan, exact files, risks', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const out = P.role({ name: 'plan' });
  assert.ok(/read-only|salt-okunur/i.test(out), 'must mention read-only');
  assert.ok(/numbered (implementation )?plan/i.test(out), 'must mention numbered plan');
  assert.ok(/exact files/i.test(out), 'must mention exact files');
  assert.ok(/risks/i.test(out), 'must mention risks');
});

test('golden: role({ name: "general" }) assigned task, tools, concise final report', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const out = P.role({ name: 'general' });
  assert.ok(/assigned task/i.test(out), 'must mention assigned task');
  assert.ok(/tools/i.test(out), 'must mention tools');
  assert.ok(/report/i.test(out), 'must mention report');
});

test('golden: taskMode("plan") vs taskMode("normal")', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const planOut = typeof P.taskMode === 'function' ? (P.taskMode({ mode: 'plan' }) || P.taskMode('plan')) : '';
  const normalOut = typeof P.taskMode === 'function' ? (P.taskMode({ mode: 'normal' }) || P.taskMode('normal')) : '';

  assert.ok(planOut.includes('[MODE:plan]'), 'plan mode must include [MODE:plan]');
  assert.ok(/read-only|salt-okunur/i.test(planOut), 'plan mode must mention read-only');
  assert.ok(/numbered plan|plan/i.test(planOut), 'plan mode must mention plan');
  assert.ok(/approval|onay/i.test(planOut), 'plan mode must ask for approval');

  assert.ok(!/approval|onay/i.test(normalOut), 'normal mode must not ask for approval');
  assert.ok(!/read-only tools only/i.test(normalOut), 'normal mode must not restrict to read-only');
});

test('golden: subagentSystem() hierarchy, no questions to user, task language report', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const ctx = {
    header: 'You are SyzerCLI working in /workspace',
    files: [
      { path: 'DOC1.md', text: 'content 1' },
      { path: 'DOC2.md', text: 'content 2' },
    ],
  };
  const agent = {
    name: 'explore',
    prompt: 'You are an exploration agent.',
  };
  const out = P.subagentSystem({ ctx, agent, language: 'Turkish' });

  assert.ok(out.includes('subagent working for a lead agent'), 'must mention hierarchy');
  assert.ok(out.includes('cannot ask the user questions'), 'must forbid asking questions to user');
  assert.ok(/Turkish/i.test(out), 'must specify final report in Turkish');
  // Order of instruction files preserved
  const idx1 = out.indexOf('DOC1.md');
  const idx2 = out.indexOf('DOC2.md');
  assert.ok(idx1 !== -1 && idx2 !== -1 && idx1 < idx2, 'must preserve instruction files order');
});

test('golden: todoReminder() lists open items, run_plan, todo_write, secret from user', { skip: skipPrompt }, () => {
  const P = getPrompts();
  const items = [
    { content: 'Inspect repo structure', status: 'pending' },
    { content: 'Write golden tests', status: 'in_progress' },
  ];
  const out = P.todoReminder(items);

  assert.ok(out.includes('[system reminder]'), 'must contain [system reminder]');
  assert.ok(out.includes('Inspect repo structure'), 'must list open item 1');
  assert.ok(out.includes('Write golden tests'), 'must list open item 2');
  assert.ok(out.includes('run_plan'), 'must mention run_plan');
  assert.ok(out.includes('todo_write'), 'must mention todo_write');
  assert.ok(/do not mention this reminder to the user/i.test(out), 'must forbid mentioning reminder to user');
});

test('golden: orchestraRules(), dependencyContext(), retryNotice()', { skip: skipPrompt }, () => {
  const P = getPrompts();

  const rules = P.orchestraRules();
  assert.ok(/do only this assignment/i.test(rules), 'orchestraRules must mention assignment scope');
  assert.ok(/do not create, modify or delete/i.test(rules), 'orchestraRules must forbid unauthorized modification');
  assert.ok(/concise report/i.test(rules), 'orchestraRules must request concise report');

  // dependencyContext truncates to LIMITS.dependencyContext (2500)
  const longOutput = 'A'.repeat(5000);
  const depContext = P.dependencyContext(new Map([['task-1', longOutput]]));
  assert.ok(depContext.includes('### Result of [task-1]'), 'must include task header');
  assert.ok(depContext.includes('earlier steps you depend on'), 'must include dependency header');
  assert.ok(depContext.length < longOutput.length, 'must truncate long dependency report');
  assert.ok(depContext.includes('…(truncated)') || depContext.includes('(truncated)'), 'must note truncation');

  // retryNotice includes why and efficiency instruction
  const retry = P.retryNotice({ why: 'hit step limit' });
  assert.ok(retry.includes('previous attempt'), 'retryNotice must mention previous attempt');
  assert.ok(retry.includes('hit step limit'), 'retryNotice must include why');
  assert.ok(/final report/i.test(retry), 'retryNotice must mention final report');
});

test('golden: summarySystem(), summaryPrompt(), summaryAck()', { skip: skipPrompt }, () => {
  const P = getPrompts();

  const sys = P.summarySystem();
  assert.ok(/faithful working summaries|faithful summaries/i.test(sys), 'summarySystem must specify faithful summaries');

  const p = P.summaryPrompt({ transcript: 'user: hello\nassistant: hi', hint: 'focus on files' });
  assert.ok(/goals/i.test(p), 'summaryPrompt must mention goals');
  assert.ok(/decisions/i.test(p), 'summaryPrompt must mention decisions');
  assert.ok(/files/i.test(p), 'summaryPrompt must mention files');
  assert.ok(/TODOs/i.test(p), 'summaryPrompt must mention TODOs');
  assert.ok(/commands/i.test(p), 'summaryPrompt must mention commands');
  assert.ok(/600 words/i.test(p), 'summaryPrompt must mention 600 words');
  assert.ok(p.includes('focus on files'), 'summaryPrompt must include hint');

  const ack = P.summaryAck();
  const ackText = typeof ack === 'string' ? ack : (ack && ack.content) || '';
  assert.ok(/Understood\. I will continue from this summary\./i.test(ackText), 'summaryAck must have fixed acknowledgment');
});

test('golden: toolDescription("edit_file") and toolDescription("todo_write")', { skip: skipPrompt }, () => {
  const P = getPrompts();

  const edit = P.toolDescription('edit_file');
  assert.ok(/read (the )?file first/i.test(edit), 'edit_file must instruct reading first');
  assert.ok(/match exactly once/i.test(edit), 'edit_file must instruct exact match once');
  assert.ok(/edits/i.test(edit) && /order/i.test(edit), 'edit_file must mention edits array in order');
  assert.ok(/replace_all/i.test(edit), 'edit_file must mention replace_all');
  assert.ok(/re-read/i.test(edit), 'edit_file must instruct re-reading on mismatch');

  const todo = P.toolDescription('todo_write');
  assert.ok(/3\+\s*(distinct\s*steps|steps)/i.test(todo), 'todo_write must specify 3+ steps');
  assert.ok(/full list/i.test(todo), 'todo_write must require full list');
  assert.ok(/one in_progress/i.test(todo), 'todo_write must require one in_progress');
  assert.ok(/agent/i.test(todo) && /depends_on/i.test(todo), 'todo_write must mention orchestra fields');
  assert.ok(/run_plan/i.test(todo), 'todo_write must mention run_plan');
});

test('golden: error() ERR_ prefix, single line, hint, no stack trace', { skip: skipPrompt }, () => {
  const P = getPrompts();

  const withHint = P.error('INVALID_JSON', 'arguments are not valid JSON', 'Retry with an object');
  assert.ok(withHint.startsWith('ERR_INVALID_JSON:'), 'must start with ERR_INVALID_JSON:');
  assert.ok(withHint.includes('arguments are not valid JSON'), 'must include detail');
  assert.ok(withHint.includes('Retry with an object'), 'must include hint');
  assert.ok(!withHint.includes('\n'), 'must be a single line');
  assert.ok(!withHint.includes('at '), 'must not contain stack trace');

  const noHint = P.error('MISSING_PROMPT', 'prompt is required');
  assert.ok(noHint.startsWith('ERR_MISSING_PROMPT:'), 'must start with ERR_MISSING_PROMPT:');
  assert.ok(noHint.includes('prompt is required'), 'must include detail');
  assert.ok(!noHint.includes('\n'), 'must be a single line');

  // Verify other spec error codes produce ERR_<CODE>
  const codes = ['UNKNOWN_AGENT', 'EDIT_NOT_FOUND', 'EDIT_AMBIGUOUS', 'NO_AGENT_ITEM', 'TOOL_FAILED'];
  for (const c of codes) {
    const errStr = P.error(c, 'test detail');
    assert.ok(errStr.startsWith(`ERR_${c}:`), `code ${c} must format as ERR_${c}:`);
  }
});

test('golden: formatToolResult() pure contract and fallback', { skip: skipPrompt }, () => {
  const P = getPrompts();

  const successInput = { ok: true, output: '10 files found', ui: { summary: '10 files' } };
  const inputCopy = JSON.stringify(successInput);
  const successRes = P.formatToolResult(successInput);

  assert.strictEqual(JSON.stringify(successInput), inputCopy, 'formatToolResult must not mutate input');
  assert.strictEqual(successRes.ok, true);
  assert.strictEqual(successRes.output, '10 files found');
  assert.deepStrictEqual(successRes.ui, { summary: '10 files' });

  // Empty output fallback to (no output)
  const emptyRes = P.formatToolResult({ ok: true, output: '' });
  assert.strictEqual(emptyRes.output, '(no output)', 'empty output must fall back to (no output)');

  // Failure result
  const failRes = P.formatToolResult({ ok: false, output: 'ERR_TOOL_FAILED: timeout' });
  assert.strictEqual(failRes.ok, false);
  assert.ok(failRes.output.startsWith('ERR_TOOL_FAILED:'));
});

test('golden: language policy: TR sentences translated, tool/code/JSON keywords preserved', { skip: skipPrompt }, () => {
  const P = getPrompts();

  const trBase = P.base({ cwd: '/workspace', platform: 'linux', language: 'tr' });
  const enBase = P.base({ cwd: '/workspace', platform: 'linux', language: 'en' });

  // Both should mention language preference / override
  assert.ok(/unless the user writes in another language|kullanıcı başka bir dilde yazmadıkça/i.test(trBase) ||
            /unless the user writes in another language|başka bir dil/i.test(enBase),
            'must note user language priority');

  // JSON keys and tool names must remain unchanged in TR
  assert.ok(trBase.includes('edit_file') || trBase.includes('write_file'), 'tool names must remain in English in TR');
  assert.ok(!trBase.includes('duzenle_dosya'), 'tool names must not be translated');
});

test('golden: headless buildResult: content === result backwards compatibility', () => {
  const res = H.buildResult({
    content: 'Completed step 1',
    exitCode: 0,
    sessionId: 'sess-123',
    tokens: 345,
    toolTurns: 4,
    ms: 2500,
    changed: ['src/app.js'],
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.result, 'Completed step 1');
  assert.strictEqual(res.content, res.result, 'content must strictly equal result for backwards compatibility');
  assert.deepStrictEqual(res.session, { id: 'sess-123' });
  assert.deepStrictEqual(res.usage, { tokens: 345, toolTurns: 4, seconds: 2.5 });
  assert.deepStrictEqual(res.files, { changed: ['src/app.js'] });

  // Error case
  const errRes = H.buildResult({ content: '', error: 'ERR_TOOL_FAILED', exitCode: 1 });
  assert.strictEqual(errRes.ok, false);
  assert.strictEqual(errRes.content, errRes.result);
  assert.strictEqual(errRes.error, 'ERR_TOOL_FAILED');

  // Verify JSON serializability
  const jsonStr = JSON.stringify(res);
  const parsed = JSON.parse(jsonStr);
  assert.strictEqual(parsed.result, parsed.content);
});

test('golden: headless outBody prefixes: ERROR:, BUDGET EXCEEDED:, (no output)', () => {
  assert.strictEqual(H.outBody({ error: 'something broke' }), 'ERROR: something broke');
  assert.strictEqual(H.outBody({ content: 'done', budgetExceeded: 'tokens' }), 'BUDGET EXCEEDED: tokens\n\ndone');
  assert.strictEqual(H.outBody({ content: '' }), '(no output)');
  assert.strictEqual(H.outBody({ content: 'normal text' }), 'normal text');
});
