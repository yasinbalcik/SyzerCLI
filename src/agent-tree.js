'use strict';

// Ajan ağacı: ana oturum + alt ajan düğümlerinin olay deposu ve saf (I/O'suz) çizicileri.
const { C, vlen, charWidth } = require('./ui');
const { t } = require('./i18n');

const LOG_MAX = 200;
const MARK = { queued: '…', running: '●', done: '✓', failed: '✖' };

// Düz metni görünür genişliğe göre keser (CJK 2 hücre); sığmazsa sonuna … koyar.
function fit(s, n) {
  s = String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  if (n <= 0) return '';
  if (vlen(s) <= n) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}
const padTo = (s, n) => s + ' '.repeat(Math.max(0, n - vlen(s)));
const shortModel = (m) => String(m || '').split('/').pop().replace(':free', '');

function createStore(now = Date.now) {
  let main = { model: '', effort: '' };
  let nodes = [];
  let log = [];
  const find = (id) => nodes.find((n) => n.id === id);
  return {
    setMain(m) { main = { model: (m && m.model) || '', effort: (m && m.effort) || '' }; },
    newTurn() { nodes = []; },
    start(id, o = {}) {
      nodes.push({
        id, kind: o.kind || '', label: o.label || '', orca: !!o.orca, status: 'queued',
        action: '', steps: 0, tokens: 0, model: '', t0: now(), t1: 0,
      });
    },
    run(id) { const n = find(id); if (n) { n.status = 'running'; n.t0 = now(); } },
    update(id, u = {}) {
      const n = find(id);
      if (!n) return;
      if (u.action !== undefined) n.action = String(u.action);
      if (u.steps !== undefined) n.steps = u.steps;
      if (u.tokens !== undefined) n.tokens = u.tokens;
    },
    finish(id, o = {}) {
      const n = find(id);
      if (!n) return;
      n.status = o.ok ? 'done' : 'failed';
      if (o.model) n.model = o.model;
      n.t1 = now();
    },
    event(text, id) {
      log.push({ t: now(), id, text: String(text) });
      if (log.length > LOG_MAX) log = log.slice(log.length - LOG_MAX);
    },
    snapshot() {
      return {
        main: { ...main },
        nodes: nodes.map((n) => ({ ...n })),
        log: log.map((e) => ({ ...e })),
      };
    },
  };
}

