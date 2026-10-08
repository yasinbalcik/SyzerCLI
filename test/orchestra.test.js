'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateTodos, toolDefsFor } = require('../src/tools');
const { runPlan, readyItems } = require('../src/orchestra');
const subagents = require('../src/subagents');

const I = (id, status, extra = {}) => ({ id, content: `item ${id}`, status, ...extra });

test('validateTodos: id otomatik, agent alanları korunur', () => {
  const v = validateTodos([{ content: 'a', status: 'pending', agent: 'explore', prompt: 'p', model: 'x/y' }, { content: 'b', status: 'in_progress' }]);
  assert.deepStrictEqual(v.list.map((x) => x.id), ['t1', 't2']);
  assert.strictEqual(v.list[0].agent, 'explore');
  assert.strictEqual(v.list[0].model, 'x/y');
  assert.strictEqual(v.orchestrated, true);
});
test('validateTodos: bağımlılık hataları', () => {
  assert.match(validateTodos([I('a', 'pending', { agent: 'g', depends_on: ['zz'] })]).error, /unknown id/);
  assert.match(validateTodos([I('a', 'pending', { agent: 'g', depends_on: ['a'] })]).error, /itself/);
  assert.match(validateTodos([I('a', 'pending', { agent: 'g', depends_on: ['b'] }), I('b', 'pending', { agent: 'g', depends_on: ['a'] })]).error, /cycle/);
  assert.match(validateTodos([I('a', 'pending'), I('b', 'pending', { depends_on: ['a'] })]).error, /no agent/);
  assert.match(validateTodos([I('a', 'pending'), I('a', 'pending')].map((x, i) => ({ ...x, content: 'c' + i }))).error, /reuses id/);
});
test('validateTodos: orkestra planında birden çok/hiç in_progress serbest', () => {
  assert.ok(validateTodos([I('a', 'in_progress', { agent: 'g' }), I('b', 'in_progress', { agent: 'g' })]).list);
  assert.ok(validateTodos([I('a', 'pending', { agent: 'g' }), I('b', 'pending', { agent: 'g' })]).list);
});
test('readyItems: bağımlılığı bitenler hazır, hatalılar değil', () => {
  const l = [I('a', 'completed', { agent: 'g' }), I('b', 'pending', { agent: 'g', depends_on: ['a'] }), I('c', 'pending', { agent: 'g', depends_on: ['b'] }), I('d', 'pending', { agent: 'g', error: 'x' }), I('e', 'pending')];
  assert.deepStrictEqual(readyItems(l).map((x) => x.id), ['b']);
});

function fakeSession(todos) {
  return { todos, canSpawn: true, out: { toolResult() {} } };
}
async function withSpawn(fake, fn) {
  const orig = subagents.spawn;
  subagents.spawn = fake;
  try { return await fn(); } finally { subagents.spawn = orig; }
}

test('run_plan: bağımsızlar paralel dalgada, bağımlı olan önceki raporları alır, bitince liste temizlenir', async () => {
  const s = fakeSession([
    I('a', 'pending', { agent: 'explore', prompt: 'do A' }),
    I('b', 'pending', { agent: 'general', prompt: 'do B', model: 'm/big' }),
    I('c', 'pending', { agent: 'general', prompt: 'do C', depends_on: ['a', 'b'] }),
  ]);
  const calls = [];
  let running = 0; let maxPar = 0;
  const fake = async (_p, call) => {
    const a = JSON.parse(call.arguments);
    calls.push(a);
    running++; maxPar = Math.max(maxPar, running);
    await new Promise((r) => setTimeout(r, 10));
    running--;
    return { ok: true, output: `report for ${a.prompt.split('\n')[0]}` };
  };
  const r = await withSpawn(fake, () => runPlan(s, { arguments: '{}' }, undefined));
  assert.ok(r.ok);
  assert.strictEqual(maxPar, 2); // a ve b aynı anda
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[1].model, 'm/big');
  const c = calls.find((x) => x.prompt.startsWith('do C'));
  assert.match(c.prompt, /Result of \[a\][\s\S]*report for do A/);
  assert.match(c.prompt, /Result of \[b\][\s\S]*report for do B/);
  assert.deepStrictEqual(s.todos, []);
  assert.match(r.output, /All items completed/);
});

