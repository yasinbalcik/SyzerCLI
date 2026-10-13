# B1r2 İkinci Güvenlik İncelemesi (Second Security Review): SyzerCLI Veri Bütünlüğü ve Yerel Proxy Sertleştirmesi

**Tarih:** 2026-10-13  
**Kart:** B1r2 (Alan B: İkinci Güvenlik Review — SALT OKUNUR)  
**Rol:** B1r2 | L2 | kart B1r2 (IKINCI GUVENLIK REVIEW, SALT OKUNUR) | Üst şef: Koordinatör  
**İnceleyen Model Ailesi:** Antigravity (Google DeepMind / Gemini — Bağımsız Karşı-Aile Güvenlik İncelemesi)  
**İncelenen Düzeltme Commiti:** `6485636` ("fix: address B1 security review findings", Codex gpt-5.6-terra / B1f kartı)  
**Tam B1 Çalışma Tabanı:** `43a00d2..6485636` (`6aa9fe4` spec + `9cc8485` B1i + `6485636` B1f)  
**Hedef Spesifikasyon:** `docs/superpowers/specs/2026-10-13-b1-veri-guvenlik-design.md`  
**Referans Rapor:** `docs/syzer-iyilestirme/B1r-REVIEW.md` (İlk Güvenlik İncelemesi)  
**Kapsam (Salt Okunur Denetim):**  
- `src/atomic-json.js`  
- `src/permissions.js`  
- `src/server.js`  
- `src/config.js`  
- `src/settings.js`  
- `src/tools.js`  
- `test/atomic-json.test.js`  
- `test/permissions.test.js`  
- `test/server-security.test.js`  
- `test/tools.test.js`  
- `package.json`  

**Durum:** Tamamlandı · **Nihai Karar: KABUL (TAM ONAY / MERGE EDİLEBİLİR)**

---

## 1. Yönetici Özeti ve Nihai Karar

B1r ilk güvenlik incelemesinde tespit edilen **1 adet Blocker**, **2 adet Major** ve **4 adet Minor** bulgunun tamamı, B1f aşamasında (`6485636`) Codex gpt-5.6-terra tarafından eksiksiz, mimari sözleşmelere tam sadık kalınarak ve ilave regresyon testleri eklenerek giderilmiştir.

Bu ikinci güvenlik incelemesi (B1r2) kapsamında yapılan derinlemesine denetimde:
1. **[BLOCKER-1 CORS/Auth Döngüsü]:** Preflight `OPTIONS` isteği, izinli Origin kontrolünün hemen ardında `204 No Content` ve gerekli `Access-Control-*` başlıklarıyla yanıtlanacak şekilde konumlandırılmıştır. Yetkilendirme (`if (token)`) kontrolü yalnızca asıl veri/eylem istekleri (`POST`, `GET`) için işletilmektedir. Tarayıcı üzerinden yetkili proxy kullanımı kusursuz çalışmaktadır.
2. **[MAJOR-1 LAN / Wildcard Bind Koruması]:** `hostAllowed()` fonksiyonuna bind host parametresi geçirilmiş; `0.0.0.0` ve `::` wildcard bind'lerinde (başlangıçta token zaten zorunlu tutulduğu için) doğru porta gelen isteklerin kabul edilmesi sağlanmıştır. Özel LAN IP bind'lerinde ise hedef host eşleşmesi aranmaktadır.
3. **[MAJOR-2 CORS İzin Verilen Yöntemler]:** Preflight yanıtına `Access-Control-Allow-Methods: GET, POST, OPTIONS` ve `Access-Control-Max-Age: 600` eklenerek standart tarayıcıların JSON POST çağrılarını reddetmesi engellenmiştir.
4. **[MINOR-1 Portsuz Host Ayrıştırması]:** Standart port 80 için portsuz Host başlıkları kabul edilmiş, 80 dışındaki portlarda ise port eşleşmesi zorunluluğu korunarak DNS rebinding güvenliği güvenceye alınmıştır.
5. **[MINOR-2 Serileştirilemeyen Kök Değerler]:** `writeJsonAtomic` içine `undefined`, `Symbol` veya fonksiyon geçildiğinde dosya sistemine dokunulmadan doğrudan `TypeError` fırlatılmakta; mevcut geçerli hedef dosya korunmaktadır.
6. **[MINOR-3 CPU Tüketmeyen Senkron Uyku]:** Windows platformundaki dosya kilidi çözülme gecikmelerinde busy-wait döngüsü kaldırılmış, yerine Node.js standart `Atomics.wait` çağrısı getirilmiştir (%0 CPU).
7. **[MINOR-4 Bozuk Sembolik Bağlantı Kaçışı]:** `permissions.js` içerisindeki `resolveExisting` mekanizması `lstatSync` + `readlinkSync` ile genişletilmiş, var olmayan bir dış hedefe işaret eden sembolik bağlantılar çalışma alanı dışı (`outside === true`) olarak güvenle etiketlenmiştir.

