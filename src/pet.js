'use strict';

// Syzer'in maskotu "Zip": turuncu bir tilki yavrusu. Kuyruğu logodaki gibi köşeli bir Z/S zikzağı.
// Piksel sanatı yarım bloklarla (▀▄█) çizilir: hücre başına 2 dikey piksel → 14x6 hücrede 14x12 piksel.
// Animasyon (saf, t saniye):
//   boşta  : ara ara göz kırpar, kulağını oynatır, kuyruğunu sallar, yanındaki yazıya bakar
//   meşgul : (ajan çalışırken) zıplar, kuyruğu hızlı sallanır, gözleri sağa sola gider

const W = 14;
const H = 12;

// . boş · O turuncu · D koyu turuncu · W krem · K siyah (göz/burun)
const BASE = [
  'O........O....',
  'OO......OO....',
  'ODOOOOOODO....',
  'OOKOOOOKOO....',
  'WWWOOOOWWW....',
  '.WWWKKWWW.....',
  '..WWWWWW......',
  '..OWWWWO..OOWW',
  '.OOWWWWOO..OO.',
  '.OOOOOOOO.OO..',
  '.DD.DD.DDOOO..',
];

const PAL = {
  O: [255, 138, 31],
  D: [180, 70, 12],
  W: [255, 233, 207],
  K: [27, 27, 27],
};

const set = (rows, r, x, ch) => { if (rows[r]) rows[r] = rows[r].slice(0, x) + ch + rows[r].slice(x + 1); };

// t anındaki kare: 12 satırlık piksel ızgarası
function pixels(t = 0, { busy = false } = {}) {
  const rows = BASE.slice();
  // göz kırpma (her ~4 sn'de kısa)
  const blink = (t % 4) < 0.14 || (busy && (t % 2.6) < 0.1);
  // bakış: boşta ara sıra sağa (yazıya), meşgulken sağa-sola
  let look = 0;
  if (busy) look = Math.floor(t * 1.5) % 2 ? 1 : -1;
  else if ((t % 10) > 5 && (t % 10) < 6.6) look = 1;
  for (const ex of [2, 7]) {
    set(rows, 3, ex, 'O');
    if (blink) set(rows, 3, ex, 'D');
    else set(rows, 3, Math.max(0, Math.min(9, ex + look)), 'K');
  }
  // kulak oynatma
  if (!busy && (t % 7) > 3 && (t % 7) < 3.3) { set(rows, 0, 0, '.'); set(rows, 1, 0, '.'); set(rows, 0, 1, 'O'); }
  // kuyruk sallama: ucu yukarı kıvrılır
  const wag = busy ? Math.floor(t * 6) % 2 : ((t % 6) < 2 && Math.floor(t * 3) % 2);
  if (wag) {
    rows[6] = rows[6].slice(0, 12) + 'WW';
    rows[7] = rows[7].slice(0, 10) + 'OOO.';
  }
  // zıplama: meşgulken bir piksel yukarı
  const up = busy && Math.floor(t * 4) % 2 ? 0 : 1;
  const grid = [];
  for (let i = 0; i < up; i++) grid.push('.'.repeat(W));
  grid.push(...rows);
  while (grid.length < H) grid.push('.'.repeat(W));
  return grid.slice(0, H);
}

const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
const bg = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`;

// Hücre satırları (H/2 adet); her satır görünür genişlikte W
function render(t = 0, { busy = false, color = true } = {}) {
  const g = pixels(t, { busy });
  const out = [];
  for (let r = 0; r < H; r += 2) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const a = g[r][x]; const b = g[r + 1][x];
      const A = PAL[a]; const B = PAL[b];
      if (!A && !B) { line += ' '; continue; }
      if (!color) { line += A && B ? '█' : A ? '▀' : '▄'; continue; }
      if (A && B) line += a === b ? `${fg(A)}█` : `${fg(A)}${bg(B)}▀`;
      else line += A ? `${fg(A)}▀` : `${fg(B)}▄`;
      line += '\x1b[0m';
    }
    out.push(line);
  }
  return out;
}

module.exports = { render, pixels, W, H, ROWS: H / 2 };