function statusColor(st, s) {
  if (st === 'running') return C.cyan(s);
  if (st === 'done') return C.green(s);
  if (st === 'failed') return C.red(s);
  return C.gray(s);
}
const kindLabel = (n) => (n.orca ? n.kind + ' · Orca' : n.kind);
const fmtTok = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
function fmtDur(n, now) {
  const end = n.t1 || now;
  const s = Math.max(0, Math.round((end - n.t0) / 1000));
  return s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60) + 's' : s + 's';
}
const act = (n) => (n.action && n.action !== '…' ? n.action : '');
const stats = (n, now) => `${n.steps} ${t('lbl_steps')} · ${fmtTok(n.tokens)} · ${fmtDur(n, now)}`;
function fmtClock(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function mainText(snap) {
  const m = snap.main;
  return 'main' + (m.model ? ' · ' + shortModel(m.model) : '') + (m.effort ? ' · ' + m.effort : '');
}

function renderCompact(snap, { width, selected = -1, now = Date.now(), max = 6, more = false } = {}) {
  const out = [C.orange(fit(mainText(snap), width))];
  const shown = snap.nodes.slice(0, max);
  const extra = snap.nodes.length - shown.length;
  shown.forEach((n, i) => {
    const last = i === shown.length - 1 && extra <= 0 && !more;
    const body = kindLabel(n) + (act(n) ? ' ' + act(n) : n.label ? ' ' + n.label : '') +
      '  ' + stats(n, now);
    const line = (last ? '└ ' : '├ ') + statusColor(n.status, MARK[n.status]) + ' ' + fit(body, width - 4);
    out.push(i === selected ? C.bold(line) : line);
  });
  if (extra > 0) out.push(C.gray(fit('└ ' + t('tree_more', extra), width)));
  return out;
}

function boxLines(n, w, now, sel) {
  const inner = w - 4;
  const edge = sel ? C.orange : C.gray;
  const row = (plain, color) => {
    const cell = padTo(fit(plain, inner), inner);
    return edge('│ ') + (color ? color(cell) : cell) + edge(' │');
  };
  const head = MARK[n.status] + ' ' + kindLabel(n);
  return [
    edge('┌' + '─'.repeat(w - 2) + '┐'),
    row(head, (s) => statusColor(n.status, s)),
    row(shortModel(n.model) || '-', C.gray),
    row(act(n) || n.label || '-'),
    row(stats(n, now), C.gray),
    edge('└' + '─'.repeat(w - 2) + '┘'),
  ];
}

function renderTree(snap, { width, rows = 24, selected = -1, now = Date.now() } = {}) {
  const lines = [];
  if (!snap.nodes.length) {
    lines.push(C.orange(fit(mainText(snap), width)));
    lines.push(C.gray(fit(t('tree_none'), width)));
  } else if (width >= 70) {
    const mt = fit(mainText(snap), width - 4);
    lines.push(C.orange('┌' + '─'.repeat(width - 2) + '┐'));
    lines.push(C.orange('│ ') + C.bold(padTo(mt, width - 4)) + C.orange(' │'));
    lines.push(C.orange('└' + '─'.repeat(width - 2) + '┘'));
  } else {
    lines.push(C.orange(fit(mainText(snap), width)));
  }
  if (snap.nodes.length) {
    const logWant = Math.min(snap.log.length, 3);
    const budget = Math.max(0, rows - lines.length - (snap.log.length ? 1 + logWant : 0));
    if (width >= 70) {
      const cols = Math.min(3, snap.nodes.length);
      const bw = Math.floor((width - 2) / cols) - 1;
      const perRow = Math.max(1, Math.floor(budget / 6));
      const fitCount = perRow * cols;
      const visible = fitCount >= snap.nodes.length ? snap.nodes : snap.nodes.slice(0, fitCount);
      for (let r = 0; r < visible.length; r += cols) {
        const boxes = visible.slice(r, r + cols).map((n, k) => boxLines(n, bw, now, r + k === selected));
        for (let l = 0; l < 6; l++) lines.push(boxes.map((b) => b[l] + ' ').join('').replace(/ +$/, ''));
      }
      const hidden = snap.nodes.length - visible.length;
      if (hidden > 0) lines.push(C.gray(fit(t('tree_more', hidden), width)));
    } else {
      const cap = Math.max(1, budget);
      const vis = cap >= snap.nodes.length ? snap.nodes : snap.nodes.slice(0, Math.max(1, cap - 1));
      const hidden = snap.nodes.length - vis.length;
      const comp = renderCompact({ main: snap.main, nodes: vis, log: [] },
        { width, selected, now, max: vis.length, more: hidden > 0 });
      lines.push(...comp.slice(1));
      if (hidden > 0) lines.push(C.gray(fit('└ ' + t('tree_more', hidden), width)));
    }
  }
  // Günlük: kalan satırlara sığan son kayıtlar
  const left = rows - lines.length - 1;
  if (snap.log.length && left > 0) {
    lines.push(C.gray(fit('─ ' + t('tree_log'), width)));
    const kinds = new Map(snap.nodes.map((n) => [n.id, n.kind]));
    for (const e of snap.log.slice(-left)) {
      const k = e.id !== undefined && kinds.has(e.id) ? kinds.get(e.id) + ' ' : '';
      lines.push(C.gray(fit(fmtClock(e.t) + ' ' + k + e.text, width)));
    }
  }
  return lines.slice(0, Math.max(1, rows));
}

// Mevcut makeOut() olaylarını (agentStart/Update/Done, warn) depoya yansıtır; orijinalleri önce çağırır.
function trackOut(out, store) {
  const orig = {
    agentStart: out.agentStart, agentUpdate: out.agentUpdate,
    agentDone: out.agentDone, warn: out.warn,
  };
  const call = (k, args) => (orig[k] ? orig[k].apply(out, args) : undefined);
  out.agentStart = (id, label) => {
    call('agentStart', [id, label]);
    const text = String(label || '');
    const ix = text.indexOf(':');
    const kind = ix >= 0 ? text.slice(0, ix).trim() : text.trim();
    const name = ix >= 0 ? text.slice(ix + 1).trim() : '';
    store.start(id, { kind, label: name, orca: typeof id === 'string' && id[0] === 'w' });
    store.event(t('tree_started'), id);
  };
  out.agentRun = (id) => store.run(id);
  out.agentUpdate = (id, action, steps, tokens) => {
    call('agentUpdate', [id, action, steps, tokens]);
    store.update(id, { action, steps: steps == null ? undefined : steps, tokens: tokens == null ? undefined : tokens });
  };
  out.agentDone = (id, run) => {
    call('agentDone', [id, run]);
    const ok = !!(run && run.ok);
    store.finish(id, { ok, model: shortModel(run && run.model) });
    if (ok) store.event(t('tree_done'), id);
    else {
      const first = String((run && run.report) || '').split('\n').filter(Boolean)[0] || '';
      store.event(t('tree_error') + (first.replace(/^failed:\s*/i, '') || t('tree_aborted')), id);
    }
  };
  out.warn = (msg) => {
    call('warn', [msg]);
    store.event(String(msg));
  };
  return out;
}

module.exports = { createStore, renderTree, renderCompact, trackOut };
