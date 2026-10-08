'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { vlen, strip } = require('../src/ui');
const { setLang } = require('../src/i18n');
const { createStore, renderTree, renderCompact, trackOut } = require('../src/agent-tree');

setLang('en');

function mk(n, extra) {
  const s = createStore(() => 1000);
  s.setMain({ model: 'a/main-model', effort: 'high' });
  for (let i = 1; i <= n; i++) {
    s.start(i, Object.assign({ kind: 'explore', label: 'task ' + i }, extra));
    s.run(i);
  }
  return s;
}
const all = (lines) => strip(lines.join('\n'));

test('store lifecycle', () => {
  const s = createStore(() => 5000);
  s.start(1, { kind: 'k', label: 'l' });
  assert.equal(s.snapshot().nodes[0].status, 'queued');
  s.run(1);
  assert.equal(s.snapshot().nodes[0].status, 'running');
  s.update(1, { action: 'read', steps: 3, tokens: 99 });
  const n = s.snapshot().nodes[0];
  assert.equal(n.action, 'read'); assert.equal(n.steps, 3); assert.equal(n.tokens, 99);
  s.finish(1, { ok: true, model: 'm' });
  assert.equal(s.snapshot().nodes[0].status, 'done');
  assert.equal(s.snapshot().nodes[0].t1, 5000);
  s.start(2, { kind: 'k', label: 'l' });
  s.finish(2, { ok: false });
  assert.equal(s.snapshot().nodes[1].status, 'failed');
});

test('newTurn clears nodes but keeps log', () => {
  const s = mk(2);
  s.event('hello', 1);
  s.newTurn();
  assert.equal(s.snapshot().nodes.length, 0);
  assert.equal(s.snapshot().log.length, 1);
});

test('log is capped at 200', () => {
  const s = createStore();
  for (let i = 0; i < 250; i++) s.event('e' + i);
  const log = s.snapshot().log;
  assert.equal(log.length, 200);
  assert.equal(log[199].text, 'e249');
});

test('renderCompact marks statuses', () => {
  const s = createStore(() => 1000);
  s.setMain({ model: 'm', effort: 'low' });
  for (let i = 1; i <= 4; i++) s.start(i, { kind: 'k' + i, label: 'x' });
  s.run(2); s.run(3); s.finish(3, { ok: true }); s.run(4); s.finish(4, { ok: false });
  const out = renderCompact(s.snapshot(), { width: 80, now: 1000 });
  const t = out.map(strip);
  assert.ok(t[0].includes('main'));
  assert.ok(t[1].includes('…') && t[1].includes('├'));
  assert.ok(t[2].includes('●'));
  assert.ok(t[3].includes('✓'));
  assert.ok(t[4].includes('✖') && t[4].includes('└'));
  const big = renderCompact(mk(8).snapshot(), { width: 80, now: 1000 }).map(strip);
  assert.equal(big.length, 1 + 6 + 1);
  assert.ok(big[big.length - 1].includes('+2'));
});

test('renderTree wide', () => {
  const s = mk(5);
  s.update(1, { action: 'grep foo' });
  const out = renderTree(s.snapshot(), { width: 100, rows: 40, now: 3000 });
  assert.ok(all(out).includes('╭'));
  assert.ok(!all(out).includes('┌'));
  assert.ok(out.every((l) => vlen(l) <= 100));
  const txt = all(out);
  assert.ok(txt.includes('explore'));
  assert.ok(txt.includes('main-model'));
});

test('renderTree narrow', () => {
  const out = renderTree(mk(4).snapshot(), { width: 36, rows: 30, now: 3000 });
  assert.ok(!all(out).includes('╭'));
  assert.ok(out.every((l) => vlen(l) <= 36));
});

test('renderTree empty', () => {
  const s = createStore();
  const out = renderTree(s.snapshot(), { width: 80, rows: 20, now: 1 });
  assert.ok(all(out).includes('no subagents yet'));
});

