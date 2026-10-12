'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

// Orca içinde çalışırken ORCA_AGENT_HOOK_ENDPOINT gerçek uç noktayı gösterir; test sahte sunucuya gitmeli
const REAL_ENDPOINT = process.env.ORCA_AGENT_HOOK_ENDPOINT;
delete process.env.ORCA_AGENT_HOOK_ENDPOINT;
test.after(() => { if (REAL_ENDPOINT !== undefined) process.env.ORCA_AGENT_HOOK_ENDPOINT = REAL_ENDPOINT; });

// Orca'nın hook uç noktasını taklit eden yerel sunucu: gönderilen olayları toplar
function listen() {
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { try { got.push(JSON.parse(b)); } catch { /* yok */ } res.end('ok'); });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, got, port: srv.address().port })));
}

test('plan(): sends open items only, marks in_progress as working, notes unmet dependencies, dedupes', async () => {
  const { srv, got, port } = await listen();
  const keep = { k: process.env.ORCA_PANE_KEY, p: process.env.ORCA_AGENT_HOOK_PORT, t: process.env.ORCA_AGENT_HOOK_TOKEN };
  process.env.ORCA_PANE_KEY = 'pane-test'; process.env.ORCA_AGENT_HOOK_PORT = String(port); process.env.ORCA_AGENT_HOOK_TOKEN = 'tok';
  try {
    const hooks = require('../src/orca-hooks');
    const list = [
      { id: 'a', content: 'scan repo', status: 'completed', agent: 'explore' },
      { id: 'b', content: 'write code', status: 'in_progress', agent: 'general', model: 'm1' },
      { id: 'c', content: 'write tests', status: 'pending', agent: 'general', depends_on: ['b'] },
      { id: 'd', content: 'own item', status: 'pending' },
    ];
    await hooks.plan(list);
    await hooks.plan(list); // aynı plan: gönderilmez
    list[1].status = 'completed';
    await hooks.plan(list);
    await hooks.plan([]);
    await hooks.flush();
    const plans = got.filter((x) => x.hook_event_name === 'Plan');
    assert.strictEqual(plans.length, 3, 'duplicate plan must not be re-sent');
    const p1 = plans[0].payload;
    assert.strictEqual(p1.total, 4);
    assert.strictEqual(p1.done, 1);
    assert.deepStrictEqual(p1.plan.map((x) => x.id), ['b', 'c', 'd']);
    assert.strictEqual(p1.plan[0].status, 'working');
    assert.strictEqual(p1.plan[0].n, 2);
    assert.strictEqual(p1.plan[0].model, 'm1');
    assert.deepStrictEqual(p1.plan[1].waits, ['b']);
    assert.strictEqual(p1.plan[2].status, 'idle');
    const p2 = plans[1].payload;
    assert.deepStrictEqual(p2.plan[0].waits, []); // b bitti: c artık bekleme yok
    assert.deepStrictEqual(plans[2].payload.plan, []);
  } finally {
    srv.close();
    for (const [k, v] of [['ORCA_PANE_KEY', keep.k], ['ORCA_AGENT_HOOK_PORT', keep.p], ['ORCA_AGENT_HOOK_TOKEN', keep.t]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('subagentStart carries the description', async () => {
  const { srv, got, port } = await listen();
  process.env.ORCA_PANE_KEY = 'pane-test2'; process.env.ORCA_AGENT_HOOK_PORT = String(port); process.env.ORCA_AGENT_HOOK_TOKEN = 'tok';
  try {
    const hooks = require('../src/orca-hooks');
    await hooks.subagentStart({ id: 'sa1', kind: 'explore', description: 'scan the repo' });
    await hooks.flush();
    const ev = got.find((x) => x.hook_event_name === 'SubagentStart');
    assert.ok(ev, 'event sent');
    assert.strictEqual(ev.payload.description, 'scan the repo');
    assert.strictEqual(ev.payload.agent_type, 'explore');
  } finally { srv.close(); delete process.env.ORCA_PANE_KEY; delete process.env.ORCA_AGENT_HOOK_PORT; delete process.env.ORCA_AGENT_HOOK_TOKEN; }
});
