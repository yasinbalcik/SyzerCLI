# Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajanlar çalışırken dock'ta otomatik canlı harita (ana kutu + model/durum kartları), tur bitince sohbete kalıcı durum raporu; adım sınırına çarpan ajan `⚠ stopped` görünsün.

**Architecture:** `src/agent-tree.js` genişler (durumlar, ortak `card`, `renderPanel`, `summary`, `renderReport`); `src/dock.js` panel modunu `renderPanel` ile çizer; `src/repl.js` tur sonunda `renderReport`'u bir kez yazar. Yeni bağımlılık yok.

**Tech Stack:** Node.js (CommonJS, bağımlılıksız), `node --test`, `src/ui.js` (`C`, `vlen`), mevcut `fit`/`statusColor`/`MARK` yardımcıları `src/agent-tree.js` içinde.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-panel-design.md` (üzerine kurulu: `2026-10-08-agent-tree-design.md`)

## Global Constraints

- Yeni npm bağımlılığı yok. Kod yorumları Türkçe, mevcut stil (tek tırnak, 2 boşluk, `'use strict'`).
- Gösterilen her şey gerçek veri. Her render satırı `vlen(line) <= width` (CJK, uzun etiket, ANSI/OSC/kontrol karakteri içeren ajan metni dahil: mevcut `fit`).
- Panel modu eşiği: `rows ≥ 28` VE `columns ≥ 70` (aksi halde mevcut ağaç satırları). Kart satırı sayısı: `rows ≥ 36` ise 2, aksi halde 1; kart sütunu en çok 3; fazlası için `+N` satırı.
- Durumlar: `queued …` gri · `running ●` turuncu · `done ✓` yeşil · `stopped ⚠` sarı · `failed ✖` kırmızı · `aborted ◌` gri. `outcome` ∈ `'done'|'failed'|'stopped'|'aborted'`; `outcome` yoksa eski `ok` davranışı.
- Render hatası uygulamayı düşürmez (try/catch → eski çizim). Dock tur içinde küçülmez (mevcut davranış).
- Rapor yalnız bu turda ajan çalıştıysa yazılır. TTY değilse düz metin, renksiz, genişlik 80.
- Commit mesajlarında Claude/Co-Authored-By satırı **yok**. `bin/syzer.js` CRLF: Edit aracı ile düzenle; diğer dosyalarda `file` ile satır sonunu kontrol et.
- Testler `npm test` içinde çalışmalı; testlerde `setLang('en')` kullan (varsayılan dil makineye göre değişir).

## Review Focus

- Adım sınırına çarpan ajan `⚠ stopped` olmalı, `✓` değil; iptal edilen `◌ aborted` (hata sayılmaz) (Task 1).
- 0, 1, 7 ve 12 ajan; sığmayan genişlik/yükseklik; satırlar genişliği aşmaz (Task 2).
- Küçük terminal (rows 27 / cols 69) kompakt satırlara düşer, panel modunda `need()` ile çizilen satır sayısı uyumlu, seçim `dock.agents` sırasıyla hizalı (Task 3).
- Ajansız turda rapor yazılmaz; TTY olmayan çıktıda renk/ANSI yok; `/tree` ve iptal (Ctrl+C) hâlâ çalışır (Task 4).
- Model adı boş/çok uzun olan ajan (Task 2).

---

### Task 1: Durumlar — `stopped` / `aborted` ve olay türü

**Files:**
- Modify: `src/agent-tree.js` (`createStore().finish`, `event`, `MARK`/`statusColor`, `trackOut`)
- Modify: `src/subagents.js` (`makeSub().out.warn`, `spawn()` AbortError dalı)
- Modify: `src/i18n-new.js` (en + tr: `tree_stopped`)
- Test: `test/agent-tree.test.js`

**Interfaces:**
- Produces:
  - `store.finish(id, { ok, outcome?, model? })` — `outcome` verilirse `n.status = outcome`; yoksa `ok ? 'done' : 'failed'`.
  - `store.event(text, id?, kind = 'info')`; kayıt `{ t, id, text, kind }`, `kind ∈ 'info'|'warn'`.
  - `run.stopped: boolean`, `run.aborted: boolean` (`subagents.js` `run` kaydı).
  - `trackOut`: `agentDone(id, run)` → `outcome = run.aborted ? 'aborted' : run.stopped ? 'stopped' : run.ok ? 'done' : 'failed'`; `stopped` ve `failed` olayları `kind:'warn'`, `warn(msg)` olayları `kind:'warn'`.

- [ ] **Step 1: Failing testler** (`node:test`, `setLang('en')`):
  - `finish outcome stopped`: `finish(1,{ok:true,outcome:'stopped'})` → `status === 'stopped'`; `finish(2,{ok:true})` → `done`; `finish(3,{ok:false})` → `failed`.
  - `event kind`: `event('x', 1, 'warn')` → log kaydında `kind === 'warn'`; varsayılan `'info'`.
  - `trackOut maps run flags`: `agentDone(1,{ok:true,stopped:true})` → `stopped` + `warn` olayı; `agentDone(2,{ok:false,aborted:true})` → `aborted`, olay metni `aborted`; `agentDone(3,{ok:false,report:'failed: boom'})` → `failed`; `agentDone(4,{ok:true})` → `done`.
  - `trackOut warn kind`: `out.warn('x')` → `kind === 'warn'`.
  - `renderCompact stopped mark`: `stopped` düğüm satırı `⚠`, `aborted` satırı `◌` içerir.
  - subagents: `makeSub(...)` ile `out.warn(t('max_iter'))` çağrılınca `run.stopped === true` (sahte parent/run ile); başka mesaj `run.stopped`'u değiştirmez.

- [ ] **Step 2: Çalıştır, FAIL gör:** `node --test test/agent-tree.test.js`.

- [ ] **Step 3: Uygula.** `MARK`'a `stopped:'⚠'`, `aborted:'◌'`; `statusColor`: stopped sarı (`C.yellow`), aborted gri. `subagents.js`: `out.warn(msg)` içinde `if (run && msg === t('max_iter')) run.stopped = true;` sonra mevcut `po.warn`; `spawn()` catch'inde `if (err.name === 'AbortError') { run.aborted = true; throw err; }` (mevcut rethrow korunur). `trackOut.agentDone` yukarıdaki eşlemeyi yapar; `tree_stopped` metni ('stopped: step limit reached' / 'yarıda kaldı: adım sınırı') stopped olayının metni. CRLF uyarısı: `src/repl.js` ve `src/subagents.js` düzenleme için `file` ile kontrol et.

- [ ] **Step 4: `npm test` PASS gör.**

- [ ] **Step 5: Commit** — `git commit -m "agent panel: stopped/aborted outcomes, event kind"`.

---

### Task 2: Renderer'lar — `card`, `renderPanel`, `summary`, `renderReport`

**Files:**
- Modify: `src/agent-tree.js` (yeni `card`, `renderPanel`, `summary`, `renderReport`; `boxLines` → `card`; `renderCompact` satırlarına model)
- Modify: `src/i18n-new.js` (en + tr: `rep_summary`, `rep_events`, `pn_agents` vb. ihtiyaç duyulan metinler)
- Test: `test/agent-tree.test.js`

**Interfaces:**
- Consumes: Task 1 `outcome` durumları, `snapshot()` (`main`, `nodes`, `log` kayıtlarında `kind`).
- Produces:
  - `card(node, { width, selected = false, now }) → string[]` — 6 satır (yuvarlak üst/alt kenar `╭╮╰╯` + 4 içerik satırı: durum işareti+`kindLabel`, `shortModel(n.model) || '-'` (gri), `act(n) || n.label || '-'`, `stats(n, now)` (gri)); seçiliyse kenar turuncu; her satır `vlen == width`.
  - `summary(snap, now = Date.now()) → { agents, done, stopped, failed, aborted, tokens, secs }` (`secs`: ilk `t0` ile son `t1` (bitmemiş düğüm için `now`) farkı, saniye, sayı).
  - `renderPanel(snap, { width, rows, selected = -1, now }) → string[]` — üstte ana kutu (3 satır: kenar, `main · <model> · <effort> · N agents · X running · Y done · <süre>`, kenar), altında kartlar (≤3 sütun, kart satırı sayısı: `rows ≥ 36` ise 2 yoksa 1; toplam satır ≤ `rows`; sığmayan için son satır `+N …` (`tree_more`)). Düğüm yoksa `[]`.
  - `renderReport(snap, { width, now, color = true }) → string[]` — ana kutu + TÜM kartlar (en çok 9, fazlası `+N`) + özet satırı (`rep_summary`: `3 agents · 2 done · 1 stopped · 24.2k tokens · 1m47s`) + önemli olaylar (`kind==='warn'` kayıtları, en çok 8, `rep_events` başlığı altında `HH:MM:SS metin`); düğüm yoksa `[]`. `color:false` ise hiç ANSI içermez (düz metin).

- [ ] **Step 1: Failing testler:**
  - `card layout`: 6 satır, hepsi `vlen == width`; ilk satır `╭`, son `╰`; içerikte `kind`, kısa model, iş, `adım`/stats; `model` boşsa `-`; 200 karakter / `日本語`×40 etiket, ESC/BEL içeren label → ham ESC yok, genişlik korunur.
  - `summary counts`: karışık durumlu 5 düğümle sayılar, token toplamı (`1500+300` → `1800`), `secs`; boş snapshot → `agents:0`.
  - `renderPanel sizes`: 1, 3 ve 7 ajan; width 70 ve 100; `rows 28` → kart satırı 1 (7 ajan: 3 kart + `+4`), `rows 36` → 2 satır (6 kart + `+1`); toplam satır ≤ rows; hiçbir satır `vlen > width`; boş snapshot → `[]`.
  - `renderPanel header`: ana kutuda `main`, model adı, `running`/`done` sayıları.
  - `renderReport`: özet satırı metni (`2 done · 1 stopped`), yalnız `warn` olaylar listede, `info` olaylar yok, 12 ajanda en çok 9 kart + `+3`, `color:false` → `/\x1b/` yok; boş → `[]`.
  - `renderCompact model`: satırda kısa model adı görünür; `stopped` düğüm `⚠`.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: Uygula** (imzalar yukarıda). `boxLines` yerine `card` kullan (`renderTree` aynı görünümde kalır; mevcut `renderTree` testleri `┌` yerine `╭` bekleyecek şekilde güncellenir — bu değişiklik kasıtlı). Kart sütun genişliği: `floor((width - gap*(cols-1)) / cols)`, gap 1. Renkler `statusColor` ile; `color:false` yolunda `C` yerine düz metin yardımcısı. Süre biçimi mevcut `fmtDur`. Yeni metinler `t()` anahtarları (en + tr; diğer diller en'e düşer).

- [ ] **Step 4: `npm test` PASS gör** (güncellenen `renderTree` testleri dahil).

- [ ] **Step 5: Commit** — `git commit -m "agent panel: card/panel/report renderers and summary"`.

---

### Task 3: Dock panel modu

**Files:**
- Modify: `src/dock.js` (`need()`, `draw()` ajan bloğu, `panelMode()`)
- Test: `test/dock-tree.test.js`

**Interfaces:**
- Consumes: `renderPanel(snap, { width, rows, selected, now })`, `renderCompact`, `dock.getTree`, `dock.agents`, `dock.sel`.
- Produces: `dock.panelMode() → boolean` (= `this.agents.length > 0 && this.out.rows >= 28 && this.out.columns >= 70`); `need()` panel modunda `4 + (queue?1:0) + panelHeight` (`panelHeight = renderPanel` satır sayısı hesabı: ana kutu 3 + kart satırları + `+N`; hesaplama `renderPanel`'in çıktısından değil, `agents.length` ve `rows`'tan: `3 + 6*cardRows + (agents.length > 3*cardRows ? 1 : 0)`); panel dışında mevcut formül aynen.

- [ ] **Step 1: Failing testler** (sahte `out`, `begin()` çağrılmaz, zamanlayıcı yok):
  - `panel mode threshold`: `rows 27` → `panelMode() === false`, `rows 28`/`columns 69` → false, `rows 28`/`columns 70` + 1 ajan → true.
  - `need grows in panel mode`: 3 ajan, rows 30 → `need() === 4 + 3 + 6 = 13` (ana kutu 3 + 1 kart satırı 6, `+N` yok); rows 36 + 7 ajan → `need() === 4 + 3 + 12 + 1`.
  - `draw panel`: panel modunda çıktı `╭` ve modeli içerir, eski `├`/`└` satırları yok; `rows 27` aynı durumda `├`/`└` içerir.
  - `draw panel selection`: `sel = 2` → ikinci kartın kenarı seçili (turuncu ANSI) ve diğerleri değil.
  - `getTree throws` → panel yerine eski satırlar, `draw()` throw etmez.
  - Mevcut dock-tree testleri (compact, +N, sel) yeşil kalır.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: Uygula.** `draw()`: ajan bloğunda önce `panelMode()` ise `renderPanel(snap(dock.agents id sırasıyla süzülmüş), { width: cols - 2, rows: this.h - (4 + (queue?1:0)), selected: this.sel - 1, now })` satırlarını ekle (hint satırı panel modunda da kalır); try/catch ile eski yola dön. `need()` yukarıdaki formülü kullanır; `grow()` mevcut. Seçili kart: `renderPanel` `selected` ile kart kenarını turuncu yapar (Task 2). Elle doğrulama notu (Step 5, brief'te): interaktif TUI sürülemiyorsa raporda açıkça belirt.

- [ ] **Step 4: `npm test` PASS gör.**

- [ ] **Step 5: Commit** — `git commit -m "agent panel: dock live panel mode"`.

---

### Task 4: Bitiş raporu, i18n, belgeler, sürüm

**Files:**
- Modify: `src/repl.js` (`chat()` — tur sonunda rapor)
- Modify: `src/i18n-new.js` (kalan anahtarların tr çevirisi/doğrulama)
- Modify: `README.md`, `README.en.md` (panel ve rapor)
- Modify: `package.json`, `package-lock.json` (sürüm `3.22.0`, iki alan)
- Test: `test/agent-tree.test.js` (rapor koşulu yardımcısı) ve gerekirse `test/dock-tree.test.js`

**Interfaces:**
- Consumes: `renderReport(snap, { width, now, color })`, `s.out.getTree()`.
- Produces: `src/agent-tree.js` içinde `reportLines(snap, { isTTY, columns }) → string[]` (TTY ise `renderReport(snap, { width: columns - 2, color: true })`, değilse `renderReport(snap, { width: 80, color: false })`; ajan yoksa `[]`), `repl.js`'te `chat()` içinde `closeDock()` sonrası, `ctx` özet satırından ÖNCE `reportLines(s.out.getTree(), { isTTY: process.stdout.isTTY, columns: process.stdout.columns || 100 }).forEach((l) => console.log(l))`; hata yakalanır (try/catch, sessiz).

- [ ] **Step 1: Failing testler:**
  - `reportLines tty`: ajanlı snapshot, `isTTY:true, columns:100` → boş değil, ANSI içerir, her satır ≤ 98; `isTTY:false` → `/\x1b/` yok, satırlar ≤ 80; ajansız → `[]`.
  - i18n: yeni anahtarlar (`tree_stopped`, `rep_summary`, `rep_events`, kullanılan `pn_*`) `en` ve `tr` için boş değil, anahtar adına eşit değil, `tr ≠ en`; `de` en'e düşer.
  - `npm test` betiği tüm test dosyalarını listeler.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: Uygula** `reportLines` + `repl.js` çağrısı (CRLF kontrolü); iptal (`AbortError`) yolunda da rapor yazılır (catch'te `closeDock()` sonrası aynı çağrı, ajan varsa); README: panel ve bitiş raporu kısa açıklaması (TR + EN); sürüm 3.22.0 (iki alan).

- [ ] **Step 4: `npm test` PASS gör.**

- [ ] **Step 5: Commit** — `git commit -m "3.22.0: agent panel (live map + final report)"`. Tag/release **ayrı onayla**.

---

## Self-review notları

- Spec kapsamı: durumlar + `stopped` tespiti → Task 1; `card/renderPanel/summary/renderReport` + compact model → Task 2; dock panel modu + eşikler + seçim → Task 3; rapor + TTY dışı düz metin + i18n + README + sürüm → Task 4; `/tree` ortak `card` kullanımı → Task 2 (`boxLines` → `card`).
- Spec'ten kasıtlı ayrıntı: kart 6 satır (4 içerik + 2 kenar); panel yüksekliği `3 + 6*cardRows (+1)`; 28–35 satırda 1 kart satırı, ≥ 36'da 2 (spec'in "~12–15" tahmini yerine bu kural esas).
- Tip tutarlılığı: `outcome` değerleri, `kind` olay alanı, `card/renderPanel/renderReport/summary/reportLines` imzaları görevler arasında aynı.
