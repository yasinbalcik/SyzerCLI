'use strict';

// Alt "dock": ajan çalışırken terminalin altında sabit kalan alan.
//   durum satırı · sıradaki mesajlar · giriş satırı · alt ajan listesi (main + çalışan ajanlar)
// Normal çıktı kaydırma bölgesinde (üstte) akmaya devam eder; kullanıcı yeni mesajı yazıp sıraya koyabilir.
// Alt ajan listesi: giriş boşken ↓ / ← ile listeye geç, ↑↓ ile seç, Enter ile ajanın CANLI içeriğini aç (tam ekran), Esc/← ile dön.
const { C, vlen, trunc } = require('./ui');
const { renderCompact, renderTree, renderPanel, panelHeight, panelHits } = require('./agent-tree');
const { t } = require('./i18n');

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ESC = '\x1b';
const NL = String.fromCharCode(10);

const fmtTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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
    this.agents = []; // [{ id, no, kind, label, t0, steps, tokens }]
    this.getRun = null; // (id) => canlı çalışma kaydı
    this.getTree = null; // () => ağaç snapshot (yoksa eski satırlar)
    this.getTreeCount = null; // () => düğüm sayısı (kopyasız, need() için)
    this.live = null; // (line) => Promise: /run, /runs tur sürerken hemen çalışır
    this.sel = -1; // -1: giriş odakta · 0: main · 1..n: ajan
    this.viewing = null; // { kind: 'agent'|'tree', id?, scroll, sel? }
    this.paused = false;
    this.h = 0;
    this.frame = 0;
    this.top = 1; // kayan bölgenin ilk satırı (sabit başlık varsa 1'den büyük)
    this.floor = 0; // en az bu kadar alt satır ayır
    this.reserve = 0; // dock kapanınca alt kutu için ayrılan satırlar
    this.footer = null; // () => son satır metni
    this.hits = []; // tıklanabilir alt ajan alanları (mutlak satır)
    this.onAltExit = null; // tam ekran modunda: görünümden dönünce ekranı yeniden kur
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

  panelMode() { return this.agents.length > 0 && this.out.rows >= 28 && this.out.columns >= 70; }

  totalNodes() {
    try {
      if (this.getTreeCount) { const c = this.getTreeCount(); if (Number.isFinite(c)) return c; }
      const s = this.getTree && this.getTree();
      if (s && Array.isArray(s.nodes)) return s.nodes.length;
    } catch { /* önemsiz */ }
    return this.agents.length;
  }

  need() {
    const base = 4 + (this.queue.length ? 1 : 0);
    // Bitmiş kartlar da panelde kalır: mağazadaki düğüm sayısı ile çalışan ajan sayısından büyüğü ayrılır (yeni düğüm henüz depoda olmayabilir)
    if (this.panelMode()) return Math.max(this.floor, base + panelHeight(Math.max(this.agents.length, this.totalNodes()), this.out.rows));
    return Math.max(this.floor, base + (this.agents.length ? 1 + Math.min(this.agents.length, 6) + 1 : 0));
  }

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
      this.out.write(`${ESC}[${this.rows};1H${NL.repeat(row - bottom)}`);
      row = bottom;
    }
    this.out.write(`${ESC}[${this.top};${bottom}r${ESC}[${row};${pos.col}H${ESC}[?25l`);
    this.active = true;
    this.sel = -1;
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
        this.out.write(`${ESC}[${oldBottom};1H${NL.repeat(row - newBottom)}`);
        row = newBottom;
      }
      this.out.write(`${ESC}[${this.top};${newBottom}r${ESC}[${row};${col}H`);
      this.h = want;
    } finally { this.growing = false; }
  }

  setStatus(label) { this.status = label ? { label, start: this.status && this.status.label === label ? this.status.start : Date.now() } : null; if (!label) { this.detail = ''; this.meta = ''; } }
  setStatusLabel(label) { if (this.status && label) this.status.label = label; }
  setDetail(d) { this.detail = d; }
  setMeta(m) { this.meta = m; }
  setAgents(list) {
    this.agents = list;
    if (this.sel > list.length) this.sel = list.length ? list.length : -1;
    if (this.need() > this.h) this.grow();
  }
  pause(on) { this.paused = on; }

  // Düzenleyici kullanıcı mesajını gönderdi
  submit(result) {
    const line = String(result.text || '').trim();
    if (this.live && /^\/(runs?|tree)(\s|$)/.test(line)) { // alt ajanı incele: tur sürerken hemen çalışır
      Promise.resolve(this.live(line)).catch(() => {}).then(() => this.draw());
      return;
    }
    this.queue.push(result);
    if (this.need() > this.h) this.grow();
    this.draw();
  }

  // Fare tıklaması: bir alt ajan kartına/satırına tıklanınca canlı görünümünü aç
  click(row, col) {
    if (!this.active || this.viewing) return false;
    const h = (this.hits || []).find((x) => row >= x.row && row < x.row + (x.rows || 1) && col >= (x.c1 || 1) && col <= (x.c2 || 9999));
    const a = h && this.agents.find((x) => x.id === h.id);
    if (!a) return false;
    this.openView(a);
    return true;
  }

  // Klavye: true dönerse tuş tüketildi
  handleKey(str, key = {}) {
    if (this.viewing && this.viewing.kind === 'tree') {
      const v = this.viewing;
      switch (key.name) {
        case 'escape': case 'left': case 'q': this.closeView(); return true;
        case 'up': v.sel = this.agents.length ? Math.max(0, Math.min(v.sel, this.agents.length - 1) - 1) : -1; this.drawView(); return true;
        case 'down': v.sel = Math.min(this.agents.length - 1, v.sel + 1); this.drawView(); return true;
        case 'return': case 'enter': case 'right':
          if (this.agents[v.sel]) this.openView(this.agents[v.sel]);
          return true;
        default:
          if (key.ctrl && key.name === 'c') { this.closeView(); return false; }
          return true;
      }
    }
    if (this.viewing) {
      switch (key.name) {
        case 'escape': case 'left': case 'q': this.closeView(); return true;
        case 'up': this.viewing.scroll += 1; this.drawView(); return true;
        case 'down': this.viewing.scroll = Math.max(0, this.viewing.scroll - 1); this.drawView(); return true;
        case 'pageup': this.viewing.scroll += 10; this.drawView(); return true;
        case 'pagedown': this.viewing.scroll = Math.max(0, this.viewing.scroll - 10); this.drawView(); return true;
        case 'end': this.viewing.scroll = 0; this.drawView(); return true;
        default:
          if (key.ctrl && key.name === 'c') { this.closeView(); return false; }
          return true;
      }
    }
    if (!this.agents.length) { this.sel = -1; return false; }
    if (this.sel >= 0) { // liste odakta
      switch (key.name) {
        case 'up': this.sel = Math.max(0, this.sel - 1); this.draw(); return true;
        case 'down': this.sel = Math.min(this.agents.length, this.sel + 1); this.draw(); return true;
        case 'escape': case 'left': this.sel = -1; this.draw(); return true;
        case 'return': case 'enter': case 'right':
          if (this.sel === 0) this.sel = -1; else this.openView(this.agents[this.sel - 1]);
          this.draw();
          return true;
        default:
          if (key.ctrl && key.name === 'c') { this.sel = -1; return false; }
          if (str && str >= ' ') { this.sel = -1; return false; } // yazmaya devam: odak girişe döner
          return true;
      }
    }
    if (!this.editor.items.length && (key.name === 'down' || key.name === 'left')) { this.sel = 1; this.draw(); return true; }
    return false;
  }

  // ---------- canlı ajan görünümü (alternatif ekran) ----------
  // alternatif ekrana geç + ana çıktıyı tamponla (ajan ve ağaç görünümü paylaşır)
  enterAlt() {
    this._buf = [];
    this._origOut = this.out.write.bind(this.out);
    this._origErr = process.stderr.write.bind(process.stderr);
    const hold = (orig) => (chunk, enc, cb) => { this._buf.push([orig, chunk, enc]); if (typeof enc === 'function') enc(); else if (typeof cb === 'function') cb(); return true; };
    this.out.write = hold(this._origOut);
    process.stderr.write = hold(this._origErr);
    this._origOut(`${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?25l`);
  }

  openView(agent) {
    if (!agent) return;
    const inAlt = !!(this.viewing && this._origOut); // ağaçtan geçiş: alt ekran ve tampon aynen kalır
    clearInterval(this.viewTimer);
    this.viewing = { kind: 'agent', id: agent.id, scroll: 0 };
    if (!inAlt) this.enterAlt(); else this._origOut(`${ESC}[2J${ESC}[H`);
    this.viewTimer = setInterval(() => this.drawView(), 400);
    this.drawView();
  }

  openTree() {
    if (this.viewing) return;
    this.viewing = { kind: 'tree', scroll: 0, sel: this.agents.length ? 0 : -1 };
    this.enterAlt();
    this.viewTimer = setInterval(() => this.drawView(), 1000);
    this.drawView();
  }

  treeSnap() {
    try { const s = this.getTree && this.getTree(); if (s && Array.isArray(s.nodes)) return s; } catch { /* önemsiz */ }
    return { main: {}, nodes: [], log: [] };
  }

  closeView() {
    if (!this.viewing) return;
    clearInterval(this.viewTimer);
    this.viewing = null;
    const orig = this._origOut;
    this._origOut = null;
    this.out.write = orig;
    process.stderr.write = this._origErr;
    const bottom = this.rows - this.h;
    if (this.onAltExit) { // zaten alternatif ekrandayız: taze alt ekran aç, düzeni yeniden kur
      orig(`${ESC}[?1049l${ESC}[?1049h${ESC}[?1007l`);
      try { this.onAltExit(); } catch { /* önemsiz */ }
      orig(`${ESC}[?25l`);
    } else orig(`${ESC}[?1049l${ESC}7${ESC}[${this.top};${bottom}r${ESC}8${ESC}[?25l`);
    for (const [fn, chunk, enc] of this._buf) { try { fn(chunk, typeof enc === 'string' ? enc : undefined); } catch { /* önemsiz */ } }
    this._buf = [];
    this.draw();
  }

  viewLines(width, rows = 40) {
    if (this.viewing.kind === 'tree') {
      const snap = this.treeSnap();
      const ag = this.agents[this.viewing.sel];
      const selected = ag ? snap.nodes.findIndex((n) => n.id === ag.id) : -1;
      return renderTree(snap, { width, rows, selected, now: Date.now() });
    }
    const a = this.agents.find((x) => x.id === this.viewing.id);
    const run = this.getRun ? this.getRun(this.viewing.id) : null;
    const lines = [];
    const wrap = (text, indent = '') => {
      for (const raw of String(text).split(NL)) {
        let l = raw;
        if (!l) { lines.push(''); continue; }
        while (vlen(l) > width - indent.length) { lines.push(indent + l.slice(0, width - indent.length)); l = l.slice(width - indent.length); }
        lines.push(indent + l);
      }
    };
    const secs = a ? Math.floor((Date.now() - a.t0) / 1000) : (run && run.secs) || '?';
    const done = !a;
    lines.push(`${C.bold(run ? run.agent : '?')}  ${run ? run.label : ''}  ${C.gray(`${secs}s · ↓ ${fmtTok(a ? a.tokens : 0)} tokens${done ? ' · bitti' : ''}`)}`);
    lines.push(C.gray('─'.repeat(Math.max(10, width))));
    if (run) {
      lines.push(C.cyan('Görev'));
      wrap(String(run.prompt || ''), '  ');
      lines.push('');
      (run.steps || []).forEach((st, i) => {
        lines.push(`${C.gray(`${String(i + 1).padStart(2)}.`)} ${C.cyan(st.tool)}${C.gray(`(${trunc(String(st.summary || '').replace(/\s+/g, ' '), Math.max(20, width - 14))})`)}`);
        if (st.result) lines.push(`    ${st.ok === false ? C.red('⎿') : C.gray('⎿')} ${C.gray(trunc(String(st.result).replace(/\s+/g, ' '), Math.max(20, width - 8)))}`);
      });
      if (run.live) { lines.push(''); lines.push(C.cyan('Canlı çıktı')); wrap(run.live.slice(-3000), '  '); }
      if (run.report) { lines.push(''); lines.push(C.cyan('Rapor')); wrap(run.report, '  '); }
    }
    return lines;
  }

  drawView() {
    if (!this.viewing || !this._origOut) return;
    const cols = this.out.columns || 80;
    const rows = this.out.rows || 24;
    const room = rows - 2;
    const tree = this.viewing.kind === 'tree';
    if (tree) this.viewing.sel = Math.min(this.viewing.sel, this.agents.length - 1);
    let all;
    try { all = this.viewLines(cols - 2, room); } catch { all = []; }
    if (tree) all = all.slice(0, room);
    const maxScroll = Math.max(0, all.length - room);
    this.viewing.scroll = Math.min(this.viewing.scroll, maxScroll);
    const start = Math.max(0, all.length - room - this.viewing.scroll);
    const body = all.slice(start, start + room);
    let s = `${ESC}[H`;
    for (let i = 0; i < room; i++) s += `${ESC}[2K${body[i] || ''}${i < room - 1 ? NL : ''}`;
    const hint = tree ? t('tree_hint') : `esc/← geri · ↑↓ kaydır · end: sona git${this.viewing.scroll ? `  (${this.viewing.scroll} satır yukarıda)` : ''}`;
    s += `${ESC}[${rows};1H${ESC}[2K${C.gray(hint)}`;
    this._origOut(s);
  }

  inputLine(width) {
    const items = this.editor.items;
    const cur = this.editor.cur;
    const label = (it) => (typeof it === 'string' ? (it === '\n' ? '↵' : it) : C.cyan(it.label));
    const plain = (it) => (typeof it === 'string' ? (it === '\n' ? '↵' : it) : it.label);
    const room = Math.max(8, width - 4);
    let start = 0;
    let w = items.slice(0, cur).reduce((a, it) => a + vlen(plain(it)), 0);
    while (w > room - 2 && start < cur) { w -= vlen(plain(items[start])); start++; }
    let shown = '';
    let used = 0;
    for (let i = start; i < items.length; i++) {
      const tw = vlen(plain(items[i]));
      if (used + tw > room) break;
      if (i === cur && this.sel < 0) shown += `${ESC}[7m ${ESC}[27m`;
      shown += label(items[i]);
      used += tw;
    }
    if (cur >= items.length && this.sel < 0) shown += `${ESC}[7m ${ESC}[27m`;
    return `${C.orange('❯')} ${shown}`;
  }

  draw() {
    if (!this.active || this.growing || this.viewing) return;
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
    if (this.queue.length) lines.push(C.gray(`  ⏎ ${this.queue.length} mesaj sırada: `) + C.dim(trunc((this.queue[0].display || this.queue[0].text || '').replace(/\s+/g, ' '), Math.max(10, cols - 28))));
    // giriş kutusu
    lines.push(C.gray('─'.repeat(Math.max(10, cols - 1))));
    lines.push(this.inputLine(cols));
    // alt ajan listesi (Claude Code gibi): main + çalışanlar
    if (this.agents.length) {
      const hint = this.sel >= 0 ? 'enter: içine gir · esc: geri' : '↓ ajanlar · /run <no>';
      lines.push(C.gray(`${'─'.repeat(Math.max(4, cols - 4 - hint.length - 3))} ${hint} ──`));
      const mark = (i) => (this.sel === i ? C.orange('❯') : ' ');
      let treeRows = null;
      let panelRows = null;
      let snapRef = null;
      this.hits = [];
      try {
        if (this.getTree) {
          const snap = this.getTree();
          snapRef = snap;
          const nodes = this.agents.map((a) => snap.nodes.find((n) => n.id === a.id && (n.status === 'queued' || n.status === 'running')));
          if (nodes.every(Boolean) && this.panelMode()) {
            try {
              const sa = this.sel > 0 && this.agents[this.sel - 1] ? snap.nodes.findIndex((n) => n.id === this.agents[this.sel - 1].id) : -1;
              panelRows = renderPanel(snap, { width: cols - 2, layoutRows: this.out.rows, rows: this.h -(4 + (this.queue.length ? 1 : 0)), selected: sa, now: Date.now() });
            } catch { panelRows = null; }
          }
          if (!panelRows && nodes.every(Boolean)) treeRows = renderCompact({ ...snap, nodes }, { width: cols - 4, selected: this.sel - 1, now: Date.now() });
        }
      } catch { treeRows = null; }
      const shownAgents = Math.min(this.agents.length, 6);
      if (panelRows) {
        const at = lines.length;
        lines.push(...panelRows);
        try { this.hits = panelHits(snapRef, { width: cols - 2, layoutRows: this.out.rows }).map((h) => ({ ...h, row: top + at + h.row })); } catch { this.hits = []; }
      } else if (treeRows) {
        const at = lines.length;
        treeRows.forEach((r, i) => { lines.push(` ${i <= shownAgents ? mark(i) : ' '} ${r}`); if (i >= 1 && this.agents[i - 1]) this.hits.push({ id: this.agents[i - 1].id, row: top + at + i, rows: 1, c1: 1, c2: 9999 }); });
      }
      else {
        lines.push(` ${mark(0)} ${this.sel === 0 ? C.bold('● main') : '● main'}`);
        this.agents.slice(0, 6).forEach((a, i) => {
          const secs = Math.floor((Date.now() - a.t0) / 1000);
          const right = C.gray(`${secs}s · ↓ ${fmtTok(a.tokens)} tokens`);
          const left = `${a.no ? C.orange(`#${a.no} `) : ''}${C.gray('○')} ${this.sel === i + 1 ? C.bold(a.kind) : a.kind}  ${C.gray(a.label)}`;
          const room = Math.max(10, cols - vlen(right) - 6);
          let l = left;
          while (vlen(l) > room) l = l.slice(0, -1);
          lines.push(` ${mark(i + 1)} ${l}${' '.repeat(Math.max(1, cols - 4 - vlen(l) - vlen(right)))}${right}`);
        });
      }
    }
    while (lines.length < this.h) lines.push('');
    if (this.footer && this.h >= 5 && !lines[this.h - 1] && this.h === this.floor) { try { lines[this.h - 1] = this.footer(); } catch { /* önemsiz */ } }
    let s = `${ESC}7`;
    lines.slice(0, this.h).forEach((l, i) => { s += `${ESC}[${top + i};1H${ESC}[2K${l}`; });
    s += `${ESC}8`;
    this.out.write(s);
  }

  end() {
    if (!this.active) return;
    if (this.viewing) this.closeView();
    clearInterval(this.timer);
    const top = this.rows - this.h + 1;
    let s = `${ESC}7`;
    for (let i = 0; i < this.h; i++) s += `${ESC}[${top + i};1H${ESC}[2K`;
    s += (this.reserve ? `${ESC}[${this.top};${this.rows - this.reserve}r` : `${ESC}[r`) + `${ESC}8${ESC}[?25h`;
    this.out.write(s);
    this.active = false;
    this.editor.dock = null;
    this.editor.carry = this.editor.items.length ? this.editor.items : null; // yazılmış ama gönderilmemiş metin sonraki istemde kalsın
    this.editor.items = [];
    this.editor.cur = 0;
    this.editor.useHistory = this.savedHistory;
    this.editor.mode = 'idle';
    this.status = null; this.detail = ''; this.meta = ''; this.agents = []; this.sel = -1;
    this.h = 0;
    this.out.write(NL); // çıktı dock satırlarının üstünde yeni satırdan devam etsin
  }
}

module.exports = { Dock };
