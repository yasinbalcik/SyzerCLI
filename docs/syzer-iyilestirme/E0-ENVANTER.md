# E0 Envanter Raporu: SyzerCLI Web Arayüzü ve API Keşfi

**Tarih:** 2026-10-12  
**Kart:** E0 (Alan E: Web Arayüzü Keşif ve Envanter)  
**Rol:** E0 | L2 | Alan E web arayüzü | Üst şef: Koordinatör  
**Kapsam:** `src/web.js`, `src/web-ui.js`, API uç noktaları, bileşen haritası, görsel durum ve E1 tasarım girdileri  
**Durum:** Tamamlandı (`git diff --stat` kod dosyalarında boş, yalnızca dokümantasyon ve ekran görüntüsü eklendi)

---

## 1. Mimari ve Güvenlik Modeli (`src/web.js`)

`src/web.js`, SyzerCLI'ın yerel web sunucusunu yönetir (`syzer web` komutu veya REPL içi `/web`).

### 1.1 Sunucu Özellikleri
- **Bağlantı Adresi:** Yalnızca `127.0.0.1` (dış ağlara kapalı).
- **Port:** Varsayılan `8788`. `EADDRINUSE` durumunda dinamik olarak bir sonraki porta geçer (`port + 1 ... port + 20`).
- **Kullanıcı Modeli:** Tek kullanıcı, tek oturum mimarisi (`createSession`).
- **Dış Bağımlılık:** Sıfır ek npm bağımlılığı (Node.js dahili `http`, `crypto`, `child_process`, `fs`, `path` modülleri).

### 1.2 Kimlik Doğrulama ve Güvenlik Akışı
Ajan terminal üzerinde komut çalıştırma (`bash`, `powershell`) ve dosya yazma yetkilerine sahip olduğundan koruma çok katmanlıdır:
1. **Oturum Belirteci (Token):** Sunucu başlangıcında 18 baytlık rastgele kriptografik token oluşturulur (`crypto.randomBytes(18).toString('hex')` -> 36 karakter hex).
2. **İlk Giriş & Çerez (Cookie):**
   - Kullanıcı tarayıcıda `http://127.0.0.1:8788/?t=<token>` adresini açar.
   - `GET /` isteğinde `?t=` token parametresi doğrulanırsa sunucu `302 Found` döndürür ve `syz=<token>; HttpOnly; SameSite=Strict; Path=/` çerezini yazar.
   - Ardından tarayıcı çerezle temiz URL'ye (`/`) yönlendirilir.
3. **Host Doğrulaması:**
   - İstek başlığındaki `Host` alanı `^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$` regex'i ile test edilir. Eşleşmezse `403 Forbidden` (`forbidden host`) döner.
4. **Origin Doğrulaması (CSRF Koruması):**
   - `POST` isteklerinde `Origin` başlığı varsa regex ile yerel host doğrulanır. Harici sitelerden gelen CSRF istekleri `403 Forbidden` (`bad origin`) ile engellenir.
5. **Yetkisiz Erişim Koruması:**
   - Çerezi veya geçerli token'ı olmayan istekler `401 Unauthorized` alır.

---

## 2. API Uç Noktaları Kataloğu (`src/web.js`)