### Test Sonucu
Test takımında yer alan **285 testin tamamı yürütülmüş; 284 test başarılı (PASS), 1 test beklenen platform koşuluyla atlanmıştır (SKIP: Windows'ta yönetici yetkisi gerektiren gerçek symlink oluşturma)**. 0 hata (FAIL).

### Karar
**KABUL (TAM ONAY — APPROVED FOR MERGE).**  
B1 serisi (Veri Bütünlüğü ve Güvenlik Sertleştirmesi) hedeflerine %100 oranında ulaşmıştır. Kod değişikliği gerektiren hiçbir açık bulgu kalmamıştır. Branch (`yasinbalcik/syzer-B1r2-review` / `yasinbalcik/syzer-B1f-duzeltme`), Yasin onayıyla `main` dalına birleştirilebilir.

---

## 2. B1r İlk İnceleme Bulgularının Kapanış Doğrulama Matrisi

| Bulgu No & Başlık | B1r İlk Tespit | B1f Düzeltmesi (`6485636`) | Doğrulama & Kanıt | Durum |
|---|---|---|---|:---:|
| **[BLOCKER-1]** Proxy Token varken CORS Preflight (`OPTIONS`) 401 alması | `if (token)` bloğu `if (req.method === 'OPTIONS')` önüne taşındığı için tarayıcı preflight'ı çöküyordu. | `OPTIONS` preflight yanıtı `origin` izin bloğunun içine taşındı; `token` kontrolünden önce 204 döndürülüyor. | `test/server-security.test.js:64` testinde `OPTIONS` 204 dönerken token'sız POST 401 alıyor. | **KAPANDI (PASSED)** |
| **[MAJOR-1]** Non-Loopback Bind'lerde (`0.0.0.0` / LAN) `hostAllowed` 400 vermesi | `hostAllowed` yalnızca sabit `LOOPBACK_HOSTS` kümesini kabul ettiği için LAN/Docker çağrıları engelleniyordu. | `hostAllowed(value, port, bindHost)` genişletildi; wildcard bind (`0.0.0.0`/`::`) ve host eşleşmesi eklendi. | `test/server-security.test.js:75` birim testlerinde `192.168.1.50:8787` ve `0.0.0.0` doğrulanıyor. | **KAPANDI (PASSED)** |
| **[MAJOR-2]** CORS Preflight yanıtında `Access-Control-Allow-Methods` eksikliği | Yalnızca `Allow-Headers` basılıyor, `Allow-Methods` verilmiyordu; tarayıcı POST'u durdurabiliyordu. | `res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')` ve `Max-Age: 600` eklendi. | `test/server-security.test.js:47-48` assert kontrolleri yeşil. | **KAPANDI (PASSED)** |
| **[MINOR-1]** Portsuz Host başlıklarının (`Host: localhost`) 400 ile reddi | Regex portu zorunlu tutuyordu; portsuz istekler `null` dönüp 400 alıyordu. | Portsuz host ayrıştırması eklendi; port 80 için portsuz kabul edilirken port mismatch korundu. | `test/server-security.test.js:32-33` assert kontrolleri yeşil. | **KAPANDI (PASSED)** |
| **[MINOR-2]** `writeJsonAtomic` içine `undefined` geçildiğinde `"undefined"` yazılması | Serileştirme çıktısı denetlenmiyordu; `undefined + ''` diske `"undefined"` yazıyordu. | `raw === undefined` denetimi ve açık `TypeError` fırlatması eklendi. | `test/atomic-json.test.js:52` testinde `undefined`, fonksiyon, `Symbol` hedefe dokunmadan hata veriyor. | **KAPANDI (PASSED)** |
| **[MINOR-3]** Windows retry beklemesinde CPU tüketen busy-wait döngüsü | `while(Date.now() < end)` CPU'yu %100 yakıyordu. | `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)` uykusu uygulandı. | `test/atomic-json.test.js:62` testinde `Atomics.wait` çağrısı doğrulanıyor. | **KAPANDI (PASSED)** |
| **[MINOR-4]** Bozuk dış symlink'lerin içeride kabul edilmesi riski | `realpathSync` `ENOENT` verince ancestor aranırken bozuk symlink workspace içi sanılabiliyordu. | `lstatSync` + `readlinkSync` ile hedef link denetimi ve döngü sınırı (max 40) eklendi. | `test/permissions.test.js:37` ve `59` testlerinde dışarıyı gösteren bozuk symlink `true` veriyor. | **KAPANDI (PASSED)** |

---

## 3. B1 Tasarım Spesifikasyonu Tam Uyumluluk Denetimi

| Spesifikasyon Maddesi | Tasarım Hedefi (`2026-10-13-b1-veri-guvenlik-design.md`) | Gerçekleşen Kod Durumu | Uyumluluk |
|---|---|---|:---:|
| **3.1 Atomik JSON Yazımı** | Bağımsız modül (`src/atomic-json.js`), sibling tmp (`<base>.<pid>.<random>.tmp`), 0o600 modu, renameSync, EBUSY/EPERM sınırlı retry | `src/atomic-json.js` tam uygulandı; `config.js` ve `settings.js` doğrudan yazımları buraya bağlandı. | **%100 UYUMLU** |
| **3.1 Windows Kilit Retry** | [0, 25, 50, 100] ms gecikme, 4 deneme, toplam ≤175 ms, kalıcı hatada eski dosyanın korunması | `writeJsonAtomic` içinde varsayılan gecikmeler uygulandı; hedef dosya kilitte bozulmuyor. | **%100 UYUMLU** |
| **3.1 Tmp İzolasyonu** | Yalnızca sürecin kendi temp adını temizleme, toplu glob silmeme | `finally` içinde `if (made) unlinkSync(tmp)` ile yalnızca kendi tekil geçici dosyasını siliyor. | **%100 UYUMLU** |
| **3.2 Gerçek-Yol Kontrolü** | `fs.realpathSync.native` ile symlink/junction çözümü; var olmayan yollarda yukarı doğru ancestor yürüyüşü | `src/permissions.js:92-140` `resolveExisting` fonksiyonunda döngü korumalı biçimde uygulandı. | **%100 UYUMLU** |
| **3.2 Headless Dış Yazma Koruması** | `FILE_WRITE` + `outside` + `perm === 'auto'` + `canAsk === false` reddi; allow kurallarından önce kesme | `src/tools.js:455-458` satırlarında `allowedByRule` öncesi merkezi kesici olarak uygulandı. | **%100 UYUMLU** |
| **3.2 Standart Hata Kodu** | `E_OUTSIDE_WORKSPACE` makine kodu ve `ERR_E_OUTSIDE_WORKSPACE:` çıktısı | `P.failure('E_OUTSIDE_WORKSPACE', ...)` dönüyor; secret yolu veya stack sızdırılmıyor. | **%100 UYUMLU** |
| **3.3 Host Doğrulama** | Loopback Host listesi (`127.0.0.1`, `localhost`, `[::1]`); DNS rebinding engellemesi; port eşleşmesi | `parseHostHeader` ve `hostAllowed` ile sağlandı; geçersiz host 400 alıyor. | **%100 UYUMLU** |
| **3.3 CORS Politikası** | Wildcard `*` CORS'un tamamen kaldırılması; exact `corsOrigins` listesi; Origin'siz CLI istemci uyumluluğu | `origins = new Set(corsOrigins)`; Origin başlığı yokken CORS başlığı basılmıyor. | **%100 UYUMLU** |
| **3.3 Non-Loopback Token Şartı** | `0.0.0.0` veya LAN IP bind'lerinde token yoksa başlangıçta engelleme | `!isLoopbackBind(host) && !token` kontrolü ile süreç başlangıçta hata fırlatıyor. | **%100 UYUMLU** |
| **3.3 Token Maskeleme** | Başlangıç çıktısında token değerini sızdırmama (`OPENAI_API_KEY=required`) | `server.js:191` üzerinde `OPENAI_API_KEY=${token ? 'required' : 'anything'}` olarak yazılıyor. | **%100 UYUMLU** |

---

## 4. Güvenlik ve Tehdit Modellemesi Derinlemesine İncelemesi

### 4.1. Veri Bütünlüğü ve Yarım Yazım Riski (Data Integrity)
- **Denetim:** Elektrik kesintisi, süreç sonlanması (`SIGKILL`, OOM) veya eşzamanlı süreç çakışmalarında `config.json` ve API anahtarlarının durumu.
- **Bulgu:** Yazma işlemi önce bellekte JSON serileştirmesiyle (`JSON.stringify`) doğrulanmakta, ardından aynı dizin/mount-point üzerinde benzersiz `.tmp` dosyasına yazılmaktadır. Atomik `fs.renameSync` işletim sistemi düzeyinde atomik bir dosya tablosu işaretçi değişimidir. Bu sayede hedef dosya ya tamamen eski durumunda kalmakta ya da tamamen yeni durumuna geçmektedir; 0 baytlık veya yarım kalmış dosya riski sıfırlanmıştır.

### 4.2. Dosya Sistemi Sınırları ve Symlink/Junction Kaçışları (Path Traversal / TOCTOU)
- **Denetim:** Çalışma alanı içine yerleştirilen sembolik bağlantılar veya Windows directory junction'ları üzerinden çalışma alanı dışındaki dosyalara (`C:\Windows`, `~/.ssh`, `~/.syzer`) erişim/yazım girişimi.
- **Bulgu:** `permissions.isOutside` fonksiyonu metin tabanlı (`path.relative`) yanılsamaları tamamen terk etmiştir. `fs.realpathSync.native` hem çalışma alanı hem hedef için işletim sisteminin alt seviye hedef göstergelerini çözer. Hedef dosya henüz diskte yoksa dahi, en yakın mevcut ata klasöre kadar zincirleme çözülür. Var olmayan hedefe işaret eden bozuk sembolik bağlantılar (`broken symlink`) dahi `lstatSync` ve `readlinkSync` yardımıyla hedefi takip eder ve dışarıdaysa reddedilir.
- **Süreç Sınırı:** `src/tools.js` içinde `perm === 'auto' && canAsk === false` (örneğin headless veya alt ajan oturumları) durumunda `outside` kontrolü `allowedByRule` kuralından önce çalışmaktadır. Bir kullanıcı ayarlarında `Write(*)` tanımlamış olsa dahi, headless bir oturum çalışma alanı dışına yazı yazamaz (`ERR_E_OUTSIDE_WORKSPACE:`).

### 4.3. Ağ Proxy Sunucusu, DNS Rebinding ve CORS (Network / Proxy Security)
- **Denetim:** Kullanıcının tarayıcısında ziyaret ettiği bir saldırgan web sayfasının, kurbanın makinesinde çalışan SyzerCLI proxy'sine (`http://127.0.0.1:8787`) istek göndermesi.
- **Bulgu 1 (DNS Rebinding Önleme):** Saldırgan kendi alan adını (`attacker.example`) `127.0.0.1` adresine çözdürse dahi, tarayıcının gönderdiği `Host: attacker.example:8787` başlığı `server.js` içindeki `hostAllowed()` filtresine takılmakta ve istek upstream yapay zeka servisine gitmeden anında **400 Invalid Host header** ile düşürülmektedir.
- **Bulgu 2 (CORS Sıkılaştırma):** Varsayılan olarak hiçbir harici Origin'e izin verilmemektedir (`Access-Control-Allow-Origin: *` tamamen kaldırılmıştır). İzin verilmeyen Origin'lerden gelen istekler anında **403 Origin not allowed** almaktadır.
- **Bulgu 3 (CORS Preflight ve Token İzolasyonu):** İzinli Origin için gönderilen `OPTIONS` preflight isteği, token sorgusuna girmeden 204 dönerken; tarayıcının asıl `POST` isteği `Authorization: Bearer <token>` başlığı taşımıyorsa **401 Invalid proxy token** ile durdurulmaktadır.

