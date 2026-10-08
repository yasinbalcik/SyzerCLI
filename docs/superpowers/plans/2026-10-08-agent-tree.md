# Agent Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ana oturum + alt ajanların orkestrasyonunu dock'ta küçük canlı ağaç ve `/tree` haritası (olay günlüğüyle) olarak göstermek.

**Architecture:** Yeni saf modül `src/agent-tree.js` (olay deposu + render fonksiyonları). `makeOut()` çıktısı `trackOut()` ile sarılarak mevcut `agentStart/Update/Done/warn` olaylarından store'u besler; `dock.js` satırları `renderCompact`, `/tree` ekranı `renderTree` ile çizer. Yeni bağımlılık yok.

**Tech Stack:** Node.js (CommonJS, bağımlılıksız), `node --test`, mevcut `src/ui.js` (`C`, `vlen`, `trunc`).

**Spec:** `docs/superpowers/specs/2026-10-08-agent-tree-design.md`

## Global Constraints

- Yeni npm bağımlılığı yok (proje bağımlılıksız).
- Kod yorumları Türkçe, mevcut dosya stiliyle (tek tırnak, 2 boşluk, `'use strict'`).
- Gösterilen her şey gerçek veri; sahte metrik yok.
- `/tree` ve dock: TTY yok / `SYZER_NO_DOCK` / <16 satır → dock zaten kapalı, `/tree` düz metin basar.
- Render hatası uygulamayı düşürmez (try/catch → eski çizim).
- Olay günlüğü en fazla 200 kayıt. Dock'ta en fazla 6 ajan satırı.
- Commit mesajlarında Claude/Co-Authored-By satırı **yok** (kullanıcı kuralı).
- Testler `npm test` içinde çalışmalı (`package.json` test betiğine eklenir).
- `bin/syzer.js` CRLF satır sonlu: bu dosyayı Edit aracıyla düzenle (toplu string replace tutmaz).

## Review Focus

- Hata veren ajan: `✖` işareti, günlükte hata satırı (Task 1, 2).
- Hiç ajan yokken `/tree`: "henüz alt ajan yok" mesajı, çökme yok (Task 1, 4).
- 10+ ajan ve çok uzun/CJK etiket: sütun taşması yok, satır genişliği aşılmaz (Task 1).
- Çok dar terminal (<40 sütun): dikey liste, satırlar genişliği aşmaz (Task 1).
- Sayı id'li ajan ile `w<hex>` id'li Orca işçisi çakışmaz; yeni turda eski düğümler temizlenir (Task 1, 2).

---

### Task 1: Saf modül `agent-tree.js` (store + render)

**Files:**
- Create: `src/agent-tree.js`
- Create: `test/agent-tree.test.js`
- Modify: `package.json` (`scripts.test`: `test/agent-tree.test.js` ekle)