test('renderTree long label', () => {
  for (const label of ['x'.repeat(200), '日本語'.repeat(40)]) {
    const s = createStore(() => 1000);
    s.setMain({ model: 'm', effort: 'e' });
    s.start(1, { kind: 'k', label }); s.run(1);
    s.update(1, { action: label });
    s.event(label, 1);
    for (const width of [36, 60, 100]) {
      const out = renderTree(s.snapshot(), { width, rows: 30, now: 2000 });
      assert.ok(out.every((l) => vlen(l) <= width), 'width ' + width);
      const c = renderCompact(s.snapshot(), { width, now: 2000 });
      assert.ok(c.every((l) => vlen(l) <= width));
    }
  }
});

test('renderTree log tail', () => {
  const s = mk(10);
  for (let i = 0; i < 30; i++) s.event('ev' + i, 1);
  const out = renderTree(s.snapshot(), { width: 100, rows: 20, now: 2000 });
  assert.ok(out.length <= 20);
  const txt = all(out);
  assert.ok(txt.includes('ev29'));
  assert.ok(!/\bev0\b/.test(txt) && !/\bev1\b/.test(txt));
  assert.ok(/\bev27\b/.test(txt) && /\bev28\b/.test(txt) && /\bev29\b/.test(txt));
});

test('orca node label', () => {
  const s = mk(1, { orca: true });
  assert.ok(all(renderTree(s.snapshot(), { width: 100, rows: 20, now: 2000 })).includes('Orca'));
  assert.ok(all(renderTree(s.snapshot(), { width: 40, rows: 20, now: 2000 })).includes('Orca'));
});

test('fit strips control chars and ANSI from untrusted text', () => {
  const s = mk(1);
  s.update(1, { action: 'a\x1b[31mred\x07bell\x1b]0;t\x07z' });
  s.event('ev\x1b[2Jx\x07y', 1);
  for (const width of [36, 100]) {
    const out = renderTree(s.snapshot(), { width, rows: 30, now: 2000 });
    const raw = out.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(raw), 'raw control char leaked');
  }
});

test('narrow overflow: last shown node uses branch, more line closes', () => {
  const s = mk(10);
  const out = renderTree(s.snapshot(), { width: 40, rows: 6, now: 2000 }).map((l) => strip(l));
  const more = out.findIndex((l) => l.startsWith('└'));
  assert.ok(more > 0);
  assert.ok(out[more - 1].startsWith('├'));
  assert.equal(out.filter((l) => l.startsWith('└')).length, 1);
});

function fakeOut() {
  const calls = [];
  const o = {};
  for (const k of ['agentStart', 'agentUpdate', 'agentDone', 'warn']) o[k] = (...a) => calls.push([k, ...a]);
  return { o, calls };
}
const snapOf = (st) => st.snapshot();

test('trackOut feeds start/update/done', () => {
  const st = createStore(); const { o } = fakeOut(); trackOut(o, st);
  o.agentStart(1, 'explorer: x');
  assert.deepEqual(snapOf(st).nodes.map((n) => [n.kind, n.label, n.status]), [['explorer', 'x', 'queued']]);
  o.agentRun(1);
  assert.equal(snapOf(st).nodes[0].status, 'running');
  o.agentUpdate(1, 'Read(a)', 2, 100);
  const n = snapOf(st).nodes[0];
  assert.equal(n.steps, 2); assert.equal(n.tokens, 100); assert.equal(n.action, 'Read(a)');
  o.agentDone(1, { ok: true, model: 'm/x:free' });
  const d = snapOf(st).nodes[0];
  assert.equal(d.status, 'done'); assert.equal(d.model, 'x');
});

test('trackOut failed run', () => {
  const st = createStore(); const { o } = fakeOut(); trackOut(o, st);
  o.agentStart(2, 'general: y');
  o.agentDone(2, { ok: false, report: 'failed: boom\nmore' });
  const sn = snapOf(st);
  assert.equal(sn.nodes[0].status, 'failed');
  assert.ok(sn.log.some((e) => e.text.includes('boom') && !e.text.includes('more')));
});

