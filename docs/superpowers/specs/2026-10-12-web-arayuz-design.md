# SyzerCLI yerel web arayüzü — E1 tasarım spesifikasyonu

**Kart:** E1 · **Rol:** E1 | L2 | Alan E web arayüzü · **Tarih:** 2026-10-12
**Durum:** Yasin onayına hazır tasarım kararı. Bu kartta `src/` ve `test/` değişmez.

## 1. Amaç ve başarı ölçütleri

SyzerCLI'ın `syzer web` yerel arayüzünü, mevcut davranışı kaybetmeden okunabilir, erişilebilir ve 390px'te taşmayan tek sayfa bir çalışma yüzeyine dönüştürmek amaçlanır. Arayüz tek HTML yanıtı olarak kalır; CDN, framework ve yeni npm bağımlılığı eklenmez.

### Kapsam

- Mevcut beceri, komut, ajan, model, efor, izin, dil, key/kota, çalışma alanı ve oturum işlevleri korunur.
- `GET /api/state`, `/api/usage`, `/api/skills`, `/api/workspaces`, `/api/sessions`, `/api/models` uçları ve tüm mevcut POST uçları aynı path, istek alanı ve yanıt anlamıyla kalır.
- `/api/chat` `application/x-ndjson` akışındaki `waiting`, `thinking`, `text`, `endText`, `tool`, `toolResult`, `agentStart`, `agentUpdate`, `agentDone`, `confirm`, `warn`, `notice`, `done`, `aborted`, `error` olayları kaybolmadan görselleştirilir. Bilinmeyen olay türü akışı durdurmaz; erişilebilir bir bilgi satırı olarak gösterilir.
- TR/EN i18n sözlüğü korunur; yeni görünen metinlerin iki karşılığı E2'de eklenir.

### Başarı ölçütleri (E2/E3 tarafından ölçülebilir)

1. 1440×900 ve 1024px genişlikte üç bölme; 390×844'te yatay scroll olmadan orta akış kullanılabilir.
2. Mobilde sol ve sağ bölme off-canvas drawer olarak açılır, arka plan tıklaması veya `Escape` ile kapanır; odak açılan çekmecede kalır.
3. Koyu ve açık temada gövde metni, düğme metni ve hata/uyarı metni WCAG AA normal metin için en az 4.5:1 kontrast sağlar.
4. Başlık, liste, tablo, link, satır içi kod, fenced kod/syntax sınıfı, alıntı ve diff görünümü örnek içerikle doğru ayrışır.
5. Onay diyaloğu akıştan bağımsız sabit görünür; klavye odağı ve `aria-live` ile fark edilir.
6. Yeniden bağlanma veya sunucu kapalı durumları kullanıcıya görünür; mevcut oturum metni kaybolmaz.
7. E3 matrisi (TR/EN × koyu/açık × 1440/1024/390) tüm hücrelerde konsol hatası, yatay taşma ve odak kaybı olmadan tamamlanır.

## 2. Tasarım yönü: üç seçenek ve tek öneri

Üç seçenek aynı API ve olay modelini kullanır. Her mockup bağımsız HTML'dir; tarayıcıda dosya olarak açılabilir, dış kaynağa ihtiyaç duymaz.

### Seçenek A — Odak (önerilen)

Siyahımsı zemin, turuncu birincil eylem ve sakin mavi durum rengi ile sohbeti merkezde tutar. Sol/sağ bilgi panelleri masaüstünde sabit, tablette daraltılabilir; mobilde drawer olur. Ana akışın dikey ritmi ve tek bir birincil gönder düğmesi hata ayıklama işini hızlandırır. Erişilebilirlik, onay ve bağlantı durumlarının görünürlüğü için en dengeli seçenektir.

**Mockup:** [`web-arayuz-odak.html`](./web-arayuz-mockups/web-arayuz-odak.html)

### Seçenek B — Çalışma masası

