'use strict';

// Tam ekran düzende çıktı bölgesi için kendi kaydırma geçmişimiz.
//  - Bölgeye yazılan metin (stdout/stderr) satır satır kaydedilir; imleç konumlayan yazılar (dock, alt kutu, başlık) yok sayılır.
//  - Fare tekerleği (SGR fare raporu) ve PgUp/PgDn yalnızca bu bölgeyi kaydırır; başlık ve alt kutu yerinde kalır.
//  - Geri kaydırılmışken yeni çıktı gelse de görünüm yerinde kalır; bir tuşa basınca ya da en alta inince canlıya dönülür.
const { C, charWidth, vlen } = require('./ui');

const ESC = '\x1b';
const MAX_LINES = 4000;
const STEP = 3; // tekerlek başına satır
const IGNORE = /\x1b7|\x1b8|\x1b\[\d*;?\d*[Hf]|\x1b\[[0-9;]*r|\x1b\[2J/;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const NON_SGR = /\x1b\[[0-9;?]*[A-Za-ln-z]/g;
const MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const TOK = /\x1b\[[0-9;]*m|[\s\S]/gu;

// Görünür genişliğe göre satır kırar (SGR dizilerini satırlar arası taşır).
function wrap(line, cols) {
  const text = String(line).replace(/\t/g, '    ');
  if (vlen(text) <= cols) return [text];
  const rows = [];
  let cur = ''; let w = 0; let active = '';
  for (const m of text.matchAll(TOK)) {
    const tok = m[0];
    if (tok.length > 1 && tok[0] === ESC) { cur += tok; active = /^\x1b\[0?m$/.test(tok) ? '' : active + tok; continue; }
    const cw = charWidth(tok);
    if (cw === 0) continue;
    if (w + cw > cols) { rows.push(cur + '\x1b[0m'); cur = active; w = 0; }
    cur += tok; w += cw;
  }
  rows.push(cur);
  return rows;
}

class Scrollback {
  constructor({ out = process.stdout, region, enabled = () => true, restore = () => {} }) {
    this.out = out;
    this.region = region; // () => { top, bottom }
    this.enabled = enabled; // alt görünüm açıkken false
    this.restore = restore; // canlıya dönünce imleci/saklı konumu düzelt: (row, col) => void
    this.lines = [];
    this.cur = '';
    this.offset = 0;
    this.cache = new Map();
    this.timer = null;
  }

  clear() { this.lines = []; this.cur = ''; this.offset = 0; this.cache.clear(); }

  // Yazılan her parçayı kaydet (orijinal yazma ayrıca terminale gider)
  feed(chunk) {
    let s = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (IGNORE.test(s)) return;
    s = s.replace(OSC, '').replace(NON_SGR, '');
    const parts = s.split('\n');
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      if (!last) p = p.replace(/\r$/, '');
      const r = p.lastIndexOf('\r');
      if (r >= 0) { this.cur = ''; p = p.slice(r + 1); }
      this.cur += p;
      if (!last) { this.lines.push(this.cur); this.cur = ''; }
    });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    if (this.offset > 0) this.later();
  }

  cols() { return Math.max(10, this.out.columns || 80); }

  rowsOf(line) {
    const key = line;
    const c = this.cache.get(key);
    if (c && c.cols === this.cols()) return c.rows;
    const rows = wrap(line, this.cols());
    if (this.cache.size > 6000) this.cache.clear();
    this.cache.set(key, { cols: this.cols(), rows });
    return rows;
  }

  // Tüm satırlar (imleç satırı dahil): canlı ekranın modeli
  allRows() {
    const rows = [];
    for (const l of this.lines) rows.push(...this.rowsOf(l));
    if (this.cur) rows.push(...wrap(this.cur, this.cols()));
    else rows.push('');
    return rows;
  }

  later() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.offset > 0) this.draw(); }, 60);
    if (this.timer.unref) this.timer.unref();
  }

  // Bölgeyi geçmişten çizer; canlıdayken (offset 0) imleç konumunu döndürür
  draw() {
    const { top, bottom } = this.region();
    const H = bottom - top + 1;
    if (H < 2) return null;
    const rows = this.allRows();
    const view = this.offset > 0 ? H - 1 : H;
    const maxOff = Math.max(0, rows.length - view);
    if (this.offset > maxOff) this.offset = maxOff;
    const end = rows.length - this.offset;
    const start = Math.max(0, end - view);
    const win = rows.slice(start, end);
    let o = '';
    for (let i = 0; i < view; i++) o += `${ESC}[${top + i};1H${ESC}[2K${win[i] || ''}${win[i] ? `${ESC}[0m` : ''}`;
    if (this.offset > 0) o += `${ESC}[${bottom};1H${ESC}[2K${C.gray(`  ↓ ${this.offset} satır aşağıda · tekerlek / PgDn · bir tuş canlıya döner`)}`;
    this.out.write(o);
    if (this.offset > 0) return null;
    const n = win.length;
    return { row: top + Math.max(0, n - 1), col: vlen(win[n - 1] || '') + 1 };
  }

  scrollBy(rows) {
    if (!this.enabled()) return true;
    const before = this.offset;
    this.offset = Math.max(0, this.offset + rows);
    if (this.offset === before) return true;
    if (this.offset === 0) { this.live(); return true; }
    this.out.write(`${ESC}[?25l`);
    this.draw();
    return true;
  }

  live() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.offset = 0;
    const pos = this.draw();
    if (pos) this.restore(pos.row, pos.col);
  }

  height() { const { top, bottom } = this.region(); return bottom - top + 1; }

  // Editör tuş kancası: true dönerse tuş tüketildi
  handleKey(str, key = {}) {
    if (!this.enabled()) return false;
    if (key.name === 'pageup') return this.scrollBy(this.height() - 2);
    if (key.name === 'pagedown') return this.scrollBy(-(this.height() - 2));
    if (this.offset > 0) { this.live(); return !!(key.name === 'escape'); }
    return false;
  }

  // stdin 'data' olaylarından fare raporlarını ayıklar ve tekerleği kaydırmaya çevirir
  attachInput(stdin = process.stdin) {
    const emit = stdin.emit;
    const self = this;
    stdin.emit = function patched(ev, chunk, ...rest) {
      if (ev === 'data' && chunk) {
        const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (s.includes(`${ESC}[<`)) {
          let up = 0;
          const clicks = [];
          const left = s.replace(MOUSE, (m, b, x, y, t) => {
            const code = parseInt(b, 10);
            if (t === 'M' && (code & 64)) up += (code & 1) ? -STEP : STEP;
            else if (t === 'M' && !(code & 32) && (code & 3) === 0) clicks.push([parseInt(x, 10), parseInt(y, 10)]);
            return '';
          });
          if (up && !(self.onWheel && self.onWheel(up))) self.scrollBy(up);
          if (self.onClick) clicks.forEach(([cx, cy]) => { try { self.onClick(cx, cy); } catch { /* tıklama akışı bozmasın */ } });
          if (!left) return true;
          chunk = Buffer.isBuffer(chunk) ? Buffer.from(left) : left;
        }
      }
      return emit.call(this, ev, chunk, ...rest);
    };
    return () => { stdin.emit = emit; };
  }

  // stdout/stderr yazmalarını kaydeden sarmalayıcı
  attachOutput(streams = [process.stdout, process.stderr]) {
    const undo = [];
    for (const st of streams) {
      const orig = st.write;
      const self = this;
      st.write = function patched(chunk, ...rest) {
        try { self.feed(chunk); } catch { /* kayıt yazmayı bozmamalı */ }
        return orig.call(this, chunk, ...rest);
      };
      undo.push(() => { st.write = orig; });
    }
    return () => undo.forEach((f) => f());
  }
}

module.exports = { Scrollback, wrap };
