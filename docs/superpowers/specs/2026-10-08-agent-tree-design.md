# Agent Tree — tasarım

## Amaç
Ana oturum ve alt ajanların orkestrasyonunu tek ekranda bir harita olarak göstermek: kim çalışıyor, ne yapıyor, durumu ne. Yalnızca gerçek veri gösterilir (sahte metrik yok).

## Kullanıcı kararları
- Görünüm: **ikisi birden** — ajan çalışırken dock'ta küçük canlı ağaç + `/tree` ile tam ekran harita ve olay günlüğü.
- Yaklaşım A: saf render modülü + olay deposu. Yeni bağımlılık yok.

## Mevcut yapı (değişmeyecek davranışlar)
- `src/repl.js` `makeOut()`: `agentStart/agentUpdate/agentDone`, `agents` Map'i, `agentObjs()` dock'a ajan listesi verir.
- `src/subagents.js`: `spawn()` her ajan için `run` kaydı tutar (`parent.runs`: adımlar, `chars`, `model`, `secs`, `report`, `ok`); eşzamanlılık kapısı `limited()`.
- `src/dock.js`: ajan listesi seçimi (↓ ← ↑↓ Enter Esc) ve seçilen ajanın tam ekran canlı içeriği.
- `src/orca-workers.js`: `spawn_syzer` Orca işçileri.

## Bileşenler

### 1. `src/agent-tree.js` (yeni, saf)
- `createStore()` → `{ nodes, log, main }` ve yöntemler:
  - `setMain({ model, effort })`
  - `start(id, { kind, label, orca })` → durum `running`
  - `queue(id, …)` → durum `queued` (`limited()` kapısında beklerken)
  - `update(id, { action, steps, tokens })`
  - `finish(id, { ok, secs, model })` → `done` | `failed`
  - `event(text, id?)` → olay günlüğüne `{ t, id, text }` ekler (en fazla 200 satır)
- `renderTree(state, { width, rows, selected })` → `string[]`:
  - width ≥ 70: ana oturum kutusu üstte, ajan kutuları altta yan yana (≤ 3 sütun, sığmazsa alt satıra sarar).
  - width < 70: dikey ağaç (`├ └`).
  - Kutu: tür, kısa model, şu anki araç, adım, token, süre, durum (`●` çalışıyor, `✓` bitti, `✖` hata, `…` sırada).
  - Altta olay günlüğü: kalan satırlara sığan son kayıtlar.
- `renderCompact(state, { width })` → dock için ağaç satırları (başlıkta ana oturum).
- Hiçbir G/Ç yapmaz; zaman `Date.now()` parametre olarak alınabilir (test için).

### 2. Besleme
- `makeOut()` içindeki `agentStart/Update/Done` aynı olayları store'a da yazar.
- `subagents.js`: kapıya girerken `queued` → `running` geçişi; bitişte `ok/secs/model`.
- Mevcut uyarılar (key rotasyonu, model fallback — `out.warn` ile basılanlar) ayrıca `event()` ile günlüğe düşer.
- `spawn_syzer` işçileri `orca: true` ile düğüm olur ("worker (Orca)").

### 3. Dock
- Düz ajan listesi yerine `renderCompact` çıktısı. Seçim/Enter/Esc davranışı ve canlı içerik görünümü aynı kalır.

### 4. `/tree`
- Tam ekran, saniyede bir yenilenir. ↑↓ ajan seç, Enter mevcut canlı içerik görünümünü açar, Esc/q çıkar.
- Ajan yoksa ya da tur bittiyse son turun ağacını gösterir (`parent.runs` ve store kalır). Hiç ajan çalışmadıysa "henüz alt ajan yok" mesajı.
- `BUILTIN` komut listesine eklenir; `/help` metni ve i18n anahtarları (en/tr + diğer diller için en yedeği).

### 5. Güvenli geri dönüş
- TTY yok / terminal küçük (<16 satır) / `SYZER_NO_DOCK`: `/tree` düz metin ağacı tek seferlik basar; dock zaten kapalı.
- Render hatası uygulamayı düşürmez: try/catch ile eski liste çizimine döner.

## Test
`test/agent-tree.test.js` (`node --test`), TTY gerekmez:
- durumlar (`running/queued/done/failed`) doğru işaret ve metin
- geniş/dar genişlikte düzen, sütun sarması
- günlük satır sınırı ve son kayıtların seçilmesi
- boş durum, tek ajan, 10+ ajan
- Orca düğümü etiketi
`npm test` komutuna eklenir.

## Kapsam dışı
Kutular arası ok çizgileri, fare, ajanları buradan durdurma/yönlendirme, kalıcı geçmiş, harici TUI kütüphanesi.

## Riskler
- Dock yeniden çiziminde satır yüksekliği (`need()` hesabı) ağaçla değişir; üst sınır: en çok 6 ajan satırı + başlık.
- Çok dar terminalde sarma: kutu yerine dikey listeye düşerek çözülür.