Kod editörü hissi veren bölücüler, daha yoğun bilgi ve diff odaklı kartlar kullanır. Araç sonuçlarını sık kullanan geliştirici için güçlüdür; ancak boş durumda daha teknik ve yeni kullanıcı için daha yoğun görünür.

**Mockup:** [`web-arayuz-calisma-masasi.html`](./web-arayuz-mockups/web-arayuz-calisma-masasi.html)

### Seçenek C — Sakin sohbet

Geniş mesaj balonları, daha yuvarlak yüzeyler ve ayarlara açılır komut paleti verir. Kısa sorular için davetkârdır; fakat beceri/çalışma alanı/oturumları aynı anda görünür kılmak ve uzun araç akışlarını taramak daha yavaştır.

**Mockup:** [`web-arayuz-sakin-sohbet.html`](./web-arayuz-mockups/web-arayuz-sakin-sohbet.html)

### Tek öneri ve karar gerekçesi

**E2 için Seçenek A — Odak uygulanmalıdır.** Mevcut üç bölmeli zihinsel modeli korur, E0'da görülen 390px kırılmasını drawer ve taşmayan alt çubuk ile çözer, beceri ve çalışma alanı keşfini görünür tutar. B'nin bilgi yoğunluğu ve C'nin sade akışı, A'nın bileşen durumları ile gerektiğinde ayarlanabilir.

## 3. Tasarım jetonları

Jetonlar CSS değişkenleri olarak tek şablonda tanımlanır. Tema `data-theme="dark|light"` ile uygulanır; ilk değer `prefers-color-scheme`, kullanıcı seçimi `localStorage` ile belirlenir.

### Renk ve hesaplanmış kontrast

Kontrastlar WCAG göreceli parlaklık formülüyle hesaplanmıştır: `ratio = (L1 + 0.05) / (L2 + 0.05)`. Aşağıdaki değerler yuvarlanmadan önce kontrol edilmiştir.

| Jeton | Koyu | Açık | Kullanım |
|---|---|---|---|
| `--bg` | `#0d0f12` | `#f7f8fa` | Sayfa zemini |
| `--surface` | `#151922` | `#ffffff` | Panel/kart |
| `--surface-2` | `#1d2330` | `#eef1f5` | Girdi ve hover |
| `--line` | `#303847` | `#c9d0da` | Bölücü/kenarlık |
| `--text` | `#f4f7fb` | `#17202b` | Birincil metin |
| `--muted` | `#b4bfce` | `#536171` | İkincil metin |
| `--accent` | `#ff9a4a` | `#b54800` | Birincil eylem |
| `--link` | `#8fc7ff` | `#075ca8` | Link |
| `--ok` | `#68dda5` | `#087443` | Başarı |
| `--warn` | `#ffd166` | `#805400` | Uyarı |
| `--danger` | `#ff8992` | `#b4232d` | Hata |
| `--code` | `#0b0e13` | `#f0f3f7` | Kod yüzeyi |

