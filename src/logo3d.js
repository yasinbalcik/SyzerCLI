'use strict';

// Dönen 3D logo: nokta bulutunu döndürüp terminal hücrelerine izdüşürür (saf, I/O'suz).
const { C } = require('./ui');
const { points: LOGO_POINTS } = require('./logo-points');

const LAYERS = 3; // z katmanı sayısı (kalınlık hissi)
const LAYER_D = 0.12;
const CAM = 2.4; // perspektif uzaklığı
const ZR = 0.9; // derinlik normalizasyonu için yarıçap sınırı

// Geçerli [x, y] çiftlerini döndürür; bozuk girdiler atılır.
function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

// t anındaki izdüşüm: her nokta için hücre koordinatı (cx, cy) ve derinlik z (0..1, 1 = en yakın).
function projectPoints(t, cols, rows, points = LOGO_POINTS) {
  const pts = cleanPoints(points);
  if (!(cols > 0) || !(rows > 0) || !Number.isFinite(t)) return [];
  const angle = t * 0.9;
  const tilt = 0.18 * Math.sin(t * 0.7);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const scaleY = Math.min(rows, cols / 2) * 0.42;
  const scaleX = scaleY * 2; // hücre en/boy oranı 2:1
  const out = [];
  for (const [px, py] of pts) {
    for (let l = 0; l < LAYERS; l++) {
      const pz = (l - (LAYERS - 1) / 2) * LAYER_D;
      // önce Y ekseni, sonra X ekseni dönüşü
      const x1 = px * ca + pz * sa;
      const z1 = -px * sa + pz * ca;
      const y2 = py * ct - z1 * st;
      const z2 = py * st + z1 * ct;
      const f = CAM / (CAM - z2);
      const z = Math.min(1, Math.max(0, (z2 / ZR + 1) / 2));
      out.push({
        x: x1 * f,
        y: y2 * f,
        cx: Math.round(cols / 2 + x1 * f * scaleX),
        cy: Math.round(rows / 2 + y2 * f * scaleY),
        z,
      });
    }
  }
  return out;
}

// Z-buffer: aynı hücredeki noktalardan en yakın (en büyük z) olanı seçer.
function pickFront(cells) {
  const best = new Map();
  for (const p of cells) {
    const k = p.cx + ',' + p.cy;
    const b = best.get(k);
    if (!b || p.z > b.z) best.set(k, p);
  }
  return [...best.values()];
}

const glyph = (z) => (z < 0.35 ? '·' : z < 0.6 ? '∙' : z < 0.82 ? '•' : '●');
const paint = (z, ch) => (z < 0.45 ? C.gray(ch) : z < 0.75 ? C.orange(ch) : C.bold(C.orange(ch)));

// Tam `rows` satırlık kare üretir; her satır görünür genişlikte <= cols.
function renderFrame({ t = 0, cols, rows, color = true, points = LOGO_POINTS } = {}) {
  cols = Math.max(0, Math.floor(cols) || 0);
  rows = Math.max(0, Math.floor(rows) || 0);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const p of pickFront(projectPoints(t, cols, rows, points))) {
    if (p.cx < 0 || p.cx >= cols || p.cy < 0 || p.cy >= rows) continue;
    grid[p.cy][p.cx] = p;
  }
  return grid.map((row) => {
    let line = '';
    let gap = 0;
    for (const p of row) {
      if (!p) { gap++; continue; }
      line += ' '.repeat(gap);
      gap = 0;
      const ch = glyph(p.z);
      line += color ? paint(p.z, ch) : ch;
    }
    return line; // sondaki boşluklar kırpılır
  });
}

module.exports = { renderFrame, projectPoints, pickFront, LAYERS };