**Interfaces:**
- Produces:
  - `createStore(now = Date.now) → store`
  - `store.setMain({ model: string, effort: string })`
  - `store.newTurn()` — düğümleri temizler, günlüğü korur
  - `store.start(id: number|string, { kind: string, label: string, orca?: boolean })` → durum `queued`
  - `store.run(id)` → `running`
  - `store.update(id, { action?: string, steps?: number, tokens?: number })`
  - `store.finish(id, { ok: boolean, model?: string })` → `done` | `failed`, `t1` = now
  - `store.event(text: string, id?: number|string)` → günlük `{ t, id, text }`, en çok 200
  - `store.snapshot() → { main: {model, effort}, nodes: Node[], log: Event[] }`
  - `Node = { id, kind, label, orca, status, action, steps, tokens, model, t0, t1 }`
  - `renderTree(snap, { width, rows, selected = -1, now }) → string[]` (ANSI, her satır `vlen <= width`)
  - `renderCompact(snap, { width, selected = -1, now, max = 6 }) → string[]` (ilk satır main, sonra ≤ `max` ajan satırı)
  - `trackOut(out, store) → out` (Task 2'de uygulanır)

- [ ] **Step 1: Failing testleri yaz** (`test/agent-tree.test.js`): `node:test` + `assert/strict`; genişlik için `ui.vlen`; metin için `setLang('en')`. Testler:
  - `store lifecycle`: start → `queued`, run → `running`, update → alanlar, finish(ok:true) → `done`, finish(ok:false) → `failed`.
  - `newTurn clears nodes but keeps log`.
  - `log is capped at 200`: 250 event → `snapshot().log.length === 200`, son kayıt metni 249.
  - `renderCompact marks statuses`: queued `…`, running `●`, done `✓`, failed `✖`; satırlar `├`/`└`; ilk satır `main`; 8 ajanda 6 satır + `+2` özeti.
  - `renderTree wide`: width 100 → birden çok sütunda kutu (`┌`), her satır `vlen <= 100`; kutuda kind ve kısa model görünür.
  - `renderTree narrow`: width 36 → kutu yok (`┌` yok), dikey ağaç, her satır `vlen <= 36`.
  - `renderTree empty`: nodes boş → çıktı `no subagents yet` içerir, throw yok.
  - `renderTree long label`: 200 karakterlik ve `日本語`×40 etiket → hiçbir satır genişliği aşmaz.
  - `renderTree log tail`: 10 ajan + `rows: 20` → toplam satır ≤ 20; günlüğün yalnız son kayıtları görünür.
  - `orca node label`: `orca:true` → çıktı `Orca` içerir.

- [ ] **Step 2: Çalıştır, FAIL gör:** `node --test test/agent-tree.test.js` → "Cannot find module '../src/agent-tree'".

- [ ] **Step 3: `src/agent-tree.js` yaz.** Düzen: genişlik ≥ 70 → ana kutu üstte, ajan kutuları `Math.min(3, nodes.length)` sütun (kutu genişliği `floor((width-2)/cols)-1`), sığmayan alt satıra sarar; < 70 → dikey `├ └` listesi. Kutu: `kind` (Orca ise `kind · Orca`), kısa model (`split('/').pop().replace(':free','')`), `action` (trunc), `adım · token · süre`, durum işareti. Süre: `t1` varsa `t1-t0`, yoksa `now-t0`. Günlük satırı `HH:MM:SS kind metin`; harita satırlarından kalan `rows` kadarına sığan son kayıtlar; `selected` düğüm vurgulanır. Tüm satırlar `trunc`/`vlen` ile `width`'e sığdırılır. `renderCompact`: `max`'ı aşan ajanlar için son satır `+N …`. Metinler `t()` ile (anahtarlar Task 5'te eklenir; o ana kadar İngilizce yedek metin kullan).

- [ ] **Step 4: Testi çalıştır, PASS gör:** `node --test test/agent-tree.test.js`.

- [ ] **Step 5: Commit** — `git add src/agent-tree.js test/agent-tree.test.js package.json` → `git commit -m "agent tree: pure store + renderers"`.

---

### Task 2: Store'u mevcut olaylara bağla

**Files:**
- Modify: `src/agent-tree.js` (`trackOut` gövdesi)
- Modify: `src/subagents.js` (`spawn()`: `limited(...)` callback'inin başında `po.agentRun`; `sub.out.tool()` içindeki `agentUpdate` çağrısına 4. argüman `tokens`)
- Modify: `src/repl.js` (`const dock = new Dock…` yakınında `s.tree`; `s.out` `trackOut` ile sarılır; her kullanıcı turu başında `newTurn` + `setMain`)
- Test: `test/agent-tree.test.js`

**Interfaces:**
- Consumes: Task 1 `createStore`, `trackOut`.
- Produces: `out.agentRun(id)`; `out.agentUpdate(id, action, steps, tokens?)`; `out.agentDone(id, run?)` (`run = { ok, model, secs, report }`); `s.tree` store'u; `s.out.getTree()` → snapshot.

- [ ] **Step 1: Failing testler ekle:** sahte `out` (`agentStart/agentUpdate/agentDone/warn` boş fonksiyonlar) + store ile `trackOut`:
  - `trackOut feeds start/update/done`: `agentStart(1,'explorer: x')` → node `kind:'explorer'`, `label:'x'`, `queued`; `agentRun(1)` → `running`; `agentUpdate(1,'Read(a)',2,100)` → steps 2, tokens 100, action; `agentDone(1,{ok:true,model:'m/x:free'})` → `done`, model `x`.
  - `failed run`: `agentDone(2,{ok:false,report:'failed: boom'})` → `failed`, günlükte `boom`.
  - `warn goes to log`: `out.warn('switching key')` → günlükte metin.
  - `orca id`: `agentStart('wab12','worker: Syzer: t')` → `orca:true`; `agentStart(3,'worker: t')` → `orca:false`.
  - `wrapped originals still called`: orijinal `agentStart` çağrıldı.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: `trackOut(out, store)` uygula:** `agentStart/agentUpdate/agentDone/warn` orijinallerini saklayıp çağırır, ardından store'a yazar; `out.agentRun = (id) => store.run(id)` ekler; günlük olayları: başladı / bitti / `hata: <report ilk satırı>` / warn metni. `kind` = etiketin `:` öncesi, `label` = sonrası.

- [ ] **Step 4: `subagents.js` değişikliği:** `po.agentRun && po.agentRun(id)` (kapıya girerken); `sub.out.tool()` içinde `po.agentUpdate(id, action, steps, Math.round(run.chars / 4))`.

- [ ] **Step 5: `repl.js` bağla:** `const tree = createStore(); s.tree = tree; trackOut(s.out, tree); s.out.getTree = () => tree.snapshot();`; kullanıcı turu başlangıcında (`chat` içinde) `tree.newTurn(); tree.setMain({ model: s.model, effort: s.effort })`.

- [ ] **Step 6: `npm test` PASS gör.**

- [ ] **Step 7: Commit** — `git commit -m "agent tree: feed store from agent events (queued/running/done, warn log)"`.

---

### Task 3: Dock'ta ağaç satırları

**Files:**
- Modify: `src/dock.js` (`draw()` ajan listesi bölümü; `getTree` alanı)
- Modify: `src/repl.js` (`dock.getTree = () => s.out.getTree()`)
- Test: `test/dock-tree.test.js` (yeni; `package.json` test betiğine ekle)

**Interfaces:**
- Consumes: `renderCompact(snap, { width, selected, now, max })`; `dock.agents`, `dock.sel` (0 = main, 1..n = ajan).
- Produces: `dock.getTree: () => snapshot` (yoksa eski çizim kullanılır).

- [ ] **Step 1: Failing test:** sahte `out` (`isTTY:true, columns:100, rows:30, write(s){buf+=s}`) ve `in` ile `new Dock(...)`; `active=true; rows=30; h=need()`, `agents=[{id:1,no:1,kind:'explorer',label:'x',t0:Date.now(),steps:1,tokens:0}]`; `getTree` 1 running düğümlü sahte snapshot döndürsün. `draw()` → çıktı `explorer` ve `├`/`└` içerir. Ayrıca `getTree` throw ederse `draw()` throw etmez ve eski `○` satırını çizer.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: `draw()` değiştir:** `this.agents.length` bloğunda `try { rows = renderCompact(aktifSnap, { width: cols, selected: this.sel, now: Date.now() }) } catch { rows = null }`; `rows` varsa hint satırından sonra bunları ekle (`sel` vurgusu `❯`), yoksa mevcut kod yolu aynen çalışır. `aktifSnap`: yalnız `queued`/`running` düğümler. `need()` değişmez.

- [ ] **Step 4: Testler PASS** (`npm test`).

- [ ] **Step 5: Elle doğrula (run skill):** `node bin/syzer.js` ile paralel `spawn_agent` tetikle; dock'ta `├ └` ağacı görünür, ↓/↑/Enter/Esc eskisi gibi çalışır.

- [ ] **Step 6: Commit** — `git commit -m "agent tree: dock shows live tree rows"`.

---

### Task 4: `/tree` komutu

**Files:**
- Modify: `src/dock.js` (`openTree()`; ortak `enterAlt()` yardımcısı; `handleKey`/`drawView` `viewing.kind === 'tree'` dalı; `submit()` regex `/^\/(runs?|tree)(\s|$)/`)
- Modify: `src/repl.js` (`BUILTIN`'e `'tree'`; `case 'tree'` — dock yokken düz metin)
- Test: `test/dock-tree.test.js`

**Interfaces:**
- Consumes: `renderTree(snap, { width, rows, selected, now })`, `dock.getTree`.
- Produces: `dock.openTree()`; tur sürerken `/tree` tam ekran (alternatif ekran, 1 sn yenileme, ↑↓ seç, Enter → mevcut `openView(agent)`, Esc/q çık); tur dışında `case 'tree'` son turun ağacını `renderTree` ile **bir kez** basar (`process.stdout.columns`, rows 40); boşsa `t('tree_none')`.

- [ ] **Step 1: Failing testler:**
  - `dock.openTree()` → `viewing.kind === 'tree'`; `viewLines` içinde `main` ve ajan kind'ı; Esc → `viewing === null`.
  - Seçili ajanda Enter → `viewing.kind === 'agent'` (eski görünüm).
  - Boş snapshot'ta `openTree` çökmez, `no subagents yet` içerir.
  - `submit({text:'/tree'})` dock aktifken kuyruğa girmez, `live` çağrılır.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: Uygula.** `openView` alt ekran/tamponlama kodunu `openTree` ile paylaş (`enterAlt()` çıkar, kod tekrarı yok). `drawView`, `kind === 'tree'` ise `renderTree` çıktısını `rows-2` satıra sığdırıp çizer; alt satır ipucu `esc geri · ↑↓ seç · enter içine gir` (i18n anahtarı `tree_hint`).

- [ ] **Step 4: Testler PASS** (`npm test`).

- [ ] **Step 5: Elle doğrula:** paralel ajan çalışırken `/tree` → tam ekran harita canlı güncellenir; Esc sonrası dock ve çıktı bozulmaz; tur bittikten sonra `/tree` son turun ağacını basar.

- [ ] **Step 6: Commit** — `git commit -m "agent tree: /tree full-screen map and plain fallback"`.

---

### Task 5: Metinler, yardım, belgeler, sürüm

**Files:**
- Modify: `src/i18n-new.js` (en + tr: `tree_none`, `tree_log`, `tree_more`, `tree_hint`); diğer dillerin `en` yedeğine düşüp düşmediğini `src/i18n.js` `t()` ile doğrula, düşmüyorsa aynı anahtarları ekle
- Modify: `src/i18n-setup.js` (`help6`'ya `/tree` satırı, en + tr)
- Modify: `README.md`, `README.en.md` (komut listesine `/tree`)
- Modify: `package.json` ve `package-lock.json`: sürüm `3.21.0`
- Test: `test/agent-tree.test.js`

- [ ] **Step 1: Failing test:** `t('tree_none')` hem `en` hem `tr` için boş olmayan ve anahtar adına eşit olmayan dize döndürür.

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: Anahtarları ve belge satırlarını ekle** (`/tree  agent map · live subagent tree and event log` / `/tree  ajan haritası · canlı alt ajan ağacı ve olay günlüğü`). Task 1'deki sabit yedek metinleri `t()` anahtarlarına bağla.

- [ ] **Step 4: `npm test` PASS.**

- [ ] **Step 5: Commit** — `git commit -m "3.21.0: agent tree (dock tree + /tree), i18n and docs"`. Tag/release **ayrı onayla** yapılır.

---

## Self-review notları

- Spec kapsamı: bileşen 1 → Task 1; besleme → Task 2; dock → Task 3; `/tree` → Task 4; i18n/README → Task 5; güvenli geri dönüş (try/catch, düz metin) → Task 3, 4; Orca düğümü → Task 1, 2 testleri.
- Spec'ten tek ince fark: tur dışında `/tree` canlı tam ekran değil, son turun ağacını **bir kez basar** (tur dışında dock/alt ekran ve canlı veri yok). Spec'in "tur bittiyse son turun ağacını gösterir" maddesiyle uyumlu.
- Orca işçileri için ek kod gerekmez: `orca-workers.js` zaten `agentStart('w<hex>', 'worker: …')` çağırıyor; `trackOut` `w` önekinden `orca` çıkarır.
