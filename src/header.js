'use strict';

// Açılış başlığı (Claude Code düzeni): solda Syzer maskotu Zip (canlı), sağda sürüm/model/dizin.
// Alt çerçeve (efor satırı, giriş kutusu çizgileri, izin durumu) Editor'e `frame` olarak verilir.
const os = require('os');
const { C, vlen, trunc } = require('./ui');
const pet = require('./pet');

const LOGO_COLS = pet.W;
const LOGO_ROWS = pet.ROWS;
const GAP = 4;
const INDENT = 3; // maskot sol kenara yapışmasın
const ESC = '\x1b';

const homeRel = (p) => { const h = os.homedir(); return h && p.toLowerCase().startsWith(h.toLowerCase()) ? '~' + p.slice(h.length) : p; };

function textLines(s, reasoning, version, cols) {
  const room = Math.max(10, cols - INDENT - LOGO_COLS - GAP - 1);
  const mid = [s.model, reasoning !== false ? `${s.effort} effort` : null, s.providerName].filter(Boolean).join(' · ');
  return [
    `${C.bold('Syzer Code')} ${C.gray(`v${version}`)}`,
    C.gray(trunc(mid, room)),
    C.gray(trunc(homeRel(s.cwd), room)),
  ];
}

// t anındaki başlık satırları (LOGO_ROWS adet), logo + metin yan yana
function headerRows(s, reasoning, version, cols, t = 0.8) {
  const logo = pet.render(t, { busy: !!s.busy, color: !process.env.NO_COLOR });
  const text = textLines(s, reasoning, version, cols);
  return logo.map((l, i) => ' '.repeat(INDENT) + l + ' '.repeat(Math.max(0, LOGO_COLS + GAP - vlen(l))) + (text[i - 2] || ''));
}

// Efor seviyesine göre renk: soğuk/yeşilden kırmızıya yükselir
const EFFORT_COLOR = { auto: C.cyan, off: C.gray, low: C.green, medium: C.yellow, high: C.orange, xhigh: C.red };
const effortColor = (lvl) => EFFORT_COLOR[lvl] || C.magenta;

// Çerçeve: giriş kutusunun üstündeki (key · efor) ve altındaki (çizgi + durum) satırlar; hits: tıklanabilir alanlar
function makeFrame(s, reasoning, t, cols) {
  const providers = require('./providers');
  const rule = C.gray('─'.repeat(Math.max(10, cols)));
  const hits = [];
  // üst satır: key #n/m · ○ efor · /effort (sağa hizalı)
  const keys = (s.cfg && s.cfg.keys) || [];
  const keyTxt = keys.length ? `key #${((s.cfg.active | 0) + 1)}/${keys.length}` : 'key —';
  const eff = reasoning !== false ? `○ ${s.effort} · /effort` : '';
  const SEP = '  ·  ';
  const total = vlen(keyTxt) + (eff ? SEP.length + vlen(eff) : 0);
  const start = Math.max(0, cols - total - 2);
  let effLine = ' '.repeat(start) + C.cyan(keyTxt);
  hits.push({ where: 'above', i: 0, c1: start + 1, c2: start + vlen(keyTxt), id: 'key' });
  if (eff) {
    effLine += C.gray(SEP) + effortColor(s.effort)(eff);
    const e1 = start + vlen(keyTxt) + SEP.length;
    hits.push({ where: 'above', i: 0, c1: e1 + 1, c2: e1 + vlen(eff), id: 'effort' });
  }
  // alt satır: izin modu (sol) · sağda sağlayıcı · model
  const permTxt = t(`perm_${s.perm}`);
  let status = `  ${C.orange('⏵⏵')} ${C.bold(permTxt)} ${C.gray(`· ${t('frame_hint')}`)}`;
  hits.push({ where: 'below', i: 1, c1: 3, c2: 5 + vlen(permTxt), id: 'perm' });
  const prov = providers.current().name;
  const room = cols - vlen(status) - 5 - vlen(prov) - 3;
  if (s.model && room >= 8) {
    let m = String(s.model);
    if (m.length > room) m = '…' + m.slice(m.length - room + 1);
    const right = vlen(prov) + 3 + m.length;
    const st = cols - 2 - right;
    status += ' '.repeat(Math.max(1, st - vlen(status))) + C.yellow(prov) + C.gray(' · ') + C.green(m);
    hits.push({ where: 'below', i: 1, c1: st + 1, c2: st + vlen(prov), id: 'provider' });
    hits.push({ where: 'below', i: 1, c1: st + vlen(prov) + 4, c2: st + right, id: 'model' });
  }
  return { above: [effLine, rule], below: [rule, status], hits };
}

const HDR_ROWS = LOGO_ROWS + 1; // başlık + 1 boş satır
const FOOT_ROWS = 5; // efor, çizgi, istem, çizgi, durum

const layout = { foot: FOOT_ROWS }; // alt kutu yüksekliği (çok satırlı girişte büyür)
const region = (out) => ({ top: HDR_ROWS + 1, bottom: Math.max(HDR_ROWS + 2, (out.rows || 24) - layout.foot) });

function drawHeader(out, view, reasoning, version, t) {
  const rows = headerRows(view(), reasoning, version, out.columns || 80, t);
  return rows.map((r, i) => `\x1b[${i + 1};1H\x1b[2K${r}`).join('');
}

// Ekranı kurar: üstte sabit başlık, altta sabit kutu, arası kayan çıktı bölgesi (imleç bölgenin başında).
function setup(out, view, reasoning, version, { clear = true } = {}) {
  const { top, bottom } = region(out);
  out.write((clear ? '\x1b[2J' : '') + drawHeader(out, view, reasoning, version, 0.8) + `\x1b[${top};${bottom}r\x1b[${top};1H`);
}

// Bölgeyi ve başlığı yeniden uygular (alt ekrandan dönüş, yeniden boyutlandırma); imleç yerinde kalır.
function reapply(out, view, reasoning, version) {
  const { top, bottom } = region(out);
  out.write(`\x1b7\x1b[${top};${bottom}r` + drawHeader(out, view, reasoning, version, 0.8) + '\x1b8');
}

// Başlıktaki logo sürekli döner. Giriş kutusu açıkken imleç kutuda park edilir (DECSC yuvası editöre ait).
function animate({ out = process.stdout, view, reasoning, version, editor = null, fps = 12 }) {
  if (!out.isTTY) return { stop() {} };
  const t0 = Date.now();
  let timer = null;
  let last = '';
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  timer = setInterval(() => {
    try {
      const h = drawHeader(out, view, reasoning, version, 0.8 + (Date.now() - t0) / 1000);
      if (h === last) return; // kare değişmediyse yazma
      last = h;
      out.write(editor && editor.parked() ? h + editor.parked() : `\x1b7${h}\x1b8`);
    } catch { stop(); }
  }, Math.round(1000 / fps));
  if (timer.unref) timer.unref();
  return { stop };
}

module.exports = { effortColor, headerRows, makeFrame, animate, setup, reapply, region, layout, LOGO_ROWS, HDR_ROWS, FOOT_ROWS };