| HTTP Metodu | Uç Nokta (Path) | İstek Parametreleri / Gövde | Yanıt Tipi | Yanıt Özeti / Şeması | Durum Kodları |
|---|---|---|---|---|---|
| `GET` | `/` | `t` (opsiyonel query param) | `text/html` | İlk girişte 302 redirect + cookie; çerezli ise `html` tek sayfa arayüzü | `200`, `302`, `401`, `403` |
| `GET` | `/icon.png` | Yok | `image/png` | `assets/syzer-icon.png` dosyasını sunar (Cache-Control: max-age=86400) | `200`, `404` |
| `GET` | `/api/state` | Yok | `application/json` | Genel sistem durumu: `{ version, provider, providers, model, effort, perm, lang, langs, cwd, busy, keys, ready, messages }` | `200`, `401`, `403` |
| `GET` | `/api/usage` | Yok | `application/json` | Sağlayıcı bazlı kota kullanım özeti (`usage-summary.js`): `{ percent_used, providers: [...] }` | `200`, `401`, `403` |
| `GET` | `/api/skills` | Yok | `application/json` | `{ skills: [...], commands: [...], agents: [...] }` | `200`, `401`, `403` |
| `GET` | `/api/workspaces`| Yok | `application/json` | Kayıtlı ve mevcut çalışma alanları: `{ current, list: [{ path, name, branch, dirty, sessions }] }` | `200`, `401`, `403` |
| `GET` | `/api/sessions` | Yok | `application/json` | Aktif çalışma alanındaki oturumlar listesi: `[{ id, title, ts, count, current }]` | `200`, `401`, `403` |
| `GET` | `/api/models` | `q` (opsiyonel arama dizesi) | `application/json` | Mevcut sağlayıcının modelleri: `[{ id, ctx, tools }]` (maks. 200 adet) | `200`, `401`, `403` |
| `POST`| `/api/chat` | `{ text: string }` | `application/x-ndjson` | Ajan akış çıktısı (NDJSON streaming olay akışı) | `200`, `400`, `409` |
| `POST`| `/api/confirm` | `{ id: string, answer: 'yes'\|'no'\|'always'\|'rule' }` | `application/json` | Araç çalıştırma onayına yanıt verir: `{ ok: true }` | `200`, `401` |
| `POST`| `/api/workspace`| `{ action: 'add'\|'select'\|'remove', path: string }` | `application/json` | Çalışma alanı ekler, seçer (oturum sıfırlar) veya siler; güncel `state()` döner | `200`, `400`, `409` |
| `POST`| `/api/session/resume` | `{ id: string }` | `application/json` | Eski oturumu yükler ve güncel `state()` döner | `200`, `409` |
| `POST`| `/api/abort` | `{}` | `application/json` | Aktif LLM sorgusunu veya araç çalıştırmasını iptal eder: `{ ok: true }` | `200` |
| `POST`| `/api/clear` | `{}` | `application/json` | Mevcut oturumu sıfırlar, yeni `sessionId` atar ve güncel `state()` döner | `200` |
| `POST`| `/api/settings` | `{ provider?, model?, effort?, perm?, lang?, activeKey? }` | `application/json` | Çalışma zamanı ve kalıcı ayarları günceller; güncel `state()` döner | `200`, `409` |
| `POST`| `/api/keys/add` | `{ text: string }` | `application/json` | Toplu API anahtarı ekler: `{ added, exists, invalid, found, state }` | `200` |
| `POST`| `/api/keys/remove` | `{ index: number }` (1-tabanlı) | `application/json` | Belirtilen indeksteki anahtarı siler ve güncel `state()` döner | `200` |

### 2.1 `/api/chat` NDJSON Olay Sözleşmesi (Streaming Protocol)
`/api/chat` yanıtı `application/x-ndjson` formatında satır satır JSON akışı ile iletilir:

```json
{"type": "waiting", "on": true, "label": "openrouter"}
{"type": "thinking", "text": "Düşünce metni parçası..."}
{"type": "text", "text": "Cevap metni parçası..."}
{"type": "endText"}
{"type": "tool", "name": "read_file", "summary": "src/web.js"}
{"type": "toolResult", "ok": true, "summary": "232 satır okundu", "body": "..."}
{"type": "agentStart", "id": "sub-1", "label": "Araştırmacı"}
{"type": "agentUpdate", "id": "sub-1", "action": "dosyaları inceliyor"}
{"type": "agentDone", "id": "sub-1", "run": {"label": "...", "ok": true, "steps": [], "report": "..."}}
{"type": "confirm", "id": "c1a2b3", "kind": "bash", "summary": "npm test", "preview": "..."}
{"type": "warn", "text": "Uyarı mesajı"}
{"type": "notice", "text": "Bilgi notu"}
{"type": "done", "tokens": 1420, "ms": 3200, "model": "anthropic/claude-3.5-sonnet", "key": 1}
{"type": "aborted", "text": "Kullanıcı durdurdu"}
{"type": "error", "text": "Hata açıklaması"}
```

---

## 3. Web Arayüzü Mimarisi ve Bileşen Haritası (`src/web-ui.js`)

`src/web-ui.js`, tek bir JavaScript şablon dizesi (`const html = String.raw\`<!doctype html>...\``) içinde barındırılan ve harici kütüphane gerektirmeyen bir tek sayfa uygulamasıdır (SPA).

