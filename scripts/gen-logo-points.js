'use strict';

// Logo nokta bulutu üretici (yalnızca geliştirici aracı; çalışma zamanında require edilmez).
// Kullanım: npm i --no-save @resvg/resvg-js && node scripts/gen-logo-points.js
const fs = require('fs');
const path = require('path');

let Resvg;
try {
  ({ Resvg } = require('@resvg/resvg-js'));
} catch {
  console.error('Hata: @resvg/resvg-js bulunamadı. Şunu çalıştırın: npm i --no-save @resvg/resvg-js');
  process.exit(1);
}

const WIDTH = 192; // rasterize genişliği (px)
const STEP = 2; // ızgara örnekleme adımı (px)
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'syzer-logo.svg'), 'utf8');
const img = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render();
const { width, height, pixels } = img; // RGBA

// Beyaz çizgi bölgeleri: parlak ve opak pikseller (koyu zemin ve şeffaf köşeler dışarıda kalır).
const raw = [];
for (let y = 0; y < height; y += STEP) {
  for (let x = 0; x < width; x += STEP) {
    const i = (y * width + x) * 4;
    if (pixels[i + 3] > 128 && pixels[i] > 128 && pixels[i + 1] > 128 && pixels[i + 2] > 128) raw.push([x, y]);
  }
}
if (!raw.length) {
  console.error('Hata: hiç beyaz piksel bulunamadı.');
  process.exit(1);
}

// -1..1'e normalize: oran korunur, ortalı; y aşağı doğru artar.
const half = Math.max(width, height) / 2;
const r3 = (v) => Math.round(v * 1000) / 1000;
const points = raw.map(([x, y]) => [r3((x - width / 2) / half), r3((y - height / 2) / half)]);

const out = "'use strict';\n\n// Üretilmiş veri: scripts/gen-logo-points.js ile oluşturuldu, elle düzenlemeyin.\n" +
  'module.exports = { points: [\n' + points.map((p) => `  [${p[0]}, ${p[1]}],`).join('\n') + '\n] };\n';
fs.writeFileSync(path.join(root, 'src', 'logo-points.js'), out);
console.log(`${points.length} nokta yazıldı (${width}x${height}, adım ${STEP}).`);