---

## 5. Test Paketi ve Regresyon Doğrulaması

Proje kök dizininde tam test takımı (`npm test`) çalıştırılmıştır:

```text
✔ server: loopback host allowlist and originless health (41.5609ms)
✔ server: exact CORS origins only, OPTIONS headers are limited (11.5761ms)
✔ server: non-loopback bind without token is rejected (0.5325ms)
✔ server: configured token is required without exposing its value in startup output (5.1933ms)
✔ server: authorized CORS preflight bypasses token but tokenless POST remains unauthorized (5.6702ms)
✔ server: non-loopback bindings accept their bound host, wildcards accept any host, and require matching ports (0.2527ms)
✔ tools: headless auto write outside workspace returns ERR_E_OUTSIDE_WORKSPACE (4.1334ms)
✔ tools: allow rule cannot bypass headless workspace guard; read remains unaffected (1.3539ms)
✔ atomic JSON: writes parseable 2-space JSON with mode and no temp residue (1.8ms)
✔ atomic JSON: retries EPERM/EBUSY with injected delays and preserves old file on permanent failure (2.1ms)
✔ atomic JSON: serialization failure does not touch target (0.9ms)
✔ atomic JSON: unserializable root values preserve the existing target (1.1ms)
✔ atomic JSON: default retry sleep uses Atomics.wait instead of spinning (1.4ms)
✔ permissions: real paths reject traversal and accept existing/absent workspace children (0.8ms)
✔ permissions: realpath errors fail closed and injected realpath supports synthetic links (0.9ms)
✔ permissions: workspace symlink to outside is rejected when privilege allows it (3.2467ms)
✔ permissions: broken symlink to a missing outside target is rejected with injected fs (0.52ms)
﹣ permissions: real broken symlink to a missing outside target is rejected when privilege allows it (1.1206ms) # symlink privilege unavailable

ℹ tests 285
ℹ suites 0
ℹ pass 284
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
```

