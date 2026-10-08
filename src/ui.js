'use strict';

const useColor = (!!process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;

const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const C = {
  bold: wrap('1'), dim: wrap('2'), italic: wrap('3'),
  red: wrap('31'), green: wrap('32'), yellow: wrap('33'), blue: wrap('34'),
  magenta: wrap('35'), cyan: wrap('36'), gray: wrap('90'),
  orange: wrap('38;5;208'),
};

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// Terminal hücre genişliği (CJK ve emoji 2 hücre)
function charWidth(ch) {
  const c = ch.codePointAt(0);
  if (c < 32 || (c >= 0x300 && c <= 0x36f) || c === 0x200b) return 0;
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)) return 2;
  return 1;
}
const vlen = (s) => [...strip(s)].reduce((n, ch) => n + charWidth(ch), 0);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - vlen(s)));

function trunc(s, n) {
  s = String(s);
  return s.length > n ? '…' + s.slice(s.length - n + 1) : s;
}

function box(lines) {
  const cols = process.stdout.columns || 80;
  const inner = Math.min(Math.max(...lines.map(vlen)), cols - 6);
  const top = C.gray('╭' + '─'.repeat(inner + 2) + '╮');
  const bot = C.gray('╰' + '─'.repeat(inner + 2) + '╯');
  const body = lines.map((l) => C.gray('│') + ' ' + pad(l, inner) + ' ' + C.gray('│'));
  return [top, ...body, bot].join('\n');
}

// ████░░░░░░
function bar(used, limit, width = 10) {
  if (!limit) return C.gray('░'.repeat(width));
  const frac = Math.min(1, Math.max(0, used / limit));
  const filled = Math.round(frac * width);
  const color = frac >= 0.9 ? C.red : frac >= 0.6 ? C.yellow : C.green;
  return color('█'.repeat(filled)) + C.gray('░'.repeat(width - filled));
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Canlı durum satırı: ⠋ etiket… 12s · son düşünce parçası
function spinner(label) {
  if (!process.stderr.isTTY) return { stop() {}, label() {}, detail() {}, meta() {} };
  let i = 0;
  let detail = '';
  let meta = '';
  const started = Date.now();
  const draw = () => {
    const cols = (process.stderr.columns || 80) - 1;
    const secs = Math.floor((Date.now() - started) / 1000);
    const info = `${secs}s${meta ? ` · ${meta}` : ''} · ctrl+c`;
    const head = `${C.cyan(FRAMES[i++ % FRAMES.length])} ${C.bold(label + '…')} ${C.gray(`(${info})`)}`;
    let tail = '';
    const room = cols - vlen(head) - 3;
    if (detail && room > 8) {
      let d = detail;
      while (vlen(d) > room) d = d.slice(1);
      tail = C.gray(' · ') + C.dim(C.italic(d));
    }
    process.stderr.write(`\r\x1b[2K${head}${tail}`);
  };
  process.stderr.write('\x1b[?25l');
  draw();
  const timer = setInterval(draw, 90);
  return {
    label(l) { label = l; },
    detail(d) { detail = d; },
    meta(m) { meta = m; },
    stop() { clearInterval(timer); process.stderr.write('\r\x1b[2K\x1b[?25h'); },
  };
}
process.on('exit', () => { if (process.stderr.isTTY) process.stderr.write('\x1b[?25h'); });

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, x) => C.yellow(x))
    .replace(/\*\*([^*]+)\*\*/g, (_, x) => C.bold(x));
}

// Satır tamamlandıkça markdown'ı renklendirerek yazar.
class MdStream {
  constructor(write = (s) => process.stdout.write(s)) {
    this.write = write;
    this.buf = '';
    this.inCode = false;
    this.wrote = false;
  }

  push(text) {
    if (!this.wrote) this.write(C.orange('◆') + ' ');
    this.wrote = true;
    if (!useColor) { this.write(text); return; }
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      this.write(this.render(line) + '\n');
    }
  }

  end() {
    if (useColor && this.buf) { this.write(this.render(this.buf)); this.buf = ''; }
    if (this.inCode) { this.inCode = false; this.write('\n'); }
    else if (this.wrote) this.write('\n');
    this.wrote = false;
  }

  render(line) {
    const fence = line.match(/^\s*```\s*([\w+#.-]*)/);
    if (fence) {
      if (!this.inCode) { this.inCode = true; return '  ' + C.dim(fence[1] || 'code'); }
      this.inCode = false;
      return '';
    }
    if (this.inCode) {
      const body = ' ' + line.replace(/\t/g, '  ');
      const width = Math.min((process.stdout.columns || 80) - 4, 100);
      return '  \x1b[48;5;236m' + body + ' '.repeat(Math.max(0, width - vlen(body))) + '\x1b[0m';
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) return C.bold(C.cyan(inline(h[2])));
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return C.gray('─'.repeat(40));
    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) return `${li[1]}${C.cyan('•')} ${inline(li[2])}`;
    const q = line.match(/^>\s?(.*)$/);
    if (q) return C.gray('▎ ') + C.italic(inline(q[1]));
    return inline(line);
  }
}

function diffPreview(oldStr, newStr, max = 10) {
  const cut = (txt, mark, color) => {
    const ls = txt.split('\n');
    const shown = ls.slice(0, max).map((l) => color(`${mark} ${l}`));
    if (ls.length > max) shown.push(C.gray(`  … +${ls.length - max}`));
    return shown;
  };
  return [...cut(oldStr, '-', C.red), ...cut(newStr, '+', C.green)].join('\n');
}

module.exports = { C, useColor, strip, charWidth, vlen, pad, trunc, box, bar, spinner, MdStream, diffPreview };