test('run_plan: başarısız madde hata alır, bağımlıları engellenir, kendi maddeleri orkestratöre kalır', async () => {
  const s = fakeSession([
    I('a', 'pending', { agent: 'g', prompt: 'A' }),
    I('b', 'pending', { agent: 'g', prompt: 'B' }),
    I('c', 'pending', { agent: 'g', prompt: 'C', depends_on: ['b'] }),
    I('d', 'pending'),
  ]);
  const fake = async (_p, call) => (JSON.parse(call.arguments).prompt.startsWith('B') ? { ok: false, output: 'Subagent failed: boom' } : { ok: true, output: 'ok' });
  const r = await withSpawn(fake, () => runPlan(s, { arguments: '{}' }, undefined));
  assert.ok(r.ok);
  assert.strictEqual(s.todos.find((x) => x.id === 'a').status, 'completed');
  assert.match(s.todos.find((x) => x.id === 'b').error, /boom/);
  assert.strictEqual(s.todos.find((x) => x.id === 'c').status, 'pending');
  assert.match(r.output, /Failed/);
  assert.match(r.output, /Blocked by unfinished dependencies: \[c\]/);
  assert.match(r.output, /Left for you \(no agent\): \[d\]/);
});

test('run_plan: agent maddesi yoksa hata', async () => {
  const r = await runPlan(fakeSession([I('a', 'in_progress')]), { arguments: '{}' });
  assert.ok(!r.ok);
});

test('run_plan yalnızca ana oturumda ve todo_write varken görünür', () => {
  const names = (s) => toolDefsFor(s).map((d) => d.function.name);
  assert.ok(names({ canSpawn: true }).includes('run_plan'));
  assert.ok(!names({ canSpawn: false, allowedTools: new Set(['read_file']) }).includes('run_plan'));
  assert.ok(!names({ canSpawn: true, allowedTools: new Set(['read_file']) }).includes('run_plan')); // todo_write yok
});

test('validateTodos: ajanlı maddeyi model kendisi completed yapamaz (run_plan yapmadıysa)', () => {
  const list = [I('a', 'completed', { agent: 'explore' }), I('b', 'pending')];
  assert.match(validateTodos(list, new Set()).error, /not run by run_plan/);
  assert.ok(validateTodos(list, new Set(['a'])).list); // run_plan tamamladıysa serbest
  assert.ok(validateTodos(list).list); // kontrol yalnızca planDone verilince
  assert.ok(validateTodos([I('a', 'completed'), I('b', 'in_progress')], new Set()).list); // ajansız madde serbest
});

test('run_plan: adım sınırına çarpan ajan bir kez daha geniş bütçeyle denenir', async () => {
  const s = fakeSession([I('a', 'pending', { agent: 'g', prompt: 'A' })]);
  const seen = [];
  const fake = async (_p, call) => {
    const a = JSON.parse(call.arguments);
    seen.push(a);
    return seen.length === 1 ? { ok: true, stopped: true, output: '(no output)' } : { ok: true, stopped: false, output: 'full report' };
  };
  const r = await withSpawn(fake, () => runPlan(s, { arguments: '{}' }, undefined));
  assert.strictEqual(seen.length, 2);
  assert.strictEqual(seen[1].max_steps, 24);
  assert.match(seen[1].prompt, /previous attempt ran out of steps/);
  assert.match(r.output, /done/);
  assert.ok(!/FAILED/.test(r.output));
  assert.deepStrictEqual(s.todos, []); // tek madde bitti -> liste temizlendi
});

test('run_plan: iki denemede de yarım kalırsa madde completed olmaz, hata ve bağımlı engeli raporlanır', async () => {
  const s = fakeSession([I('a', 'pending', { agent: 'g', prompt: 'A' }), I('b', 'pending', { agent: 'g', prompt: 'B', depends_on: ['a'] })]);
  let n = 0;
  const fake = async () => { n++; return { ok: true, stopped: true, output: 'partial' }; };
  const r = await withSpawn(fake, () => runPlan(s, { arguments: '{}' }, undefined));
  assert.strictEqual(n, 2); // yalnızca a, iki kez
  const a = s.todos.find((x) => x.id === 'a');
  assert.notStrictEqual(a.status, 'completed');
  assert.match(a.error, /step limit/);
  assert.match(r.output, /FAILED/);
  assert.match(r.output, /Blocked by unfinished dependencies: \[b\]/);
  assert.ok(!(s.planDone && s.planDone.has('a')));
});

