# Agent Panel (canlı harita + bitiş raporu) — tasarım

Bu belge `2026-10-08-agent-tree-design.md` üzerine kurulur (store, `trackOut`, dock ağacı, `/tree` zaten var, v3.21.0).

## Amaç
Orkestrasyon (ana model, alt ajanlar, her ajanın modeli ve durumu) CLI arayüzünde **komut gerekmeden** görünsün: ajanlar çalışırken canlı bir harita, iş bitince sohbette kalıcı bir durum raporu. Görsel sade ve renkli olsun.

## Kullanıcı kararları
- Tam harita (ana kutu + ajan kartları) istendi; sohbet akışına yerinde yenilenen blok yazmak kırılgan olduğu için canlı kısım dock'ta, rapor sohbette kalıcı (kullanıcı onayladı).
- Bitişte de aynı görsel mantık: harita + özet + önemli olaylar.
- `/tree` aynı haritanın tam ekran, istek üzerine sürümü olarak kalır.

## Durumlar (hata düzeltmesi dahil)
`queued … gri` · `running ● turuncu` · `done ✓ yeşil` · `stopped ⚠ sarı` · `failed ✖ kırmızı` · `aborted ◌ gri`.
- Bugün adım sınırına çarpan ajan ("Durduruldu: tek turda çok fazla araç adımı") yanlışlıkla `done ✓` görünüyor. `stopped` bunu düzeltir.
- `stopped` tespiti: alt ajanın `out.warn(msg)` çağrısında `msg === t('max_iter')` ise `run.stopped = true`.
- `aborted`: `spawn()` içinde `AbortError` yakalandığında `run.aborted = true` (hata olarak sayılmaz).
- `store.finish(id, { ok, outcome, model })`; `outcome` ∈ `'done' | 'failed' | 'stopped' | 'aborted'`. `trackOut`, `run.stopped/aborted/ok` alanlarından türetir. Geriye dönük: `outcome` yoksa `ok` ile eski davranış.

## Bileşenler

### 1. `src/agent-tree.js` (genişler, saf)
- Ortak `card(node, { width, selected, now }) → string[]` (4 satır, yuvarlak köşe `╭╮╰╯`): satır 1 durum işareti + tür (`· Orca`), satır 2 kısa model (soluk), satır 3 şu anki iş (`act()` mantığı, `…` gizli), satır 4 `adım · token · süre`. `renderTree` mevcut kutuları bu `card` ile çizer (tekrar yok).
- `renderPanel(snap, { width, rows, selected, now }) → string[]`: üstte ana kutu (`main · model · effort · N ajan · X çalışıyor · Y bitti · süre`), altında kartlar (en çok 3 sütun × 2 satır = 6 kart; fazlası için `+N` satırı). Yükseklik ≤ `rows`; sığmazsa kart satırı azaltılır.
- `renderReport(snap, { width, now }) → string[]`: bitiş raporu: ana kutu + TÜM kartlar (sütun sarar) + özet satırı (`3 ajan · 2 bitti · 1 yarıda · 24.2k token · 1m47s`) + önemli olaylar (`stopped`, `failed`, key değişimi, fallback; en çok 8). Boş ağaç için `[]`.
- `summary(snap) → { agents, done, stopped, failed, aborted, tokens, secs }` (saf, test edilir; süre = ilk `t0` ile son `t1`/şimdi arası).
- `renderCompact` satırlarına kısa model adı eklenir.
- Olay günlüğü kayıtlarına `kind` alanı: `'info'` | `'warn'` (trackOut `warn` → `'warn'`); rapor yalnız `warn` + `stopped/failed` olaylarını "önemli" sayar.

### 2. Dock (`src/dock.js`)
- Panel modu: en az bir `queued/running` ajan VAR ve `rows ≥ 28` ve `columns ≥ 70` ise ajan listesi yerine `renderPanel` çizilir. Aksi halde mevcut ağaç satırları (artık model adı ile).
- `need()` panel moduna göre büyür (ana kutu 3 + kart satırları 4 × ≤2 + `+N` 1); mevcut `grow()` kullanılır. Dock tur içinde küçülmez (mevcut davranış): fazla yükseklik boş satır olarak kalır.
- Seçim/Enter/Esc davranışı değişmez (seçili kart `❯` yerine kenarlık vurgusuyla işaretlenir); satır eşleme `dock.agents` id sırası ile aynı kalır.
- Render hatası → eski satır çizimi (try/catch).

### 3. Bitiş raporu (`src/repl.js`)
- Tur bittikten ve dock kapandıktan sonra, bu turda en az bir ajan çalıştıysa `renderReport` bir kez `console.log` ile sohbete yazılır. Ajan çalışmadıysa hiçbir şey yazılmaz.
- TTY değilse (ör. kanal/boru) rapor düz metin, renksiz, genişlik 80.

### 4. `/tree`
- Değişmez; kartlar artık ortak `card` ile çizilir (görsel tutarlılık).

## Görsel stil
- Yuvarlak köşeler, durum rengi yalnız işarette ve kenarlıkta; model soluk, iş normal. `NO_COLOR`/renksiz modda yalnız işaret ve metin (mevcut `C` yardımcıları).
- Her satır `vlen ≤ width` (CJK ve ANSI güvenli, mevcut `fit`).

## Test
`test/agent-tree.test.js` + `test/dock-tree.test.js` (TTY'siz):
- `stopped/aborted/failed/done` işareti ve metni; `outcome` yokken `ok` geri uyumu.
- `summary()` sayıları, token toplamı, süre; boş ve tek ajan.
- `renderPanel`: 1/3/7 ajan, genişlik 70/100, yükseklik sınırı, `+N`; her satır genişliği aşmaz.
- `renderReport`: önemli olay filtresi (warn + stopped/failed), özet satırı, boş ağaçta `[]`.
- Dock: panel modu eşiği (rows 27 → satırlar, 28 → panel), `need()` yüksekliği, seçim eşlemesi.
- `trackOut`: `warn(t('max_iter'))` → düğüm `stopped`; `AbortError` → `aborted`.
- i18n: yeni anahtarlar (en + tr; diğer diller en'e düşer): `st_stopped`, `st_aborted`, `rep_summary`, `rep_events`.

## Kapsam dışı
Sohbet akışında yerinde güncellenen blok, kutular arası ok çizgileri, fare, ajanları panelden durdurma, kalıcı geçmiş, web arayüzü.

## Riskler
- Dock yüksekliği 12–15 satıra çıkar: eşik (28 satır) altında kompakt satırlara düşer.
- `grow()` imleç sorgusu (DSR) panel açılırken bir kez tetiklenir (mevcut mekanizma).
- Bitiş raporu uzun olabilir: kart sayısı çok ise (>9) yalnız ilk 9 kart + `+N`, özet satırı her zaman tam.