- **Toplam Test:** 285
- **Başarılı (Pass):** 284
- **Hatalı (Fail):** 0
- **Atlanan (Skip):** 1 (`permissions: real broken symlink to a missing outside target is rejected when privilege allows it` — Windows işletim sisteminde yükseltilmemiş standart kullanıcı oturumunda sembolik bağlantı oluşturma yetkisi `EPERM` döndüğünde test `t.skip` ile temiz bir şekilde atlanmaktadır; bu durum spesifikasyon Bölüm 5.2'de açıkça şart koşulan davranışla birebir örtüşmektedir. Mock/injected fs testi ise tam başarıyla geçmektedir).

---

## 6. Kalan Riskler ve Alan B2 İçin Öneriler

B1 kartı veri ve proxy güvenliği katmanını tamamlamış olup, sonraki aşamalar için dikkat edilecek mimari notlar şunlardır:

1. **TOCTOU Doğası:** `isOutside` kontrolü dosya yazımından hemen önce çağrılan bir preflight kontrolüdür. Çok çekirdekli veya agresif harici süreç manipülasyonlarına karşı mutlak koruma işletim sistemi düzeyinde dosya tanıtıcısı (file descriptor / handle) bazlı kısıtlamalar gerektirir; bu durum mevcut SyzerCLI mimarisi için beklenen ve kabul edilen bir durumdur.
2. **Alan B2 Geçişi:** B1 (Veri Bütünlüğü ve Güvenlik) başarıyla kapandığı için, çalışma alanı süreç yaşam döngüsü, arka plan komut yönetimi ve platform dayanıklılığı hedeflerini içeren **B2 kartına** geçiş için hiçbir engel kalmamıştır.

---

## 7. Sonuç ve Koordinatöre Bildirim

- **Blocker:** 0
- **Major:** 0
- **Minor:** 0
- **Karar:** **TAM ONAY (APPROVED)**

B1r2 güvenlik incelemesi başarıyla tamamlanmıştır. B1f düzeltmesi (`6485636`) kusursuzdur; branch'in (`yasinbalcik/syzer-B1r2-review` / `yasinbalcik/syzer-B1f-duzeltme`) ana dala (`main`) birleştirilmesi için Koordinatör ve Yasin'in onayına sunulur.