test('trackOut warn goes to log', () => {
  const st = createStore(); const { o } = fakeOut(); trackOut(o, st);
  o.warn('switching key');
  assert.ok(snapOf(st).log.some((e) => e.text.includes('switching key')));
});

test('trackOut orca id', () => {
  const st = createStore(); const { o } = fakeOut(); trackOut(o, st);
  o.agentStart('wab12', 'worker: Syzer: t');
  o.agentStart(3, 'worker: t');
  const ns = snapOf(st).nodes;
  assert.equal(ns[0].orca, true); assert.equal(ns[1].orca, false);
});

test('trackOut calls wrapped originals', () => {
  const st = createStore(); const { o, calls } = fakeOut(); trackOut(o, st);
  o.agentStart(1, 'a: b'); o.agentUpdate(1, 'x', 1, 5); o.agentDone(1, { ok: true }); o.warn('w');
  assert.deepEqual(calls.map((c) => c[0]), ['agentStart', 'agentUpdate', 'agentDone', 'warn']);
});

test('trackOut orca worker id goes queued -> running with orca flag', () => {
  const st = createStore(); const { o } = fakeOut(); trackOut(o, st);
  o.agentStart('wdeadbeef', 'worker: Syzer: t');
  assert.equal(snapOf(st).nodes[0].status, 'queued');
  o.agentRun('wdeadbeef');
  const n = snapOf(st).nodes[0];
  assert.equal(n.status, 'running'); assert.equal(n.orca, true);
});

test('tree i18n: en/tr keys exist, differ, de falls back to en', () => {
  const keys = ['tree_none', 'tree_log', 'tree_more', 'tree_hint'];
  const { t } = require('../src/i18n');
  const got = {};
  try {
    for (const l of ['en', 'tr']) {
      setLang(l); got[l] = {};
      for (const k of keys) {
        const v = t(k);
        assert.ok(typeof v === 'string' && v.length > 0 && v !== k, l + ':' + k);
        got[l][k] = v;
      }
      assert.ok(t('tree_more', 3).includes('3'), l + ' tree_more');
    }
    for (const k of keys) assert.notEqual(got.tr[k], got.en[k], 'tr differs: ' + k);
    setLang('de');
    for (const k of keys) assert.equal(t(k), got.en[k], 'de falls back: ' + k);
  } finally { setLang('en'); }
});

test('thinking marker does not hide the label; aborted run logs localized text', () => {
  setLang('en');
  const st = createStore(); const { o } = fakeOut(); trackOut(o, st);
  o.agentStart(1, 'explorer: mytask'); o.agentRun(1); o.agentUpdate(1, '…', 1, 5);
  const txt = strip(renderTree(st.snapshot(), { width: 100, rows: 20 }).join('\n'));
  assert.match(txt, /mytask/);
  assert.match(strip(renderCompact(st.snapshot(), { width: 100 }).join('\n')), /mytask/);
  assert.match(txt, /1 steps/);
  o.agentDone(1, { ok: false, report: '' });
  assert.ok(st.snapshot().log.some((e) => /error: unknown error/.test(e.text)));
  assert.ok(st.snapshot().log.some((e) => e.text === 'started'));
  setLang('tr');
  try {
    const st2 = createStore(); const f = fakeOut(); trackOut(f.o, st2);
    f.o.agentStart(1, 'explorer: x'); f.o.agentDone(1, { ok: true });
    assert.ok(st2.snapshot().log.some((e) => e.text === 'başladı'));
    assert.ok(st2.snapshot().log.some((e) => e.text === 'bitti'));
  } finally { setLang('en'); }
});

test('finish outcome stopped', () => {
  const s = mk(3);
  s.finish(1, { ok: true, outcome: 'stopped' }); s.finish(2, { ok: true }); s.finish(3, { ok: false });
  const n = s.snapshot().nodes;
  assert.equal(n[0].status, 'stopped'); assert.equal(n[1].status, 'done'); assert.equal(n[2].status, 'failed');
});

