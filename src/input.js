'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');
const { C, charWidth, vlen, pad } = require('./ui');

const HISTORY_FILE = path.join(config.DIR, 'history.json');
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

const itemText = (it) => (typeof it === 'string' ? it : it.value);
const itemShow = (it) => (typeof it === 'string' ? it : it.label);
const itemWidth = (it) => (typeof it === 'string' ? charWidth(it) : vlen(it.label));

// Yapıştırılan metin tek veya birden çok görsel dosya yolu mu?
function imagePaths(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (!lines.length || lines.length > 8) return null;
  for (const l of lines) {
    if (!IMAGE_RE.test(l)) return null;
    try { if (!fs.statSync(l).isFile()) return null; } catch { return null; }
  }
  return lines;
}

/*
 * Ham modda çalışan tek satırlık düzenleyici.
 *  - Bracketed paste: uzun/çok satırlı yapıştırma  →  [Pasted text #N +M lines]
 *  - Görsel dosya yolu yapıştırma                   →  [Image #N]
 *  - Placeholder'lar atomiktir (tek Backspace hepsini siler), gönderirken açılır.
 */
class Editor {
  constructor({ input = process.stdin, output = process.stdout, complete = null } = {}) {
    this.in = input;
    this.out = output;
    this.tty = !!output.isTTY;
    this.complete = complete;
    this.items = [];
    this.cur = 0;
    this.prompt = '';
    this.mode = 'idle'; // idle | line | key
    this.history = this._loadHistory();
    this.hIdx = -1;
    this.stash = null;
    this.pasting = false;
    this.pasteBuf = '';
    this.n = { text: 0, image: 0 };
    this.images = [];
    this.pending = null;
    this.onInterrupt = null;
    this._key = this._key.bind(this);
    this._end = () => this._finish({ exit: true });
  }

  start() {
    readline.emitKeypressEvents(this.in);
    if (this.in.isTTY) this.in.setRawMode(true);
    this.in.resume();
    this.in.on('keypress', this._key);
    this.in.on('end', this._end);
    if (this.tty) this.out.write('\x1b[?2004h');
  }

  stop() {
    this.in.off('keypress', this._key);
    this.in.off('end', this._end);
    if (this.in.isTTY) this.in.setRawMode(false);
    if (this.tty) this.out.write('\x1b[?2004l');
    this.in.pause();
    this._saveHistory();
  }

