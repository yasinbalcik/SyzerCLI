'use strict';

// Ajan ağacı: ana oturum + alt ajan düğümlerinin olay deposu ve saf (I/O'suz) çizicileri.
const { C, vlen, charWidth } = require('./ui');
const { t } = require('./i18n');

const LOG_MAX = 200;
const MARK = { queued: '…', running: '●', done: '✓', failed: '✖', stopped: '⚠', aborted: '◌' };

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
      if (u.model) n.model = u.model;
    },
    finish(id, o = {}) {
      const n = find(id);
      if (!n) return;
      n.status = o.outcome || (o.ok ? 'done' : 'failed');
      if (o.model) n.model = o.model;
      n.t1 = now();
    },
    abortActive() {
      for (const n of nodes) if (n.status === 'running' || n.status === 'queued') { n.status = 'aborted'; n.t1 = now(); }
    },
    count() { return nodes.length; },
    event(text, id, kind = 'info') {
      log.push({ t: now(), id, text: String(text), kind });
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
  if (st === 'running') return C.orange(s);
  if (st === 'done') return C.green(s);
  if (st === 'failed') return C.red(s);
  if (st === 'stopped') return C.yellow(s);
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
    const body = kindLabel(n) + (shortModel(n.model) ? ' · ' + shortModel(n.model) : '') + (act(n) ? ' ' + act(n) : n.label ? ' ' + n.label : '') +
      '  ' + stats(n, now);
    const line = (last ? '└ ' : '├ ') + statusColor(n.status, MARK[n.status]) + ' ' + fit(body, width - 4);
    out.push(i === selected ? C.bold(line) : line);
  });
  if (extra > 0) out.push(C.gray(fit('└ ' + t('tree_more', extra), width)));
  return out;
}

const ident = (s) => s;

// 6 satırlık yuvarlak kenarlı kart; her satır tam `width` görünür hücre.
function card(n, { width, selected = false, now = Date.now(), color = true } = {}) {
  const inner = Math.max(1, width - 4);
  const edge = color ? (selected ? C.orange : C.gray) : ident;
  const gray = color ? C.gray : ident;
  const row = (plain, paint) => {
    const cell = padTo(fit(plain, inner), inner);
    return edge('│ ') + (paint ? paint(cell) : cell) + edge(' │');
  };
  const head = MARK[n.status] + ' ' + kindLabel(n);
  return [
    edge('╭' + '─'.repeat(Math.max(0, width - 2)) + '╮'),
    row(head, color ? (s) => statusColor(n.status, s) : null),
    row(shortModel(n.model) || '-', gray),
    row(act(n) || n.label || '-'),
    row(stats(n, now), gray),
    edge('╰' + '─'.repeat(Math.max(0, width - 2)) + '╯'),
  ];
}

const cardRows = (rows) => (rows >= 36 ? 2 : 1);

function summary(snap, now = Date.now()) {
  const ns = snap.nodes;
  const cnt = (st) => ns.filter((n) => n.status === st).length;
  let secs = 0;
  if (ns.length) {
    const a = Math.min(...ns.map((n) => n.t0));
    const b = Math.max(...ns.map((n) => n.t1 || now));
    secs = Math.max(0, Math.round((b - a) / 1000));
  }
  return {
    agents: ns.length, done: cnt('done'), stopped: cnt('stopped'), failed: cnt('failed'),
    aborted: cnt('aborted'), tokens: ns.reduce((s, n) => s + (n.tokens || 0), 0), secs,
  };
}
const fmtSecs = (s) => (s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60) + 's' : s + 's');

function mainBox(text, width, color) {
  const edge = color ? C.orange : ident;
  const bold = color ? C.bold : ident;
  return [
    edge('╭' + '─'.repeat(Math.max(0, width - 2)) + '╮'),
    edge('│ ') + bold(padTo(fit(text, width - 4), width - 4)) + edge(' │'),
    edge('╰' + '─'.repeat(Math.max(0, width - 2)) + '╯'),
  ];
}

// Taşmada önce çalışan/bekleyen düğümler (başlama sırasıyla), kalan yere en yeni biten düğümler; sonuç özgün sırada.
function pickShown(nodes, max) {
  const all = nodes.map((_, i) => i);
  if (nodes.length <= max) return all;
  const live = (i) => nodes[i].status === 'running' || nodes[i].status === 'queued';
  const act = all.filter(live).slice(0, Math.max(0, max));
  const rest = Math.max(0, max - act.length);
  const fin = rest > 0 ? all.filter((i) => !live(i)).slice(-rest) : [];
  return act.concat(fin).sort((a, b) => a - b);
}

