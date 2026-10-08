'use strict';

const { C, useColor, vlen } = require('./ui');

const split = (s) => {
  if (s === '') return [];
  const l = s.split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l;
};

// Satır bazlı diff. Dönüş: [{ t: ' ' | '-' | '+', a, b, text }]  (a: eski satır no, b: yeni satır no)
function diffLines(oldText, newText) {
  const A = split(oldText);
  const B = split(newText);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length;
  let eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }

  const ops = [];
  for (let i = 0; i < s; i++) ops.push({ t: ' ', a: i + 1, b: i + 1, text: A[i] });

  const mA = A.slice(s, ea);
  const mB = B.slice(s, eb);
  let ai = s + 1;
  let bi = s + 1;
  const del = (x) => ops.push({ t: '-', a: ai++, b: null, text: x });
  const add = (x) => ops.push({ t: '+', a: null, b: bi++, text: x });

  if (mA.length * mB.length > 4_000_000) {
    mA.forEach(del);
    mB.forEach(add);
  } else {
    const n = mA.length;
    const m = mB.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = mA[i] === mB[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (mA[i] === mB[j]) { ops.push({ t: ' ', a: ai++, b: bi++, text: mA[i] }); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) del(mA[i++]);
      else add(mB[j++]);
    }
    while (i < n) del(mA[i++]);
    while (j < m) add(mB[j++]);
  }

  for (let k = 0; ea + k < A.length; k++) ops.push({ t: ' ', a: ea + k + 1, b: eb + k + 1, text: A[ea + k] });
  return ops;
}

const countOps = (ops) => ({
  added: ops.filter((o) => o.t === '+').length,
  removed: ops.filter((o) => o.t === '-').length,
});

const BG = { '-': '\x1b[48;5;52m', '+': '\x1b[48;5;22m' };

// Claude tarzı: satır numarası + işaret, silinen kırmızı / eklenen yeşil zemin.
function renderDiff(ops, { context = 3, maxRows = 40, indent = 4 } = {}) {
  const changed = [];
  ops.forEach((o, i) => { if (o.t !== ' ') changed.push(i); });
  if (!changed.length) return '';

  const keep = new Set();
  for (const i of changed) for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep.add(k);

  const maxNo = Math.max(...ops.map((o) => o.b || o.a || 0));
  const nw = String(maxNo).length;
  const cols = process.stdout.columns || 100;
  const width = Math.max(30, Math.min(cols - indent - 2, 110));
  const pad = ' '.repeat(indent);

  const rows = [];
  let prev = -1;
  for (const i of [...keep].sort((x, y) => x - y)) {
    if (prev >= 0 && i > prev + 1) rows.push({ sep: true });
    rows.push(ops[i]);
    prev = i;
  }

  const out = [];
  let shown = 0;
  for (const r of rows) {
    if (shown >= maxRows) { out.push(pad + C.gray(`… +${rows.length - shown}`)); break; }
    shown++;
    if (r.sep) { out.push(pad + C.gray(' '.repeat(nw) + ' ⋯')); continue; }
    const no = String(r.t === '-' ? r.a : r.b).padStart(nw);
    const body = r.text.replace(/\t/g, '  ');
    const sign = r.t === ' ' ? ' ' : r.t;
    let line = `${no} ${sign} ${body}`;
    if (vlen(line) > width) line = [...line].slice(0, width - 1).join('') + '…';
    if (!useColor) { out.push(pad + line); continue; }
    if (r.t === ' ') out.push(pad + C.gray(line));
    else out.push(pad + BG[r.t] + line + ' '.repeat(Math.max(0, width - vlen(line))) + '\x1b[0m');
  }
  return out.join('\n');
}

module.exports = { diffLines, countOps, renderDiff };