### 3.1 CSS Tasarım Jetonları (Design Tokens)
Mevcut jetonlar `:root` üzerinde CSS değişkenleri olarak tanımlıdır:
```css
--bg:     #0d0d10;  /* Sayfa genel arka planı */
--side:   #131317;  /* Sol ve sağ yan paneller */
--panel:  #17171c;  /* Kart ve kutu arka planı */
--panel2: #1d1d24;  /* Girdi, buton ve aktif eleman arka planı */
--line:   #25252d;  /* Kenarlık ve bölücü çizgiler */
--fg:     #ececf1;  /* Birincil metin rengi */
--mut:    #8b8b99;  /* İkincil / sönük metin rengi */
--acc:    #ff8a3d;  /* Vurgu rengi (turuncu - birincil aksiyonlar) */
--ok:     #3ecf8e;  /* Başarı durumu (yeşil) */
--warn:   #f5b84b;  /* Uyarı durumu (sarı) */
--bad:    #f0616d;  /* Hata / tehlike durumu (kırmızı) */
--code:   #0f0f13;  /* Kod blokları arka planı */
--blue:   #6cb6ff;  /* Araç ve ajan bağlantı rengi */
```

### 3.2 Yerleşim (Layout) Mimarisi
Sayfa 3 sütunlu CSS Grid ile oluşturulmuştur:
`grid-template-columns: var(--lw, 280px) minmax(0, 1fr) var(--rw, 290px);`

1. **Sol Bölme (`#left` - 280px):**
   - **Marka Başlığı (`.brand`):** Syzer ikonu, logo ve versiyon numarası (`#ver`).
   - **Sekme Çubuğu (`.tabs`):** Beceriler (`skills`), Model (`model`), Key'ler (`keys`).
   - **Beceriler Paneli (`#p-skills`):**
     - Arama kutusu (`#sk-q`).
     - Beceriler listesi (`#sk-skills`): Tıklandığında komut satırına `/beceri ` yazar.
     - Komutlar listesi (`#sk-cmds`).
     - Ajanlar listesi (`#sk-agents`): Tıklandığında `Use the "..." agent` şablonunu yapıştırır.
   - **Model & Ayarlar Paneli (`#p-model`):**
     - Sağlayıcı (`#provider`), Model (`#model`), Efor düzeyi (`#effort`), İzin modu (`#perm`), Dil (`#lang`).
   - **Key'ler & Kota Paneli (`#p-keys`):**
     - Kullanım özeti (`#usage`): Sağlayıcı bazlı renkli yüzde barları (`.bar`, `.bar.w`, `.bar.b`).
     - Yenileme butonu (`#ref`).
     - Anahtar listesi (`#keys`): Durum noktaları (`.dot.ready`, `.dot.wait`, `.dot.off`), maskelenmiş anahtar, silme butonu.
     - Anahtar ekleme alanı (`#newkeys`, `#addk`, `#kmsg`).

2. **Orta Bölme (`#mid` - Esnek İçerik Alanı):**
   - **Üst Çubuk (`.top`):** Sol panel aç/kapa butonu (`#tl`), başlık (`#title`), Yeni Sohbet butonu (`#clear`), Sağ panel aç/kapa butonu (`#tr`).
   - **Mesaj Akışı (`#log`):**
     - Boş durum (`.empty`): Syzer logosu, karşılama mesajı (`hello`) ve aktif çalışma dizini (`cwd`).
     - Kullanıcı mesajı (`.msg.user`): Sağa dayalı olmayan, gri kutu içinde mesaj.
     - Asistan mesajı (`.msg.assistant`): Basit markdown (`md()`) formatında metin.
     - Düşünce balonu (`.think`): İtalik sönük yazı, 300 karakterle sınırlı.
     - Araç çalıştırma bloğu (`.tool`): `● araç_adı`, sonuç özeti (`.res`), detaylı çıktı (`details > pre`).
     - Alt ajan kartı (`.agent`): `⠿ ajan_etiketi`, canlı adım güncellemeleri, tamamlandığında adım ve rapor akordeonu.
     - Onay diyalogu (`.confirm`): Sarı çerçeveli onay kutusu, araç parametre önizlemesi ve 4 buton (`İzin ver`, `Reddet`, `Her zaman`, `Kural kaydet`).
     - Hata ve uyarılar (`.warn`, `.err`).
     - Tamamlanma meta bilgisi (`.meta`): Model, kullanılan key, harcanan token ve süre.
   - **Giriş Alanı (`.comp`):**
     - Otomatik tamamlama açılır menüsü (`#sug`): `/` yazıldığında beliren beceri/komut öneri listesi (ok tuşları ve Tab/Enter desteği).
     - Mesaj kutusu (`#inp`): Otomatik uzayan `textarea` (220px tavana kadar).
     - Hızlı eylem çubuğu (`.bar2`): Model seçici (`#m2`), Efor seçici (`#e2`), İzin seçici (`#p2`), durum etiketi (`#ctxtag`), Gönder (`#send`) ve Durdur (`#stop`) butonları.