// Kartları en çok 3 sütunda dizer; `maxCards` kadarını gösterir.
function cardGrid(nodes, maxCards, { width, selected = -1, now, color = true }) {
  const idx = pickShown(nodes, maxCards);
  const vis = idx.map((i) => nodes[i]);
  const selPos = idx.indexOf(selected);
  const cols = Math.max(1, Math.min(3, vis.length));
  const cw = Math.floor((width - (cols - 1)) / cols);
  const lines = [];
  for (let r = 0; r < vis.length; r += cols) {
    const cs = vis.slice(r, r + cols).map((n, k) => card(n, { width: cw, selected: r + k === selPos, now, color }));
    for (let l = 0; l < 6; l++) lines.push(cs.map((c) => c[l]).join(' '));
  }
  return lines;
}

// Panel yerleşimi: renderPanel ve panelHeight aynı hesabı kullanır.
function panelLayout(n, rows) {
  const cols = Math.min(3, n);
  const avail = rows - 3;
  const want = Math.min(cardRows(rows), Math.floor(avail / 6));
  let k = Math.ceil(n / cols);
  let over = false;
  if (k > want) { over = true; k = Math.max(0, Math.min(cardRows(rows), Math.floor((avail - 1) / 6))); }
  const shown = Math.min(n, k * cols);
  const hidden = n - shown;
  const height = Math.min(3 + 6 * Math.ceil(shown / cols) + (over && hidden > 0 ? 1 : 0), Math.max(1, rows));
  return { shown, hidden, height };
}
function panelHeight(n, rows) { return n > 0 ? panelLayout(n, rows).height : 0; }

// Panel kartlarının ekran konumları (renderPanel ile aynı yerleşim): [{ id, row (panel içinde, 0 tabanlı), rows, c1, c2 }]
function panelHits(snap, { width, layoutRows } = {}) {
  if (!snap.nodes.length) return [];
  const L = panelLayout(snap.nodes.length, layoutRows);
  const idx = pickShown(snap.nodes, L.shown);
  const cols = Math.max(1, Math.min(3, idx.length));
  const cw = Math.floor((width - (cols - 1)) / cols);
  const base = mainBox('x', width, true).length;
  return idx.map((ni, k) => ({ id: snap.nodes[ni].id, row: base + Math.floor(k / cols) * 6, rows: 6, c1: (k % cols) * (cw + 1) + 1, c2: (k % cols) * (cw + 1) + cw }));
}

function renderPanel(snap, { width, rows, layoutRows = rows, selected = -1, now = Date.now() } = {}) {
  if (!snap.nodes.length) return [];
  const sm = summary(snap, now);
  const running = snap.nodes.filter((n) => n.status === 'running' || n.status === 'queued').length;
  const m = snap.main;
  const text = 'main' + (m.model ? ' · ' + shortModel(m.model) : '') + (m.effort ? ' · ' + m.effort : '') +
    ' · ' + t('rep_agents', sm.agents) + ' · ' + t('pn_running', running) + ' · ' + t('rep_done', sm.done) +
    (sm.stopped ? ' · ' + t('rep_stopped', sm.stopped) : '') + (sm.failed ? ' · ' + t('rep_failed', sm.failed) : '') +
    (sm.aborted ? ' · ' + t('rep_aborted', sm.aborted) : '') + ' · ' + fmtSecs(sm.secs);
  const lines = mainBox(text, width, true);
  const L = panelLayout(snap.nodes.length, layoutRows);
  lines.push(...cardGrid(snap.nodes, L.shown, { width, selected, now }));
  if (L.hidden > 0) lines.push(C.gray(fit(t('tree_more', L.hidden), width)));
  return lines.slice(0, Math.max(1, rows));
}

