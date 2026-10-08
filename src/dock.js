'use strict';

// Alt "dock": ajan çalışırken terminalin altında sabit kalan alan.
//   durum satırı (spinner) · çalışan alt ajanlar · sıradaki mesajlar · giriş satırı
// Normal çıktı kaydırma bölgesinde (üstte) akmaya devam eder; kullanıcı yeni mesajı yazıp sıraya koyabilir.
const { C, vlen, trunc } = require('./ui');

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ESC = '\x1b';

class Dock {
  constructor({ editor, input = process.stdin, out = process.stdout }) {
    this.editor = editor;
    this.in = input;
    this.out = out;
    this.queue = []; // { text, images, display }
    this.active = false;
    this.status = null; // { label, start }
    this.detail = '';
    this.meta = '';
    this.agents = []; // satır metinleri
    this.paused = false;
    this.h = 0;
    this.frame = 0;
  }

  supported() { return !!(this.out.isTTY && this.in.isTTY && this.out.rows >= 16 && !process.env.SYZER_NO_DOCK); }

  // İmleç satır/sütun (DSR). Yanıt yoksa null.
  cursorPos() {
    return new Promise((resolve) => {
      let buf = '';
      const done = (v) => { this.in.off('data', onData); clearTimeout(to); resolve(v); };
      const onData = (d) => {
        buf += d.toString();
        const m = buf.match(/\x1b\[(\d+);(\d+)R/);
        if (m) done({ row: +m[1], col: +m[2] });
      };
      const to = setTimeout(() => done(null), 400);
      this.in.on('data', onData);
      this.out.write(`${ESC}[6n`);
    });
  }

  need() { return 3 + Math.min(this.agents.length, 6) + (this.queue.length ? 1 : 0); }

  async begin() {
    if (this.active || !this.supported()) return false;
    const prevMode = this.editor.mode;
    this.editor.mode = 'idle'; // DSR yanıtı giriş olarak yorumlanmasın
    const pos = await this.cursorPos();
    await new Promise((r) => setImmediate(r));
    if (!pos) { this.editor.mode = prevMode; return false; }
    this.rows = this.out.rows;
    this.h = this.need();
    const bottom = this.rows - this.h;
    let row = pos.row;
    if (row > bottom) { // içerik dock alanına taşıyor: yukarı kaydır
      this.out.write(`${ESC}[${this.rows};1H${'\n'.repeat(row - bottom)}`);
      row = bottom;
    }
    this.out.write(`${ESC}[1;${bottom}r${ESC}[${row};${pos.col}H${ESC}[?25l`);
    this.active = true;
    this.savedHistory = this.editor.useHistory;
    this.editor.useHistory = false;
    this.editor.dock = this;
    this.editor.mode = 'line';
    this.editor.items = this.editor.carry || [];
    this.editor.cur = this.editor.items.length;
    this.editor.carry = null;
    this.timer = setInterval(() => this.draw(), 100);
    this.draw();
    return true;
  }

  async grow() {
    if (this.growing) return;
    const want = this.need();
    if (want <= this.h) return;
    this.growing = true;
    try {
      const prev = this.editor.mode;
      this.editor.mode = prev === 'key' ? 'key' : 'idle';
      const pos = await this.cursorPos();
      await new Promise((r) => setImmediate(r));
      this.editor.mode = prev;
      const oldBottom = this.rows - this.h;
      const newBottom = this.rows - want;
      let row = pos ? pos.row : oldBottom;
      const col = pos ? pos.col : 1;
      if (row > newBottom) {
        this.out.write(`${ESC}[${oldBottom};1H${'\n'.repeat(row - newBottom)}`);
        row = newBottom;
      }
      this.out.write(`${ESC}[1;${newBottom}r${ESC}[${row};${col}H`);
      this.h = want;
    } finally { this.growing = false; }
  }

  setStatus(label) { this.status = label ? { label, start: this.status && this.status.label === label ? this.status.start : Date.now() } : null; if (!label) { this.detail = ''; this.meta = ''; } }
  setDetail(d) { this.detail = d; }
  setMeta(m) { this.meta = m; }
  setAgents(rows) { this.agents = rows; if (this.need() > this.h) this.grow(); }
  pause(on) { this.paused = on; }

  // Düzenleyici kullanıcı mesajını gönderdi
  submit(result) {
    this.queue.push(result);
    if (this.need() > this.h) this.grow();
    this.draw();
  }

  inputLine(width) {
    const items = this.editor.items;
    const cur = this.editor.cur;
    const label = (it) => (typeof it === 'string' ? it : C.cyan(it.label));
    const plain = (it) => (typeof it === 'string' ? it : it.label);
    const room = Math.max(8, width - 4);
    let start = 0;
    let w = items.slice(0, cur).reduce((a, it) => a + vlen(plain(it)), 0);
    while (w > room - 2 && start < cur) { w -= vlen(plain(items[start])); start++; }
    let shown = '';
    let used = 0;
    for (let i = start; i < items.length; i++) {
      const tw = vlen(plain(items[i]));
      if (used + tw > room) break;
      if (i === cur) shown += `${ESC}[7m \x1b[27m`;
      shown += label(items[i]);
      used += tw;
    }
    if (cur >= items.length) shown += `${ESC}[7m ${ESC}[27m`;
    return `${C.orange('❯')} ${shown}`;
  }

  draw() {
    if (!this.active || this.growing) return;
    const cols = this.out.columns || 80;
    const top = this.rows - this.h + 1;
    const lines = [];
    // durum satırı
    if (this.status && !this.paused) {
      const secs = Math.floor((Date.now() - this.status.start) / 1000);
      const head = `${C.cyan(FRAMES[this.frame++ % FRAMES.length])} ${C.bold(`${this.status.label}…`)} ${C.gray(`(${secs}s${this.meta ? ` · ${this.meta}` : ''} · ctrl+c)`)}`;
      let tail = '';
      const room = cols - vlen(head) - 4;
      if (this.detail && room > 8) { let d = this.detail; while (vlen(d) > room) d = d.slice(1); tail = `${C.gray(' · ')}${C.dim(C.italic(d))}`; }
      lines.push(head + tail);
    } else lines.push('');
    for (const a of this.agents.slice(0, 6)) lines.push(trunc(a, cols - 2));
    if (this.queue.length) lines.push(C.gray(`  ⏎ ${this.queue.length} mesaj sırada: `) + C.dim(trunc((this.queue[0].display || this.queue[0].text || '').replace(/\s+/g, ' '), Math.max(10, cols - 28))));
    const tailLines = [C.gray('─'.repeat(Math.max(10, cols - 1))), this.inputLine(cols)];
    while (lines.length < this.h - tailLines.length) lines.push('');
    const all = [...lines.slice(0, this.h - tailLines.length), ...tailLines];
    let s = `${ESC}7`;
    all.forEach((l, i) => { s += `${ESC}[${top + i};1H${ESC}[2K${l}`; });
    s += `${ESC}8`;
    this.out.write(s);
  }

  end() {
    if (!this.active) return;
    clearInterval(this.timer);
    const top = this.rows - this.h + 1;
    let s = `${ESC}7`;
    for (let i = 0; i < this.h; i++) s += `${ESC}[${top + i};1H${ESC}[2K`;
    s += `${ESC}[r${ESC}8${ESC}[?25h`;
    this.out.write(s);
    this.active = false;
    this.editor.dock = null;
    this.editor.carry = this.editor.items.length ? this.editor.items : null; // yazılmış ama gönderilmemiş metin sonraki istemde kalsın
    this.editor.items = [];
    this.editor.cur = 0;
    this.editor.useHistory = this.savedHistory;
    this.editor.mode = 'idle';
    this.status = null; this.detail = ''; this.meta = ''; this.agents = [];
    this.h = 0;
    this.out.write('\n'); // çıktı dock satırlarının üstünde yeni satırdan devam etsin
  }
}

module.exports = { Dock };