test('event kind', () => {
  const s = mk(1);
  s.event('x', 1, 'warn'); s.event('y', 1);
  const l = s.snapshot().log;
  assert.equal(l[0].kind, 'warn'); assert.equal(l[1].kind, 'info');
});

test('trackOut maps run flags', () => {
  const st = createStore(); const f = fakeOut(); trackOut(f.o, st);
  for (let i = 1; i <= 4; i++) f.o.agentStart(i, 'explorer: x');
  f.o.agentDone(1, { ok: true, stopped: true });
  f.o.agentDone(2, { ok: false, aborted: true });
  f.o.agentDone(3, { ok: false, report: 'failed: boom' });
  f.o.agentDone(4, { ok: true });
  const sn = st.snapshot();
  assert.deepEqual(sn.nodes.map((n) => n.status), ['stopped', 'aborted', 'failed', 'done']);
  assert.ok(sn.log.some((e) => e.id === 1 && e.kind === 'warn' && e.text === 'stopped: step limit reached'));
  assert.ok(sn.log.some((e) => e.id === 2 && e.text === 'aborted'));
  assert.ok(sn.log.some((e) => e.id === 3 && e.kind === 'warn'));
});

test('trackOut warn kind', () => {
  const st = createStore(); const f = fakeOut(); trackOut(f.o, st);
  f.o.warn('x');
  assert.equal(st.snapshot().log[0].kind, 'warn');
});

test('renderCompact stopped mark', () => {
  const s = mk(2);
  s.finish(1, { ok: true, outcome: 'stopped' }); s.finish(2, { ok: false, outcome: 'aborted' });
  const l = renderCompact(s.snapshot(), { width: 80, now: 1000 }).map(strip);
  assert.ok(l[1].includes('⚠')); assert.ok(l[2].includes('◌'));
});

test('subagent run.stopped on max_iter warn', () => {
  const { makeSub } = require('../src/subagents');
  const { t } = require('../src/i18n');
  const warns = [];
  const parent = { cfg: {}, ctx: { agents: [], header: '', files: [] }, out: { warn: (m) => warns.push(m) }, model: 'm' };
  const run = { steps: [], chars: 0, live: '' };
  const sub = makeSub(parent, { name: 'a', tools: [] }, 'a: x', 1, run);
  sub.out.warn('other');
  assert.ok(!run.stopped);
  sub.out.warn(t('max_iter'));
  assert.equal(run.stopped, true);
  assert.equal(warns.length, 2);
});

// ---- Task 2: card / panel / summary / report ----
const { card, renderPanel, renderReport, summary, cardRows } = require('../src/agent-tree');
const nodeOf = (o) => Object.assign({ id: 1, kind: 'explore', label: 'lbl', orca: false, status: 'running', action: 'reading', steps: 3, tokens: 1500, model: 'x/some-model:free', t0: 1000, t1: 0 }, o);

test('card layout', () => {
  setLang('en');
  const c = card(nodeOf({}), { width: 30, now: 5000 });
  assert.equal(c.length, 6);
  for (const l of c) assert.equal(vlen(l), 30);
  const p = strip(c.join('\n'));
  assert.ok(strip(c[0]).startsWith('╭') && strip(c[5]).startsWith('╰'));
  assert.match(p, /explore/); assert.match(p, /some-model/); assert.match(p, /reading/); assert.match(p, /3 steps/);
  assert.match(strip(card(nodeOf({ model: '' }), { width: 30, now: 5000 })[2]), /│ - /);
  for (const label of ['x'.repeat(200), '日本語'.repeat(40), 'a\x1b[31mb\x07c\x1b]0;t\x07']) {
    const cc = card(nodeOf({ action: '', label }), { width: 30, now: 5000 });
    for (const l of cc) assert.equal(vlen(l), 30);
    assert.ok(!/\x07/.test(strip(cc.join(''))));
    assert.ok(!/\x1b\]/.test(cc.join('')));
  }
});