function renderReport(snap, { width, now = Date.now(), color = true } = {}) {
  if (!snap.nodes.length) return [];
  const g = color ? C.gray : ident;
  const sm = summary(snap, now);
  const lines = mainBox(mainText(snap), width, color);
  lines.push(...cardGrid(snap.nodes, 9, { width, now, color }));
  const hidden = snap.nodes.length - 9;
  if (hidden > 0) lines.push(g(fit(t('tree_more', hidden), width)));
  const parts = [t('rep_agents', sm.agents), t('rep_done', sm.done)];
  if (sm.stopped) parts.push(t('rep_stopped', sm.stopped));
  if (sm.failed) parts.push(t('rep_failed', sm.failed));
  if (sm.aborted) parts.push(t('rep_aborted', sm.aborted));
  parts.push(t('rep_tokens', fmtTok(sm.tokens)), fmtSecs(sm.secs));
  lines.push(fit(parts.join(' · '), width));
  const warns = snap.log.filter((e) => e.kind === 'warn').slice(-8);
  if (warns.length) {
    lines.push(g(fit('─ ' + t('rep_events'), width)));
    for (const e of warns) lines.push(g(fit(fmtClock(e.t) + ' ' + e.text, width)));
  }
  return lines;
}

// Rapor kartlarının konumu (renderReport çıktısına göre): [{ id, row (rapor içinde, 0 tabanlı), rows, c1, c2 }]
function reportHits(snap, { width } = {}) {
  if (!snap || !snap.nodes || !snap.nodes.length) return [];
  const idx = pickShown(snap.nodes, 9);
  const cols = Math.max(1, Math.min(3, idx.length));
  const cw = Math.floor((width - (cols - 1)) / cols);
  const base = mainBox('x', width, false).length;
  return idx.map((ni, k) => ({ id: snap.nodes[ni].id, row: base + Math.floor(k / cols) * 6, rows: 6, c1: (k % cols) * (cw + 1) + 1, c2: (k % cols) * (cw + 1) + cw }));
}

function reportLines(snap, { isTTY, columns } = {}) {
  if (!snap || !snap.nodes || !snap.nodes.length) return [];
  return isTTY
    ? renderReport(snap, { width: Math.max(40, (columns || 100) - 2), color: true })
    : renderReport(snap, { width: 80, color: false });
}

function renderTree(snap, { width, rows = 24, selected = -1, now = Date.now() } = {}) {
  const lines = [];
  if (!snap.nodes.length) {
    lines.push(C.orange(fit(mainText(snap), width)));
    lines.push(C.gray(fit(t('tree_none'), width)));
  } else if (width >= 70) {
    const mt = fit(mainText(snap), width - 4);
    lines.push(C.orange('╭' + '─'.repeat(Math.max(0, width - 2)) + '╮'));
    lines.push(C.orange('│ ') + C.bold(padTo(mt, width - 4)) + C.orange(' │'));
    lines.push(C.orange('╰' + '─'.repeat(Math.max(0, width - 2)) + '╯'));
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
        const boxes = visible.slice(r, r + cols).map((n, k) => card(n, { width: bw, selected: r + k === selected, now }));
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
  out.agentModel = (id, model) => store.update(id, { model: shortModel(model) });
  out.agentUpdate = (id, action, steps, tokens) => {
    call('agentUpdate', [id, action, steps, tokens]);
    store.update(id, { action, steps: steps == null ? undefined : steps, tokens: tokens == null ? undefined : tokens });
  };
  out.agentDone = (id, run) => {
    call('agentDone', [id, run]);
    const ok = !!(run && run.ok);
    const outcome = run && run.aborted ? 'aborted' : run && run.stopped ? 'stopped' : ok ? 'done' : 'failed';
    store.finish(id, { ok, outcome, model: shortModel(run && run.model) });
    if (outcome === 'done') store.event(t('tree_done'), id);
    else if (outcome === 'aborted') store.event(t('tree_aborted'), id);
    else if (outcome === 'stopped') store.event(t('tree_stopped'), id, 'warn');
    else {
      const first = String((run && run.report) || '').split('\n').filter(Boolean)[0] || '';
      store.event(t('tree_error') + (first.replace(/^failed:\s*/i, '') || t('tree_error_unknown')), id, 'warn');
    }
  };
  out.warn = (msg) => {
    call('warn', [msg]);
    store.event(String(msg), undefined, 'warn');
  };
  return out;
}

module.exports = {
  panelHits, reportHits,
  createStore, renderTree, renderCompact, trackOut, card, renderPanel, renderReport, reportLines, summary, cardRows, panelHeight,
};
