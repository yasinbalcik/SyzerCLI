'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');
const { C, charWidth, vlen } = require('./ui');

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
  read(prompt, { history = true } = {}) {
    this.prompt = prompt;
    this.items = [];
    this.cur = 0;
    this.hIdx = -1;
    this.images = [];
    this.useHistory = history;
    this.mode = 'line';
    this._render();
    return new Promise((resolve) => { this.pending = resolve; });
  }

  // Tek tuşluk soru (onay vb.)
  readKey(prompt) {
    this.out.write(prompt);
    this.mode = 'key';
    return new Promise((resolve) => { this.pending = resolve; });
  }

  // --- olaylar ---
  _key(str, key = {}) {
    if (key.name === 'paste-start') { this.pasting = true; this.pasteBuf = ''; return; }
    if (key.name === 'paste-end') { this.pasting = false; if (this.mode === 'line') this._paste(this.pasteBuf); return; }
    if (this.pasting) { this.pasteBuf += str ?? ''; return; }

    if (this.mode === 'idle') {
      if (key.ctrl && key.name === 'c' && this.onInterrupt) this.onInterrupt();
      return;
    }
    if (this.mode === 'key') {
      const ch = key.ctrl && key.name === 'c' ? 'n' : (str || key.name || '').toLowerCase();
      this.mode = 'idle';
      this.out.write(ch + '\n');
      const done = this.pending; this.pending = null;
      done(ch);
      return;
    }

    switch (key.name) {
      case 'return': case 'enter': return this._submit();
      case 'backspace': if (this.cur > 0) { this.items.splice(--this.cur, 1); } return this._render();
      case 'delete': if (this.cur < this.items.length) this.items.splice(this.cur, 1); return this._render();
      case 'left': this.cur = key.ctrl ? this._wordLeft() : Math.max(0, this.cur - 1); return this._render();
      case 'right': this.cur = key.ctrl ? this._wordRight() : Math.min(this.items.length, this.cur + 1); return this._render();
      case 'home': this.cur = 0; return this._render();
      case 'end': this.cur = this.items.length; return this._render();
      case 'up': return this._hist(-1);
      case 'down': return this._hist(1);
      case 'tab': return this._tab();
      case 'escape': return;
      default:
    }
    if (key.ctrl) {
      switch (key.name) {
        case 'c':
          if (this.items.length) { this.items = []; this.cur = 0; this.out.write('^C'); return this._render(); }
          return this._finish({ exit: true });
        case 'd':
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
    if (!this.complete) return;
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
    } else if (this.tty) {
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
    this.cur = this.items.length;
    this._render();
    this._finish({ text, images, display: this.items.map(itemShow).join('') });
  }

  _finish(result) {
    this.mode = 'idle';
    if (this.tty) this.out.write('\n');
    else if (result.display !== undefined) this.out.write(this.prompt + result.display + '\n');
    const done = this.pending;
    this.pending = null;
    if (done) done(result);
  }

  // --- çizim ---
  _render() {
    if (!this.tty) return;
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
    this.out.write(`\r\x1b[2K${this.prompt}${shown}\r\x1b[${col + 1}G`);
    void from;
  }
}

module.exports = { Editor, imagePaths };