  // --- geçmiş ---
  _loadHistory() {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).slice(-200); } catch { return []; }
  }
  _saveHistory() {
    try { fs.mkdirSync(config.DIR, { recursive: true }); fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history.slice(-200))); } catch { /* önemsiz */ }
  }

  // --- genel API ---
  read(prompt, { history = true, frame = true } = {}) {
    this.prompt = prompt;
    this._framed = 0;
    this.menu = null; this.menuHidden = null; this.picker = null;
    if (frame && this.frame && this.tty && !this.dock) { if (this.screen) this._drawFooter(true); else this._drawFrame(); }
    this.items = this.carry || [];
    this.cur = this.items.length;
    this.carry = null;
    this.hIdx = -1;
    this.images = [];
    this.useHistory = history;
    this.mode = 'line';
    this._render();
    return new Promise((resolve) => { this.pending = resolve; });
  }

  // Giriş kutusu çerçevesi: üst satırlar + [istem satırı] + alt satırlar; imleç istem satırında kalır
  _drawFrame() {
    let f;
    try { f = this.frame(this.out.columns || 80); } catch { return; }
    if (!f) return;
    this._framed = f.below.length;
    const up = f.above.map((l) => `\r\x1b[2K${l}\n`).join('') + '\n';
    const down = f.below.map((l, i) => `\r\x1b[2K${l}${i < f.below.length - 1 ? '\n' : ''}`).join('');
    this.out.write(up + down + `\x1b[${f.below.length - 1}A`);
  }

  // Sabit ekran düzeni: alt kutu mutlak satırlarda; çıktı imleci DECSC ile saklanır, gönderimde geri yüklenir.
  // Giriş çok satırlı olabilir (Shift+Enter): kutu yukarı büyür, çıktı bölgesi küçülür (onHeight).
  _drawFooter(save) {
    this._foot = 5;
    this._framed = 'screen';
    this._renderScreen(save);
  }

  _footerLines() {
    let f;
    try { f = this.frame(this.out.columns || 80); } catch { return null; }
    return f || null;
  }

  // "/" ile başlayan girişte komut öneri menüsü (this.suggest: text => [{ name, usage, desc, args }])
  _updateMenu() {
    this.menu = null;
    if (this.picker || !this.suggest || this.items.some((x) => typeof x !== 'string')) return;
    const text = this.items.join('');
    if (!text.startsWith('/') || /\s/.test(text) || text === this.menuHidden) return;
    let list;
    try { list = this.suggest(text); } catch { return; }
    if (!list || !list.length) return;
    if (this._menuKey !== text) { this._menuSel = 0; this._menuKey = text; }
    this._menuSel = Math.max(0, Math.min(this._menuSel || 0, list.length - 1));
    this.menu = { list, sel: this._menuSel };
  }

  // --- seçici: pick({ title, items: [{ label, value, hint }], current }) → seçilen value ya da null ---
  pick({ title, items, current }) {
    if (this._framed !== 'screen') return Promise.resolve(null);
    return new Promise((resolve) => {
      const i = items.findIndex((x) => x.value === current);
      this.picker = { title, items, current, query: '', sel: Math.max(0, i), resolve };
      this._render();
    });
  }

  _pickList() {
    const p = this.picker;
    const q = p.query.toLowerCase();
    return q ? p.items.filter((x) => x.label.toLowerCase().includes(q)) : p.items;
  }

  _pickDone(value) {
    const p = this.picker;
    this.picker = null;
    this._render();
    p.resolve(value);
  }

  _pickAccept() {
    const list = this._pickList();
    const it = list[this.picker.sel];
    this._pickDone(it ? it.value : null);
  }

  _pickKey(str, key = {}) {
    const p = this.picker;
    const n = this._pickList().length;
    const move = (d) => { p.sel = Math.max(0, Math.min(n - 1, p.sel + d)); this._render(); };
    switch (key.name) {
      case 'up': return move(-1);
      case 'down': return move(1);
      case 'pageup': return move(-8);
      case 'pagedown': return move(8);
      case 'return': case 'enter': return this._pickAccept();
      case 'escape': return this._pickDone(null);
      case 'backspace': p.query = p.query.slice(0, -1); p.sel = 0; return this._render();
      default:
    }
    if (key.ctrl && key.name === 'c') return this._pickDone(null);
    if (str && str >= ' ' && !key.ctrl && !key.meta) { p.query += str; p.sel = 0; this._render(); }
  }

  wheel(dir) { // tekerlek: seçici açıksa listeyi kaydır
    if (!this.picker) return false;
    const n = this._pickList().length;
    this.picker.sel = Math.max(0, Math.min(n - 1, this.picker.sel + (dir > 0 ? -3 : 3)));
    this._render();
    return true;
  }

  // Fare tıklaması (satır, sütun 1 tabanlı): true dönerse tüketildi
  click(row, col) {
    if (this._framed !== 'screen' || this.mode !== 'line') return false;
    const h = (this._hits || []).find((x) => x.row === row && col >= x.c1 && col <= x.c2);
    if (!h) return false;
    if (h.id === 'item') {
      if (this.picker) { this.picker.sel = h.idx; this._pickAccept(); }
      else if (this.menu) { this._menuSel = h.idx; this.menu.sel = h.idx; this._accept(true); }
      return true;
    }
    if (this.picker) return true;
    if (this.onAction) Promise.resolve(this.onAction(h.id)).catch(() => {});
    return true;
  }

  // Eylem çıktısı kaydırma bölgesine yazılsın (imleç alt kutuda park edilmiş olduğundan saklı konuma dön)
  async withOutput(fn) {
    this.out.write('\x1b8');
    try { await fn(); } finally { this.out.write('\x1b7'); this._render(); }
  }

  _menuRows(cols, rows) {
    this._menuMeta = null;
    if (this.picker) {
      const list = this._pickList();
      const p = this.picker;
      p.sel = Math.max(0, Math.min(p.sel, Math.max(0, list.length - 1)));
      const max = Math.max(3, Math.min(8, Math.floor(rows / 3)));
      const from = p.sel >= max ? p.sel - max + 1 : 0;
      const vis = list.slice(from, from + max);
      const head = `  ${C.bold(p.title)} ${C.gray('· ' + (p.query ? p.query : 'type to filter · ↑↓ · Enter · Esc'))}`;
      const room = Math.max(10, cols - 8);
      this._menuMeta = { from, header: 1, count: vis.length };
      const rowsOut = vis.map((it, i) => {
        const on = from + i === p.sel;
        const mark = it.value === p.current ? '●' : ' ';
        let txt = it.label + (it.hint ? '  ' + it.hint : '');
        const a = [...txt]; if (a.length > room) txt = a.slice(0, room - 1).join('') + '…';
        const paint = it.color || ((x) => x);
        return on ? `  ${C.orange('❯')} ${C.orange(mark)} ${C.bold(paint(txt))}` : `    ${C.gray(mark)} ${paint(txt)}`;
      });
      if (!vis.length) rowsOut.push(C.gray('    —'));
      return [head, ...rowsOut];
    }
    if (!this.menu) return [];
    const { list, sel } = this.menu;
    const max = Math.max(3, Math.min(8, Math.floor(rows / 3)));
    const from = sel >= max ? sel - max + 1 : 0;
    const nw = Math.min(24, Math.max(...list.map((x) => vlen(x.name))) + 2);
    const room = Math.max(10, cols - nw - 6);
    const cut = (s) => { const a = [...String(s).replace(/\s+/g, ' ')]; return a.length > room ? a.slice(0, room - 1).join('') + '…' : a.join(''); };
    this._menuMeta = { from, header: 0, count: Math.min(max, list.length - from) };
    return list.slice(from, from + max).map((it, i) => (from + i === sel
      ? `  ${C.orange('❯')} ${C.bold(C.orange(pad(it.name, nw)))}${cut(it.desc)}`
      : `    ${pad(it.name, nw)}${C.gray(cut(it.desc))}`));
  }

  // Menüden seçileni yaz (run: argümansız komutsa hemen çalıştır)
  _accept(run) {
    const it = this.menu.list[this.menu.sel];
    this.items = [...it.name];
    if (it.args) this.items.push(' ');
    this.cur = this.items.length;
    if (run && !it.args) return this._submit();
    this._render();
  }

  _renderScreen(save) {
    const f = this._footerLines();
    if (!f) return;
    if (save) this.out.write('\x1b7');
    this._updateMenu();
    const cols = this.out.columns || 80;
    const rows = this.out.rows || 24;
    const pw = vlen(this.prompt);
    const avail = Math.max(8, cols - 1 - pw);
    const REV = '\x1b[7m'; const OFF = '\x1b[27m';
    // görsel satırlara böl: her satır [{ s, idx }]
    const vr = [[]];
    let x = 0; let cr = 0; let cc = 0;
    for (let i = 0; i <= this.items.length; i++) {
      if (i === this.cur) { if (x >= avail && i === this.items.length) { vr.push([]); x = 0; } cr = vr.length - 1; cc = x; }
      if (i === this.items.length) break;
      const it = this.items[i];
      if (it === '\n') { vr.push([]); x = 0; continue; }
      const w = itemWidth(it);
      if (x + w > avail) { vr.push([]); x = 0; }
      vr[vr.length - 1].push({ s: typeof it === 'string' ? it : C.cyan(it.label), idx: i });
      x += w;
    }
    const maxRows = Math.max(1, Math.min(10, Math.floor(rows / 3)));
    const start = vr.length > maxRows ? Math.min(Math.max(0, cr - (maxRows - 1)), vr.length - maxRows) : 0;
    const shown = vr.slice(start, start + maxRows);
    const empty = !this.items.length && this.placeholder;
    const body = shown.map((row, ri) => {
      const lead = start + ri === 0 ? this.prompt : ' '.repeat(pw);
      let s = '';
      if (empty && start + ri === 0) {
        const ph = [...this.placeholder].slice(0, avail);
        s = REV + (ph[0] || ' ') + OFF + C.gray(ph.slice(1).join(''));
      } else {
        for (const seg of row) s += seg.idx === this.cur ? REV + seg.s + OFF : seg.s;
        if (start + ri === cr && this.cur >= this.items.length) s += REV + ' ' + OFF;
        else if (start + ri === cr && this.items[this.cur] === '\n') s += REV + ' ' + OFF;
      }
      return lead + s;
    });
    const menuRows = this._menuRows(cols, rows);
    const below = [f.below[0], ...menuRows, ...f.below.slice(1)];
    const foot = f.above.length + shown.length + below.length;
    if (foot !== this._foot) { this._foot = foot; if (this.onHeight) this.onHeight(foot); }
    const first = rows - foot + 1;
    const hits = [];
    (f.hits || []).forEach((h) => {
      const row = h.where === 'above' ? first + h.i : first + f.above.length + shown.length + h.i + menuRows.length;
      hits.push({ row, c1: h.c1, c2: h.c2, id: h.id });
    });
    if (this._menuMeta) {
      const base = first + f.above.length + shown.length + 1 + this._menuMeta.header;
      for (let k = 0; k < this._menuMeta.count; k++) hits.push({ row: base + k, c1: 1, c2: cols, id: 'item', idx: this._menuMeta.from + k });
    }
    this._hits = hits;
    const lines = [...f.above, ...body, ...below];
    this._promptRow = first + f.above.length;
    this._parkRow = this._promptRow + (cr - start);
    this._parkCol = pw + cc + 1;
    this.out.write(lines.map((l, i) => `\x1b[${first + i};1H\x1b[2K${l}`).join('') + `\x1b[${this._parkRow};${this._parkCol}H\x1b[?25l`);
  }

  // Animasyon yazarken imleci giriş satırına geri koymak için
  parked() { return this._framed === 'screen' && this.mode === 'line' ? `\x1b[${this._parkRow};${this._parkCol || 1}H` : ''; }

  // Çok satırlı girişte ↑/↓ satırlar arasında gezinir; ilk/son satırdaysa false (geçmişe düşer)
  _vert(dir) {
    if (!this.items.includes('\n')) return false;
    const starts = [0];
    this.items.forEach((it, i) => { if (it === '\n') starts.push(i + 1); });
    let L = starts.length - 1;
    while (L > 0 && starts[L] > this.cur) L--;
    const T = L + dir;
    if (T < 0 || T >= starts.length) return false;
    const col = this.cur - starts[L];
    const len = (T + 1 < starts.length ? starts[T + 1] - 1 : this.items.length) - starts[T];
    this.cur = starts[T] + Math.min(col, len);
    this._render();
    return true;
  }

  _newline() {
    if (this.cur > 0 && this.items[this.cur - 1] === '\\') this.items[this.cur - 1] = '\n';
    else this.items.splice(this.cur++, 0, '\n');
    this._render();
  }

  // Tek tuşluk soru (onay vb.)
  readKey(prompt) {
    this.out.write(prompt);
    this.mode = 'key';
    return new Promise((resolve) => { this.pending = resolve; });
  }

  // Dışarıdan tuş enjekte et (splash sırasında yakalanan tuşları yeniden oynatmak için)
  inject(str, key = {}) { return this._key(str, key); }

  // --- olaylar ---
  _key(str, key = {}) {
    if (key.name === 'paste-start') { this.pasting = true; this.pasteBuf = ''; return; }
    if (key.name === 'paste-end') { this.pasting = false; if (this.mode === 'line') this._paste(this.pasteBuf); return; }
    if (this.pasting) { this.pasteBuf += str ?? ''; return; }
    if (this.dock && this.mode === 'line' && this.dock.handleKey(str, key)) return; // alt ajan listesi / canlı görünüm
    if (this.picker && this._framed === 'screen' && this.mode === 'line') return this._pickKey(str, key); // tıklanabilir seçici
    if (this.scroller && this.scroller.handleKey(str, key)) return; // çıktı bölgesi kaydırma (PgUp/PgDn)

    if (this.mode === 'idle') {
      if (key.ctrl && key.name === 'c' && this.onInterrupt) this.onInterrupt();
      return;
    }
    if (this.mode === 'key') {
      const ch = key.ctrl && key.name === 'c' ? 'n' : (str || key.name || '').toLowerCase();
      this.mode = this.dock ? 'line' : 'idle';
      this.out.write(ch + '\n');
      const done = this.pending; this.pending = null;
      done(ch);
      return;
    }

    if (this._framed === 'screen' && this.menu) { // komut öneri menüsü
      const m = this.menu;
      if (key.name === 'up' || key.name === 'down') { this._menuSel = (m.sel + (key.name === 'up' ? -1 : 1) + m.list.length) % m.list.length; return this._render(); }
      if (key.name === 'tab') return this._accept(false);
      if (key.name === 'escape') { this.menuHidden = this.items.join(''); return this._render(); }
      if (key.name === 'return' && !key.shift && !key.meta && this.items.join('') !== m.list[m.sel].name) return this._accept(true);
    }
    const seq = key.sequence || '';
    if (this.screen && (((key.name === 'return') && (key.shift || key.meta)) || key.name === 'enter' || /^\x1b\[(?:13;[2-9]u|27;[2-9];13~)$/.test(seq))) return this._newline(); // Shift/Alt+Enter, Ctrl+J
    if (this.screen && key.name === 'return' && this.cur > 0 && this.items[this.cur - 1] === '\\') return this._newline(); // \ + Enter
    switch (key.name) {
      case 'return': case 'enter': return this._submit();
      case 'backspace': if (this.cur > 0) { this.items.splice(--this.cur, 1); } return this._render();
      case 'delete': if (this.cur < this.items.length) this.items.splice(this.cur, 1); return this._render();
      case 'left': this.cur = key.ctrl ? this._wordLeft() : Math.max(0, this.cur - 1); return this._render();
      case 'right': this.cur = key.ctrl ? this._wordRight() : Math.min(this.items.length, this.cur + 1); return this._render();
      case 'home': this.cur = 0; return this._render();
      case 'end': this.cur = this.items.length; return this._render();
      case 'up': return this._vert(-1) || this._hist(-1);
      case 'down': return this._vert(1) || this._hist(1);
      case 'tab': return this._tab();
      case 'escape': return;
      default:
    }
    if (key.ctrl) {
      switch (key.name) {
        case 'c':
          if (this.dock) {
            if (this.items.length) { this.items = []; this.cur = 0; return this._render(); }
            if (this.onInterrupt) this.onInterrupt();
            return;
          }
          if (this.items.length) { this.items = []; this.cur = 0; this.out.write('^C'); return this._render(); }
          return this._finish({ exit: true });
        case 'd':
          if (this.dock) return;
          if (!this.items.length) return this._finish({ exit: true });
          if (this.cur < this.items.length) this.items.splice(this.cur, 1);
          return this._render();
        case 'a': this.cur = 0; return this._render();
        case 'e': this.cur = this.items.length; return this._render();
        case 'u': this.items.splice(0, this.cur); this.cur = 0; return this._render();
        case 'k': this.items.splice(this.cur); return this._render();
        case 'w': { const to = this._wordLeft(); this.items.splice(to, this.cur - to); this.cur = to; return this._render(); }
        default: return;
      }
    }
    if (key.meta) return;
    if (str && str >= ' ') {
      const chars = [...str].filter((ch) => ch >= ' ');
      this.items.splice(this.cur, 0, ...chars);
      this.cur += chars.length;
      this._render();
    }
  }

  _wordLeft() {
    let i = this.cur;
    while (i > 0 && itemText(this.items[i - 1]) === ' ') i--;
    while (i > 0 && itemText(this.items[i - 1]) !== ' ') i--;
    return i;
  }
  _wordRight() {
    let i = this.cur;
    while (i < this.items.length && itemText(this.items[i]) !== ' ') i++;
    while (i < this.items.length && itemText(this.items[i]) === ' ') i++;
    return i;
  }

  _hist(dir) {
    if (!this.useHistory || !this.history.length) return;
    if (this.hIdx === -1) {
      if (dir > 0) return;
      this.stash = this.items;
      this.hIdx = this.history.length;
    }
    this.hIdx += dir;
    if (this.hIdx >= this.history.length) { this.hIdx = -1; this.items = this.stash || []; }
    else { this.hIdx = Math.max(0, this.hIdx); this.items = [...this.history[this.hIdx]]; }
    this.cur = this.items.length;
    this._render();
  }

  _tab() {
    if (!this.complete || this.dock) return;
    const before = this.items.slice(0, this.cur);
    if (before.some((x) => typeof x !== 'string')) return;
    const text = before.join('');
    const cands = this.complete(text);
    if (!cands.length) return;
    let fill = cands[0];
    for (const c of cands) { while (!c.startsWith(fill)) fill = fill.slice(0, -1); }
    if (cands.length === 1) fill += ' ';
    if (fill.length > text.length) {
      this.items.splice(0, this.cur, ...fill);
      this.cur = fill.length;
    } else if (this.tty && !this._framed) {
      this.out.write('\r\x1b[2K' + C.gray(cands.join('  ')) + '\n');
    }
    this._render();
  }

  _paste(raw) {
    const text = raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!text) return;
    const imgs = imagePaths(text);
    if (imgs) {
      for (const p of imgs) {
        const label = `[Image #${++this.n.image}]`;
        this.items.splice(this.cur++, 0, { label, value: label, image: p });
      }
    } else {
      const lines = text.split('\n').length;
      if (lines > 1 || text.length > 300) {
        const label = `[Pasted text #${++this.n.text} +${lines} lines]`;
        this.items.splice(this.cur++, 0, { label, value: text });
      } else {
        const chars = [...text];
        this.items.splice(this.cur, 0, ...chars);
        this.cur += chars.length;
      }
    }
    this._render();
  }

  _submit() {
    const text = this.items.map(itemText).join('');
    const images = this.items.filter((x) => typeof x !== 'string' && x.image).map((x) => x.image);
    const plain = this.items.every((x) => typeof x === 'string');
    if (this.useHistory && plain && text.trim() && this.history[this.history.length - 1] !== this.items.join('')) {
      this.history.push(this.items.join(''));
    }
    if (this.dock) {
      const display = this.items.map(itemShow).join('');
      this.items = []; this.cur = 0;
      if (text.trim() || images.length) this.dock.submit({ text, images, display });
      else this._render();
      return;
    }
    this.cur = this.items.length;
    this._render();
    this._finish({ text, images, display: this.items.map(itemShow).join('') });
  }

  _finish(result) {
    const screenMode = this.tty && this._framed === 'screen';
    this.menu = null;
    if (this.picker) { const p = this.picker; this.picker = null; p.resolve(null); }
    if (screenMode && this._foot !== 5 && this.onHeight) { this._foot = 5; this.onHeight(5); }
    this.mode = 'idle';
    if (screenMode) {
      const f = this._footerLines();
      if (f) { const rows = this.out.rows || 24; const lines = [...f.above, '', ...f.below]; const first = rows - lines.length + 1; this.out.write(lines.map((l, i) => `\x1b[${first + i};1H\x1b[2K${l}`).join('')); }
      this.out.write('\x1b8\x1b[?25h');
      if (result.display !== undefined) this.out.write(this.prompt + result.display.replace(/\n/g, '\n' + ' '.repeat(vlen(this.prompt))) + '\n'); // ayrı yazma: kaydırma geçmişine girsin
      this._framed = 0;
    } else {
    if (this.tty && this._framed) this.out.write('\r\x1b[J');
    this._framed = 0;
    if (this.tty) this.out.write('\n');
    else if (result.display !== undefined) this.out.write(this.prompt + result.display + '\n');
    }
    const done = this.pending;
    this.pending = null;
    if (done) done(result);
  }

  // --- çizim ---
  _render() {
    if (!this.tty) return;
    if (this.dock) return this.dock.draw();
    if (this._framed === 'screen') return this._renderScreen(false);
    const cols = (this.out.columns || 80) - 1;
    const avail = Math.max(10, cols - vlen(this.prompt));
    const widths = this.items.map(itemWidth);
    const cursorX = widths.slice(0, this.cur).reduce((a, b) => a + b, 0);
    const startX = Math.max(0, cursorX - (avail - 2));

    let x = 0;
    let i = 0;
    while (i < this.items.length && x < startX) x += widths[i++];
    let shown = '';
    let used = 0;
    const from = i;
    for (; i < this.items.length && used + widths[i] <= avail; i++) {
      const it = this.items[i];
      shown += typeof it === 'string' ? it : C.cyan(it.label);
      used += widths[i];
    }
    const col = vlen(this.prompt) + (cursorX - x) ;
    if (!this.items.length && this.placeholder && this._framed) shown = C.gray(this.placeholder.slice(0, avail));
    this._col = col + 1;
    this.out.write(`\r\x1b[2K${this.prompt}${shown}\r\x1b[${col + 1}G`);
    void from;
  }
}

module.exports = { Editor, imagePaths };
