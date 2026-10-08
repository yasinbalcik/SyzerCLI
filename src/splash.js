'use strict';

// Karşılama ekranı: alternatif ekranda dönen 3D logo; ilk tuşta kapanır.
// Terminal güvenliği öncelikli: leave() her yolda tam bir kez çalışır (tuş, Ctrl+C/D, hata, process 'exit').
// Kullanıcının splash sırasında bastığı tuşlar toplanıp `keys` ile geri verilir (REPL editöre enjekte eder).
const { vlen } = require('./ui');
const { renderFrame } = require('./logo3d');

const ENTER = '\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H';
const LEAVE = '\x1b[?25h\x1b[?1049l';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';

let active = false; // açıkken ikinci show() yok sayılır

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
    const t0 = Date.now();

    const safeWrite = (s) => { try { out.write(s); } catch { /* terminal gitmiş olabilir */ } };

    const onExit = () => { try { out.write(LEAVE); } catch { /* önemsiz */ } };

    // Tek yerde temizlik: imleç + ana ekran, zamanlayıcı ve dinleyiciler (keypress hariç, o setImmediate'te).
    const leave = () => {
      if (left) return;
      left = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (typeof out.off === 'function') out.off('resize', draw);
      process.off('exit', onExit);
      safeWrite(LEAVE);
    };

    const finish = () => {
      input.off('keypress', onKey);
      active = false;
      resolve({ exit, keys: exit ? [] : keys });
    };

    // Kapat: leave hemen, aynı tick'te gelen ek tuşlar için dinleyici setImmediate'e kadar açık kalır.
    const close = () => {
      if (closing) return;
      closing = true;
      leave();
      setImmediate(finish);
    };

    function draw() {
      if (left) return;
      try {
        const cols = out.columns || 80;
        const rows = out.rows || 24;
        const logoRows = Math.max(1, rows - 4);
        const lines = makeFrame((Date.now() - t0) / 1000, cols, logoRows) || [];
        let s = '\x1b[2J';
        if (title) s += `\x1b[1;${Math.max(1, Math.floor((cols - vlen(title)) / 2) + 1)}H${title}`;
        const top = 3 + Math.max(0, Math.floor((logoRows - lines.length) / 2));
        lines.forEach((ln, i) => {
          if (!ln) return;
          const c = Math.max(1, Math.floor((cols - vlen(ln)) / 2) + 1);
          s += `\x1b[${top + i};${c}H${ln}`;
        });
        s += `\x1b[${rows};1H\u276F ${DIM}${hint}${RST}`;
        out.write(s);
      } catch {
        close(); // çizim hatası: terminal açık kalmasın
      }
    }

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
      if (typeof out.on === 'function') out.on('resize', draw);
      out.write(ENTER);
      draw();
      if (!left) timer = setInterval(draw, Math.max(1, Math.round(1000 / fps)));
    } catch {
      close();
    }
  });
}

module.exports = { eligibleAtStart, eligibleForCommand, show };