3. **Sağ Bölme (`#right` - 290px):**
   - **Çalışma Alanları (`#ws`):** Kayıtlı projeler listesi, aktif proje belirteci (`●`), Git dalı (`branch`), değiştirilen dosya sayısı (`±N`), oturum sayısı, çalışma alanı ekleme alanı (`#wspath`, `#wsadd`).
   - **Oturumlar (`#sess`):** Geçmiş oturumlar listesi, başlık, tarih/saat, mesaj adedi, tıklandığında oturumu geri yükleme (`/api/session/resume`).

### 3.3 İstemci Durum Yönetimi (Client State)
- **Küresel Değişkenler:**
  - `ST`: Sunucudan gelen son `state()` nesnesi.
  - `L`: Seçili dil (`'en'` veya `'tr'`).
  - `SK`: Beceriler, komutlar ve ajanlar listesi.
  - `sugIdx`: Otomatik tamamlama menüsünde klavye ile seçilen satırın indeksi.
- **Kalıcı Durumlar (LocalStorage):**
  - `localStorage.getItem('nol')`: Sol paneli gizleme tercihi (`body.nol`).
  - `localStorage.getItem('nor')`: Sağ paneli gizleme tercihi (`body.nor`).
- **Çoklu Dil (i18n):**
  - İstemci içinde gömülü `I = { en: {...}, tr: {...} }` sözlüğü.
  - DOM elemanları `data-i="..."` ve `data-ph="..."` öznitelikleriyle dinamik güncellenir.

---

## 4. Ekran Görüntüleri ve Görsel Durum Analizi

Bu envanter çalışması kapsamında Edge headless motoru ile arayüzün gerçek durumundan ekran görüntüleri alınmış ve kaydedilmiştir:

1. **Masaüstü Varsayılan Görünüm (1440 × 900):**  
   - Dosya Yolu: `docs/syzer-iyilestirme/screenshots/web-ui-initial.png`  
   - Boyut: 61 KB  
   - Görsel Durum: 3 bölmeli yapı eksiksiz yükleniyor, sol panelde Beceriler sekmesi, ortada boş durum logosu ve selamlama, altta hızlı model/efor çubuğu ve sağda çalışma alanları yer alıyor.
2. **Mobil Viewport Görünümü (390 × 844 - iPhone Boyutu):**  
   - Dosya Yolu: `docs/syzer-iyilestirme/screenshots/web-ui-mobile-390.png`  
   - Boyut: 43 KB  
   - Görsel Durum: **Kritik UI hatası tespit edildi.**

---

## 5. E1 Tasarım Spesifikasyonu İçin Bulgular ve Eksiklikler

E1 tasarım spesifikasyonunda (ve ardından E2 uygulamasında) ele alınması gereken temel mimari ve görsel eksiklikler aşağıda sınıflandırılmıştır:

### 5.1 Responsive ve Mobil Kırılmalar
- **390px Mobil Kırılması:** `@media(max-width:1000px)` sol ve sağ sütunları gizlemesine (`display:none`) rağmen, orta bölmedeki `.top` başlık ve `.bar2` kontrol çubuğu flex elemanları taşmaktadır. Karşılama metni (`Nasıl yardımcı olabilirim?`) `Na ya ol` şeklinde dikey olarak harf harf kırılmakta, alttaki kontroller ekranın dışına taşmaktadır.
- **Gizlenen Panellerin Geri Çağrılamaması:** Mobilde sol/sağ paneller `display:none` olduğunda, üst çubuktaki `☰` ve `▥` butonları panelleri çekmece (drawer / off-canvas) olarak açmamaktadır; butonlar mobilde işlevsiz kalmaktadır.