test('cardRows', () => {
  assert.equal(cardRows(35), 1); assert.equal(cardRows(36), 2); assert.equal(cardRows(28), 1);
});

test('summary counts', () => {
  const s = createStore(() => 1000); s.setMain({});
  for (let i = 1; i <= 5; i++) { s.start(i, { kind: 'k' }); s.run(i); }
  s.update(1, { tokens: 1500 }); s.update(2, { tokens: 300 });
  s.finish(1, { ok: true }); s.finish(2, { ok: true }); s.finish(3, { outcome: 'stopped' });
  s.finish(4, { outcome: 'failed' });
  const sm = summary(s.snapshot(), 8000);
  assert.equal(sm.agents, 5); assert.equal(sm.done, 2); assert.equal(sm.stopped, 1);
  assert.equal(sm.failed, 1); assert.equal(sm.aborted, 0); assert.equal(sm.tokens, 1800);
  assert.equal(sm.secs, 7);
  assert.equal(summary(createStore().snapshot()).agents, 0);
});

test('renderPanel sizes', () => {
  for (const width of [70, 100]) for (const n of [1, 3, 7]) for (const rows of [28, 36]) {
    const out = renderPanel(mk(n).snapshot(), { width, rows, now: 5000 });
    assert.ok(out.length <= rows, `${n}/${width}/${rows}`);
    for (const l of out) assert.ok(vlen(l) <= width);
  }
  const t28 = strip(renderPanel(mk(7).snapshot(), { width: 100, rows: 28, now: 5000 }).join('\n'));
  assert.equal((t28.match(/╭/g) || []).length, 3 + 1); // main box + 3 cards
  assert.match(t28, /\+4/);
  const t36 = strip(renderPanel(mk(7).snapshot(), { width: 100, rows: 36, now: 5000 }).join('\n'));
  assert.equal((t36.match(/╭/g) || []).length, 6 + 1);
  assert.match(t36, /\+1/);
  assert.deepEqual(renderPanel(mk(0).snapshot(), { width: 100, rows: 28 }), []);
});

test('renderPanel header', () => {
  const s = mk(3); s.finish(1, { ok: true });
  const out = strip(renderPanel(s.snapshot(), { width: 100, rows: 28, now: 5000 })[1]);
  assert.match(out, /main/); assert.match(out, /main-model/); assert.match(out, /2 running/); assert.match(out, /1 done/);
});

test('renderReport', () => {
  const s = mk(3);
  s.finish(1, { ok: true }); s.finish(2, { ok: true }); s.finish(3, { outcome: 'stopped' });
  s.update(1, { tokens: 24200 });
  s.event('just info', 1); s.event('bad thing', 3, 'warn');
  const out = renderReport(s.snapshot(), { width: 100, now: 108000 });
  const txt = strip(out.join('\n'));
  assert.match(txt, /2 done · 1 stopped/);
  assert.match(txt, /notable events/);
  assert.match(txt, /\d\d:\d\d:\d\d bad thing/);
  assert.ok(!/just info/.test(txt));
  for (const l of out) assert.ok(vlen(l) <= 100);
  const big = strip(renderReport(mk(12).snapshot(), { width: 100, now: 5000 }).join('\n'));
  assert.equal((big.match(/╭/g) || []).length, 9 + 1); assert.match(big, /\+3/);
  assert.ok(!/\x1b/.test(renderReport(s.snapshot(), { width: 100, now: 5000, color: false }).join('\n')));
  assert.deepEqual(renderReport(mk(0).snapshot(), { width: 100 }), []);
});

test('renderCompact model', () => {
  const s = createStore(() => 1000); s.start(1, { kind: 'explore' }); s.run(1);
  s.finish(1, { outcome: 'stopped', model: 'some-model' });
  const txt = strip(renderCompact(s.snapshot(), { width: 100, now: 2000 }).join('\n'));
  assert.match(txt, /some-model/); assert.match(txt, /⚠/);
});