test('run_plan: tamamlanan madde planDone\'a eklenir, böylece liste yeniden gönderilince doğrulama geçer', async () => {
  const s = fakeSession([I('a', 'pending', { agent: 'g', prompt: 'A' }), I('b', 'pending')]);
  await withSpawn(async () => ({ ok: true, output: 'rep' }), () => runPlan(s, { arguments: '{}' }, undefined));
  assert.ok(s.planDone.has('a'));
  const resend = s.todos.map((x) => ({ ...x }));
  assert.ok(validateTodos(resend, s.planDone).list);
});

test('validateTodos: metin bağımlılık söylüyor ama depends_on boşsa hata (aynı dalgada girdisiz çalışmasın)', () => {
  const bad = validateTodos([
    I('a', 'pending', { agent: 'explore' }),
    { id: 'c', content: "general ajanı, a ve b'ye bağlı, eksik testleri önersin", status: 'pending', agent: 'general' },
  ]);
  assert.match(bad.error, /depends_on/);
  assert.match(validateTodos([I('a', 'pending', { agent: 'explore' }), { id: 'c', content: 'based on the reports, suggest tests', status: 'pending', agent: 'general' }]).error, /depends_on/);
  // depends_on verilmişse veya bağımsızsa geçer
  assert.ok(validateTodos([I('a', 'pending', { agent: 'explore' }), { id: 'c', content: "a'ya bağlı öneri", status: 'pending', agent: 'general', depends_on: ['a'] }]).list);
  assert.ok(validateTodos([I('a', 'pending', { agent: 'explore', prompt: 'list the files' })]).list);
});

test('run_plan: alt ajan prompt\'una dosya değiştirmeme kuralı eklenir', async () => {
  const s = fakeSession([I('a', 'pending', { agent: 'g', prompt: 'analyse X' })]);
  let seen;
  await withSpawn(async (_p, call) => { seen = JSON.parse(call.arguments).prompt; return { ok: true, output: 'rep' }; }, () => runPlan(s, { arguments: '{}' }));
  assert.ok(seen.startsWith('analyse X'));
  assert.match(seen, /Do NOT create, modify or delete any file/);
});

const { readOnlyRequested } = require('../src/orchestra');
test('readOnlyRequested: son kullanıcı isteğindeki "dosya değiştirme" kısıtı yakalanır', () => {
  const msg = (c) => ({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: c }, { role: 'assistant', content: 'x' }] });
  assert.strictEqual(readOnlyRequested(msg('Projeyi incele. Dosyaları değiştirme.')), true);
  assert.strictEqual(readOnlyRequested(msg('Analyse it, do not modify any file')), true);
  assert.strictEqual(readOnlyRequested(msg('Run in read-only mode')), true);
  assert.strictEqual(readOnlyRequested(msg('Bir rapor dosyası yaz')), false);
  // sistem hatırlatması son kullanıcı isteği sayılmaz
  const s = { messages: [{ role: 'user', content: 'dosyaları değiştirme' }, { role: 'assistant', content: 'x' }, { role: 'user', content: '[system reminder] finish' }] };
  assert.strictEqual(readOnlyRequested(s), true);
});

test('run_plan: salt-okunur istekte ajanlara read_only verilir, aksi halde verilmez', async () => {
  const run = async (userText, input = '{}') => {
    const s = { ...fakeSession([I('a', 'pending', { agent: 'g', prompt: 'A' })]), messages: [{ role: 'user', content: userText }] };
    let args;
    await withSpawn(async (_p, call) => { args = JSON.parse(call.arguments); return { ok: true, output: 'r' }; }, () => runPlan(s, { arguments: input }));
    return args;
  };
  assert.strictEqual((await run('Dosyaları değiştirme')).read_only, true);
  assert.strictEqual((await run('Bir dosya yaz')).read_only, undefined);
  assert.strictEqual((await run('Bir dosya yaz', '{"read_only":true}')).read_only, true);
});

test('spawn read_only: alt ajanın araç kümesi yalnızca okuma araçlarına iner', async () => {
  const { READ_ONLY_TOOLS } = subagents;
  assert.ok(READ_ONLY_TOOLS.has('read_file'));
  assert.ok(!READ_ONLY_TOOLS.has('write_file') && !READ_ONLY_TOOLS.has('run_command') && !READ_ONLY_TOOLS.has('mcp'));
});