### 5.2 Markdown ve Kod Gösterim Kısıtları
- `web-ui.js` içindeki `md()` ayrıştırıcısı son derece ilkel bir regex kullanmaktadır:
  - Yalnızca üç tırnaklı kod blokları, tek tırnaklı satır içi kod ve kalın (`**`) metin desteklenmektedir.
  - **Eksikler:** Başlıklar (`#`, `##`), madde imleri (`-`, `*`), numaralı listeler (`1.`), tablolar (`|`), alıntılar (`>`), bağlantılar (`[metin](link)`), yatay çizgiler (`---`) ve renklendirilmiş sözdizimi (syntax highlighting) tamamen eksiktir.
  - **Diff Desteği Yok:** Syzer bir kodlama CLI'ı olmasına ve `diff.js` barındırmasına rağmen web arayüzünde dosya değişiklikleri için renkli diff gösterimi (kırmızı/yeşil ekleme-çıkarma) bulunmamaktadır.

### 5.3 Tema Sistemi
- Mevcut sistem yalnızca tek bir koyu tema (`--bg: #0d0d10`) içermektedir.
- Açık tema (Light theme) için değişken seti veya tema değiştirme butonu yoktur.
- Sistem teması tercihi (`@media (prefers-color-scheme)`) dinlenmemektedir.

### 5.4 Erişilebilirlik (A11y) Bulguları
- **Kontrast:** Bazı sönük metinler (`--mut: #8b8b99`) koyu paneller üzerinde (`#17171c`) ~3.8:1 kontrast oranına sahiptir ve WCAG AA normal metin standardı olan 4.5:1 eşiğini karşılamamaktadır.
- **Form Etiketleri:** Form elemanları (`<select>`, `<input>`) `<label>` etiketleriyle `id`/`for` üzerinden bağlanmamıştır veya `aria-label` eksiktir.
- **Klavye Odağı:** `:focus` durumlarında yalnızca zayıf bir kenarlık rengi değişimi vardır; belirgin odak halkası (focus ring) eksiktir.
- **ARIA Canlı Bölgeleri:** Streaming log alanında `aria-live="polite"` bulunmadığı için ekran okuyucular yeni gelen mesaj parçalarından haberdar olamamaktadır.

### 5.5 Durum Yönetimi ve Boşluklar
- **Yükleniyor (Loading) Durumu:** Mesaj gönderildiğinde sadece Gönder butonu gizlenip Durdur butonu görünmektedir. Yanıt gelene kadar bir skeleton veya yazıyor animasyonu yoktur.
- **Onay Bildirimleri:** Onay diyalogları akışın içine statik olarak eklenmektedir. Sohbet uzadığında onay kutusu yukarıda kalarak kullanıcının gözünden kaçabilmektedir.
- **Bağlantı Kopması Durumu:** Sunucu çökerse veya kapanırsa arayüz sessizce yanıtsız kalmakta, "Bağlantı koptu" uyarısı vermemektedir.

### 5.6 Kod Yapısı ve E1.5 Refactoring Önerisi
- `web-ui.js`, 204 satırlık tek bir HTML/JS/CSS şablon dizesidir. Bu durum hızlı yükleme sağlasa da, bileşenler genişledikçe bakımını ve çoklu geliştirici çalışmasını zorlaştırmaktadır.
- PLAN.md Madde 52 uyarınca, E2 öncesinde HTML/CSS/JS parçalarının ayrı dosyalara bölünmesi veya modülerleştirilmesi (E1.5) değerlendirilmelidir.

---

## 6. Doğrulama ve Bitiş Kriteri

- [x] `web.js` API uç noktaları eksiksiz listelendi (15 uç nokta ve NDJSON akış sözleşmesi).
- [x] `web-ui.js` bileşen ve durum haritası çıkarıldı (jetonlar, 3 bölmeli düzen, i18n, DOM elemanları).
- [x] Gerçek tarayıcı ile ekran görüntüleri alındı (`docs/syzer-iyilestirme/screenshots/`).
- [x] `git diff --stat` kod dosyalarında boş tutuldu.
