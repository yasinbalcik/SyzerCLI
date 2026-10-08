# Dönen 3D logo (karşılama ekranı + /logo) — tasarım

## Amaç
Ali'nin fikri: CLI açılışında ortada dönen 3D Syzer logosu (Codex'teki nokta bulutu gibi). Mevcut koyu arka plan korunur; logo nokta bulutu, ön yüz parlak turuncu, arka yüz soluk gri.

## Kullanıcı kararları
- Açılışta ilk mesaja kadar göster **ve** istendiğinde `/logo` ile göster.
- Stil: nokta bulutu, turuncu vurgu.
- Satır içi (banner altında kayan) animasyon yerine **alternatif ekran** karşılaması: sohbet geçmişinde iz bırakmaz.

## Davranış
1. **Açılış:** banner normal basılır (mevcut davranış), sonra karşılama ekranı alternatif ekranda açılır: ortada dönen logo, altta ipucu satırı (`❯ ` + `splash_hint`). **İlk tuş** ekranı kapatır; o tuş ve ardından gelen tüm tuşlar (yapıştırma, Orca `terminal send` patlaması) sırayla komut satırına geri verilir (kayıp yok). `Ctrl+C`/`Ctrl+D` programdan çıkış gibi davranır.
2. **`/logo`:** aynı ekran, tur dışında; herhangi bir tuşla kapanır (tuş yutulur), `Ctrl+C` yalnız kapatır.
3. **Görünmeme koşulları (düz akış):** stdout/stdin TTY değil; `rows < 24` veya `columns < 50`; `SYZER_NO_LOGO=1`; `NO_COLOR` (renksiz çıktıda animasyon kapalı); tek seferlik mod (`syzer "prompt"`), MCP, web; `ORCA_AGENT_LAUNCH_TOKEN` (Orca ajan başlatması); önceki oturuma devam (`-c`/`--resume`, yani `s.messages` içinde konuşma varken). `/logo` komutu kullanıcı isteği olduğu için yalnız TTY ve boyut koşuluna bağlıdır.
4. **Güvenlik:** alternatif ekrandan çıkış her yolda tam bir kez (`ESC[?1049l`), imleç geri gelir (`ESC[?25h`), zamanlayıcı ve dinleyiciler temizlenir; `process.on('exit')` yedeği. Boyut değişirse (`resize`) yeniden çizilir.

## Bileşenler
- `src/logo-points.js` (üretilmiş veri): 2D nokta listesi `[x, y]` (−1..1, logo oran korunmuş) — SVG logonun beyaz çizgi bölgelerinin örneklenmesi, ~1000–1500 nokta.
- `scripts/gen-logo-points.js`: `assets/syzer-logo.svg`'yi rasterize edip `src/logo-points.js`'i üretir (isteğe bağlı `@resvg/resvg-js`; repo bağımlılığı eklenmez, yoksa `npm i --no-save @resvg/resvg-js` der).
- `src/logo3d.js` (saf): `renderFrame({ t, cols, rows, color }) -> string[]` (her satır `vlen <= cols`, tam `rows` satır). 3D: noktalar 3 z-katmanına çoğaltılır (kalınlık), Y ekseninde dönüş (`angle = t * 0.9 rad/s`) + hafif X sallanması (±0.18 rad, yavaş), perspektif projeksiyon, hücre başına z-buffer (en öndeki kazanır), hücre en/boy oranı 2:1 düzeltmesi. Derinliğe göre karakter (`·` `∙` `•` `●`) ve renk (arka soluk gri → ön parlak turuncu). `color:false` → ANSI içermez. Aynı `t` aynı çıktıyı verir (deterministik).
- `src/splash.js`: `eligibleAtStart(env, out, input, session) -> boolean`, `eligibleForCommand(out, input) -> boolean`, `show({ out, input, title, hint, fps = 20 }) -> Promise<{ exit: boolean, keys: Array<{ str, key }> }>` (alternatif ekran, ~20 fps `setInterval`, ilk tuşu yakalar ve ekranı kapatır, kapanıştan sonra gelen tuşları kısa bir tick boyunca toplar).
- `src/input.js`: `Editor#inject(str, key)` (= `_key`), tuşları geri vermek için.
- `src/repl.js`: açılışta ilk `editor.read`'den önce `splash.show` (uygunsa), dönen tuşlar `const p = editor.read(prompt); keys.forEach(inject); r = await p;`; `exit` → döngüden çık; `/logo` komutu; `BUILTIN`'e `'logo'`.
- i18n (en + tr; diğer diller en'e düşer): `splash_hint`, `splash_help` (help satırı).
- README (TR+EN): karşılama ekranı, `/logo`, `SYZER_NO_LOGO=1`.

## Test
`test/logo3d.test.js`: veri sağlığı (nokta sayısı aralığı, sınırlar), `renderFrame` boyutu/genişliği/determinizmi, farklı `t` farklı kare, `color:false` ANSI'siz, ön noktaların turuncu + arka noktaların gri renkte olması (FORCE_COLOR ile), küçük boyutlarda (24×50) çökmez.
`test/splash.test.js`: sahte `out`/`input` (EventEmitter, `isTTY`, `rows/columns`, `write`) ile: eligibility matrisi (TTY yok, küçük terminal, env, NO_COLOR, ORCA token, sohbet var), ilk tuşla kapanma ve alternatif ekranın tam bir kez açılıp kapanması, aynı tick'te gelen ek tuşların sırayla `keys`'e girmesi, `Ctrl+C`/`Ctrl+D` → `exit:true`, `/logo` modunda tuş yutulması, zamanlayıcı temizliği (test süreci kapanır), `resize` yeniden çizimi.
`test/` içinde `Editor#inject`: kuyruktaki tuşlar `editor.read` sonrası sırayla satıra yazılır.

## Kapsam dışı
Tur çalışırken logo, farklı logo/şekil seçimi, ayar menüsü, tema, ses, web arayüzü.

## Riskler
- Alt ekran + ham mod: çıkışta terminal durumu bozulursa kullanıcı terminali kaybeder → çıkış tek bir `leave()` fonksiyonunda, `exit` yedeği ve testli.
- Windows terminallerinde `●`/`∙` genişliği ve alt ekran desteği: Windows Terminal/ConHost destekler; destek yoksa DSR gerekmez, sadece görsel bozulma riski; `SYZER_NO_LOGO=1` kaçış yolu.
- Orca `terminal send` patlaması: ilk tuşla ekran kapanırken sonraki tuşlar kaybolmamalı (toplama + geri verme, testli).