Hesap örnekleri: koyu `--text`/`--bg` **17.86:1**, koyu `--muted`/`--bg` **10.31:1**, açık `--text`/`--bg` **15.46:1**, açık `--muted`/`--bg` **5.96:1**, açık `--accent` (#fff üzerindeki koyu turuncu metin) **5.40:1**, koyu `--accent` metin / `--surface` **8.35:1**. Büyük metin dışındaki tüm metin renkleri ≥4.5:1 hedefini karşılar. Renk tek başına durum göstergesi değildir; metin, ikon veya desen eşlik eder.

### Tipografi, aralık ve yüzey

- Sistem yığını: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`; kod: `ui-monospace, SFMono-Regular, Consolas, monospace`.
- Gövde 14px/1.45; panel başlığı 12px/1.2, 700; sohbet başlığı 20px/1.25, 700; kod 13px/1.5.
- 4px tabanlı aralık: `--sp-1:4`, `--sp-2:8`, `--sp-3:12`, `--sp-4:16`, `--sp-5:20`, `--sp-6:24`, `--sp-8:32`.
- Radius: kontrol 8px, kart 12px, modal 16px, tam yuvarlak yalnızca rozet/ikon.
- Gölge: koyu `0 8px 28px rgb(0 0 0/.28)`, açık `0 8px 28px rgb(23 32 43/.14)`; sınır gerektiren kartta gölge tek başına kullanılmaz.
- Hareket: 160ms `ease-out` drawer ve hover; 220ms modal; `prefers-reduced-motion: reduce` altında süreler 0ms, yanıp sönme yok. Streaming imleci en fazla 1Hz ve içerik kaydırma kullanıcı tarafından kilitlenmez.

## 4. Yerleşim ve kırılım kuralları

### Desktop ≥1200px — üç bölme

CSS grid: `minmax(240px, 280px) minmax(0, 1fr) minmax(248px, 300px)`. Sol bölmede marka, sekmeler (Beceriler/Model/Key'ler), arama ve listeler; orta bölmede üst çubuk, mesaj akışı ve kompozitör; sağ bölmede çalışma alanları ve oturumlar bulunur. Orta içerik satır uzunluğu 860px'i geçmez; log dikey scroll sahibidir. Onay katmanı viewport'a sabitlenir.

### Tablet 768–1199px

Orta bölme esnek kalır. Sağ panel varsayılan kapalı, üst çubuktan drawer; sol panel 248px ve daraltılabilir. Kompozitör kontrolleri iki satıra sarılır; buton metinleri görünür kalır. 1024px'te yatay taşma kabul edilmez.

### Mobil ≤767px (hedef 390×844)

Tek sütun, `min-width:0`, `overflow-x:hidden`. Sol ve sağ paneller `position:fixed; inset-block:0; width:min(86vw,320px)` drawer olur; sol soldan, sağ sağdan gelir. Açık drawer üzerinde scrim, `Escape`, kapatma düğmesi ve odak tuzağı vardır. Üst çubukta menü, başlık, yeni sohbet ve sağ panel düğmeleri 44×44px dokunma alanına sahiptir.

Mesaj içeriği `overflow-wrap:anywhere`; kod blokları yatay scroll'u yalnızca kendi içinde alır. Kompozitör viewport altında sabitlenmez; içerik akışının parçasıdır, `padding-bottom: env(safe-area-inset-bottom)` kullanır. Model/efor/izin seçimleri yatay kaydırılabilir tek satır veya “Ayarlar” drawer'ına taşınır. Hoş geldin metni ve cwd en fazla iki satır ellipsis ile gösterilir. 390px görüntüde `document.documentElement.scrollWidth === clientWidth` olmalıdır.

## 5. Bileşenler ve durumları

### Mesaj balonu ve markdown

Kullanıcı mesajı `role="article"`, asistan mesajı `role="article"` ve yazar etiketi ile gösterilir. Renderer güvenli escape sonrası şu yapıları destekler: `h1–h3`, paragraf, sıralı/sırasız liste, blockquote, yatay çizgi, `[metin](url)` linki (`target` davranışı yerel), tablo (`thead/tbody`), satır içi kod ve fenced kod. Fenced dil sınıfı `language-js` gibi korunur; yerel CSS ile anahtar kelime/yorum/sayı renkleri sınırlı syntax vurgusu yapılır, harici highlighter yoktur. Ham HTML çalıştırılmaz.

Durumlar: boş (logo + karşılama + cwd), yükleniyor (asistan balonunda skeleton ve “Yanıt hazırlanıyor”), akış (yeni parçalar), tamamlandı (model/key/token/süre metası), hata (yeniden dene ve hata özeti), iptal edildi. Kullanıcı logu yukarı kaydırdıysa yeni akış otomatik zıplatmaz; “Yeni mesajlara git” düğmesi çıkar.

### Diff görünümü

Araç veya asistan içeriğinde <code>```diff</code> blokları satır başı `+`/`-`/boşluk ile ayrıştırılır; eklenenler yeşil yüzey ve `+`, silinenler kırmızı yüzey ve `−`, bağlam satırları nötr olur. Dosya adı, değişen satır özeti ve yatay scroll görünür. Renk yanında işaret ve `aria-label="eklenen satır"`/`"silinen satır"` bulunur.

### Araç çağrısı kartı

`tool` olayı geldiğinde araç adı, kısa özet, çalışma durumu ve aç/kapa ayrıntısı gösterilir. `toolResult` başarılı/başarısız metinle, gövde `details` içinde escape edilmiş kodla eklenir. Bekleyen kartta spinner yerine reduced-motion uyumlu üç nokta; tamamlananda onay işareti; hatada açıklama ve “ayrıntıları aç” bulunur.

### Onay diyaloğu

`confirm` olayı için `role="dialog"`, `aria-modal="true"`, başlık, araç türü, komut önizlemesi ve dört düğme (`İzin ver`, `Reddet`, `Her zaman (oturum)`, `Her zaman (kural kaydet)`) viewport'a sabit modal olarak görünür. Akış uzasa da modal ve scrim görünür kalır. Açılışta ilk güvenli eylem odaklanır; kapanışta önceki odağa döner; `Escape` reddetme ile eşdeğer değildir ve açık karar gerektirir. `/api/confirm` gövdesi değişmez.

### Boş, yükleniyor, hata, bağlantı koptu

- **Boş:** karşılama, aktif cwd, beceri ipucu.
- **Yükleniyor:** log iskeleti, gönder yerine durdur; ağ beklerken kompozitör kilitlenmez.
- **Hata:** inline hata kartı, olay metni, “Tekrar dene” yalnızca başarısız isteği yeniden gönderir.
- **Bağlantı koptu:** üstte kalıcı amber bant “Syzer sunucusuna bağlanılamıyor”, son başarılı içerik korunur, 2/5/15 saniye geri deneme ve “Yenile” eylemi görünür; `online` olayı ile bant başarıda kalkar.

## 6. Erişilebilirlik

- Her kontrol görünür `<label>` veya anlamlı `aria-label` taşır; select/input id-for ilişkisi zorunludur.
- Global `:focus-visible` halkası 3px `--link`, 2px offset; renk yalnızca değişim göstergesi değildir.
- Log `aria-live="polite"`, durum bandı `role="status"`, hata ve onay `role="alert"`/dialog ile duyurulur. Streaming parçaları tek tek değil, anlamlı cümle aralıklarında duyurulur.
- Drawer açılınca focus trap, scrim, `aria-expanded`, `aria-controls`; kapatılınca açıcı düğmeye dönüş.
- Klavye kısayolları: `Ctrl/Cmd+Enter` gönder, `Shift+Enter` yeni satır, `Ctrl/Cmd+K` komut/beceri araması, `Ctrl/Cmd+B` sol drawer, `Ctrl/Cmd+\` sağ drawer, `Escape` drawer/suggestion/modal kapat. Kısayollar textarea yazarken çakışmıyorsa çalışır; yardım metni “?” panelinde listelenir.
- Minimum dokunma hedefi 44×44px; metin zoom %200'de içerik kullanılabilir; tab sırası DOM sırasını izler.

## 7. Kod yapısı ve E1.5 kararı

`src/web-ui.js` E1/E2 sonunda tek `String.raw` şablon dizesi olarak kalır; API ve NDJSON sözleşmesi `src/web.js` içinde değişmez. HTML/CSS/JS alt bölümleri şablon içinde açık yorumlarla ayrılır; tüm kullanıcı metni i18n sözlüğünden gelir.

**E1.5 refactor: Hayır (şimdilik).** Üretim yanıtını tek dosyada tutmak bağımlılıksız yerel dağıtım ve mevcut `const html` ihracatıyla uyumludur. E2 sırasında tekrar eden renderer fonksiyonları küçük saf JS fonksiyonlarına ayrılabilir. Şablonu dosyalara bölmek E2 kapsamını, cache/okuma akışını ve test yüzeyini büyütür. E1.5 ancak şablon 400 satırı aşar, iki geliştirici aynı anda düzenlemekte zorlanır veya E3 hata düzeltme süresi ölçülebilir biçimde artarsa yeniden açılır.

## 8. E3 QA matrisi

Her hücrede aynı senaryo paketi çalıştırılır: ilk yükleme, beceri arama/tıklama, model/key/izin/dil değişimi, çalışma alanı ekle/seç, oturum devam ettir, markdown + tablo + link + kod + diff, araç çağrısı, dört onay kararı, boş/yükleniyor/hata/bağlantı koptu, klavye ve ekran okuyucu temel akışı.

| Dil | Tema | 1440px | 1024px | 390px |
|---|---|---|---|---|
| TR | Koyu | ☐ | ☐ | ☐ |
| TR | Açık | ☐ | ☐ | ☐ |
| EN | Koyu | ☐ | ☐ | ☐ |
| EN | Açık | ☐ | ☐ | ☐ |

Her hücre için kanıt: ekran görüntüsü, `scrollWidth/clientWidth` sonucu, konsol hatası sonucu, tab/odak notu ve kullanılan commit. Başarı, 12 hücrenin tamamında taşma ve kayıp işlev olmamasıdır.

## 9. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| Tek şablon dizesinde CSS/JS büyümesi | E2 bakım maliyeti | Bölüm yorumları, saf renderer fonksiyonları, E1.5 tetikleyicisi |
| Markdown renderer'ın güvenlik açığı | Yerel arayüzde istenmeyen HTML | Escape-first, izinli etiket üretimi, ham HTML yok |
| Streaming sırasında performans düşüşü | Uzun yanıtların takılması | Parça biriktirme, anlamlı flush, `requestAnimationFrame` sınırı |
| Mobil klavye/safe-area farkları | Kompozitörün kapanması | `env(safe-area-inset-*)`, gerçek 390×844 ve yatay scroll kontrolü |
| Onay modalının akışı bloke etmesi | Kullanıcı yanlış karar verebilir | Açık başlık/önizleme, varsayılan odak reddetme değil güvenli eylem, sabit görünürlük |
| Tema kontrastının yeni metinlerde bozulması | WCAG ihlali | Jeton dışı renk yasağı, E3 kontrast kontrol listesi |
| API olayına yeni `type` eklenmesi | Sessiz bilgi kaybı | Bilinmeyen olayı nötr `notice` kartı olarak gösterme |

## 10. Yasin'e sorulacak açık kararlar (en fazla 5)

1. **Varsayılan tema sistem tercihini izlesin mi?** Öneri: Evet; kullanıcı seçimi `localStorage` ile sistem tercihini geçersiz kılsın.
2. **Tablet (768–1199) başlangıçta sağ drawer kapalı mı olsun?** Öneri: Evet; orta akış genişliği ve 1024px okunabilirliği korunur.
3. **Onayda “Escape” davranışı ne olsun?** Öneri: modalı kapatmasın; kullanıcı `Reddet` veya görünür düğme ile karar versin.
4. **Diff yalnızca fenced `diff` bloklarında mı, araç gövdelerinde de mi tanınsın?** Öneri: Her ikisi; araç gövdesinde ilk satır `diff --git` veya satır başı işaretleri varsa güvenli ayrıştırıcı çalışsın.
5. **E1.5 refactor hangi eşikte açılmalı?** Öneri: E2 sonrası şablon 400 satırı aşar veya E3'te aynı UI hatası iki kez tekrarlanırsa ayrı karta alınsın.

---

**E2 uygulama notu:** Bu belge onaylanmadan `src/` veya `test/` üzerinde değişiklik yapılmaz. Onaydan sonra E2 yalnızca Seçenek A'yı uygular; E3, yukarıdaki matrisi gerçek tarayıcıda kanıtlar.
