'use strict';

// Karşılama ekranı: alternatif ekranda dönen 3D logo; ilk tuşta kapanır.
// Terminal güvenliği öncelikli: leave() her yolda tam bir kez çalışır (tuş, Ctrl+C/D, hata, process 'exit').
// Kullanıcının splash sırasında bastığı tuşlar toplanıp `keys` ile geri verilir (REPL editöre enjekte eder).
const { vlen, charWidth } = require('./ui');
const { renderFrame } = require('./logo3d');

const ENTER = '\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H';
const LEAVE = '\x1b[?25h\x1b[?1049l';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';

// Modül düzeyinde paylaşılan bayrak: açıkken ikinci show() (swallowKey dahil) yok sayılır.
let active = false;
const LATE_MS = 40; // ilk tuştan sonra gecikmeli gelen tuşları (parçalı yapıştırma) toplama penceresi

const MIN_ROWS = 24;
const MIN_COLS = 50;
const sizeOk = (out) => (out.rows || 0) >= MIN_ROWS && (out.columns || 0) >= MIN_COLS;

function eligibleAtStart({ env = process.env, out, input, session }) {
  if (!out || !input || !out.isTTY || !input.isTTY || !sizeOk(out)) return false;
  if (env.SYZER_NO_LOGO || env.NO_COLOR || env.ORCA_AGENT_LAUNCH_TOKEN) return false;
  if (session && session.messages && session.messages.length > 1) return false;
  return true;
}

function eligibleForCommand({ out, input }) {
  return !!(out && input && out.isTTY && input.isTTY && sizeOk(out));
}

// Görünür genişliğe göre keser (ANSI dizilerini bozmaz); renkli metnin içinde kesildiyse sıfırlama ekler.
function fit(s, n) {
  s = String(s);
  if (n <= 0) return '';
  if (vlen(s) <= n) return s;
  let w = 0; let o = ''; let cut = false;
  const re = /\[[0-9;?]*[A-Za-z]|[^]/gu;
  for (const m of s.matchAll(re)) {
    const tok = m[0];
    if (tok[0] === '' && tok.length > 1) { o += tok; continue; }
    const cw = charWidth(tok);
    if (w + cw > n) { cut = true; break; }
    w += cw; o += tok;
  }
  return cut ? o + '[0m' : o;
}

const defaultFrame = (color) => (t, cols, rows) => renderFrame({ t, cols, rows, color });

function show({ out = process.stdout, input = process.stdin, title = '', hint = '', fps = 20, color = true, swallowKey = false, frame = null } = {}) {
  if (active) return Promise.resolve({ exit: false, keys: [] });
  active = true;
  const makeFrame = frame || defaultFrame(color);

  return new Promise((resolve) => {
    const keys = [];
    let left = false; // leave() çalıştı
    let closing = false; // ilk tuş/hata geldi, ek tuşlar toplanıyor
    let exit = false;
    let timer = null;
    let lateTimer = null;
    const t0 = Date.now();

    const safeWrite = (s) => { try { out.write(s); } catch { /* terminal gitmiş olabilir */ } };

    const onExit = () => { try { out.write(LEAVE); } catch { /* önemsiz */ } };

    // Tek yerde temizlik: imleç + ana ekran, zamanlayıcı ve dinleyiciler (keypress hariç, o setImmediate'te).
    const leave = () => {
      if (left) return;
      left = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (typeof out.off === 'function') out.off('resize', onResize);
      process.off('exit', onExit);
      safeWrite(LEAVE);
    };

    const finish = () => {
      if (lateTimer) clearTimeout(lateTimer);
      input.off('keypress', onKey);
      active = false;
      resolve({ exit, keys: exit ? [] : keys });
    };

    // Kapat: leave hemen, aynı tick'te gelen ek tuşlar için dinleyici setImmediate'e kadar açık kalır.
    const close = () => {
      if (closing) return;
      closing = true;
      leave();
      lateTimer = setTimeout(finish, LATE_MS);
    };

    function draw(clear) {
      if (left) return;
      try {
        const cols = out.columns || 80;
        const rows = out.rows || 24;
        const logoRows = Math.max(1, rows - 4);
        const lines = makeFrame((Date.now() - t0) / 1000, cols, logoRows) || [];
        const top = 3 + Math.max(0, Math.floor((logoRows - lines.length) / 2));
        const cells = new Array(rows).fill('');
        const put = (r, c, txt) => { if (r >= 1 && r <= rows) cells[r - 1] = `[${r};${c}H${txt}`; };
        if (title) { const tt = fit(title, cols); put(1, Math.max(1, Math.floor((cols - vlen(tt)) / 2) + 1), tt); }
        lines.forEach((ln, i) => {
          if (!ln || top + i > rows - 1) return;
          const l = fit(ln, cols);
          put(top + i, Math.max(1, Math.floor((cols - vlen(l)) / 2) + 1), l);
        });
        put(rows, 1, `❯ ${DIM}${fit(hint, Math.max(0, cols - 4))}${RST}`);
        // Ekran yalnız girişte ve yeniden boyutlandırmada silinir; kareler satır satır yerinde yazılır (titreme yok).
        let s = clear === true ? '[2J' : '';
        for (let r = 1; r <= rows; r++) s += `[${r};1H[2K` + cells[r - 1];
        out.write(s);
      } catch {
        close(); // çizim hatası: terminal açık kalmasın
      }
    }

    function onResize() { draw(true); }

    function onKey(str, key = {}) {
      if (closing) { keys.push({ str, key }); return; }
      const ctrl = key.ctrl && (key.name === 'c' || key.name === 'd');
      if (ctrl) { exit = !swallowKey; close(); return; }
      if (!swallowKey) keys.push({ str, key });
      close();
    }

    try {
      process.on('exit', onExit);
      input.on('keypress', onKey);
      if (typeof out.on === 'function') out.on('resize', onResize);
      out.write(ENTER);
      draw(false);
      if (!left) timer = setInterval(() => draw(false), Math.max(1, Math.round(1000 / fps)));
    } catch {
      close();
    }
  });
}

module.exports = { eligibleAtStart, eligibleForCommand, show };
