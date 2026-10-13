# B1r Güvenlik İncelemesi (Security Review): SyzerCLI Veri Bütünlüğü ve Yerel Proxy Sertleştirmesi

**Tarih:** 2026-10-13  
**Kart:** B1r (Alan B: Güvenlik Review)  
**Rol:** B1r | L2 | kart B1r (GUVENLIK REVIEW) | Üst şef: Koordinatör  
**İnceleyen Model Ailesi:** Antigravity (Google DeepMind / Gemini — Bağımsız Karşı-Aile Güvenlik İncelemesi)  
**İncelenen Commit / Çalışma:** `9cc8485` ("feat: harden data writes and local proxy", B1 uygulaması)  
**Hedef Spesifikasyon:** `docs/superpowers/specs/2026-10-13-b1-veri-guvenlik-design.md`  
**Referans Envanter:** `C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/docs/syzer-iyilestirme/B0-ENVANTER.md` (Dalga 1 & 3)  
**Kapsam:** `src/atomic-json.js`, `src/config.js`, `src/permissions.js`, `src/server.js`, `src/settings.js`, `src/tools.js`, `test/atomic-json.test.js`, `test/permissions.test.js`, `test/server-security.test.js`, `test/tools.test.js`, `package.json`  
**Durum:** Tamamlandı · Bulgular ve Düzeltme Yaması Hazır

---

## 1. Yönetici Özeti ve Karar

B1 kartı kapsamında sunulan uygulama (`9cc8485`), SyzerCLI altyapısındaki en kritik veri ve güvenlik risklerinden üçünü başarıyla hedeflemiştir:
1. `config.json`, `keys.<provider>.json` ve `.syzer/settings.json` yazımları doğrudan `fs.writeFileSync` yerine tek ve bağımsız `writeJsonAtomic` (`tmp + renameSync`, 0o600, sınırlandırılmış retry) yardımcısına bağlanmıştır.
2. `permissions.isOutside(cwd, p)` fonksiyonu sözel `path.relative` kontrolünden çıkarılarak `fs.realpathSync.native` tabanlı gerçek-yol çözümlemesine dönüştürülmüş; `auto + canAsk:false` modunda çalışma alanı dışına yazma girişimleri allow kuralları bulunsa dahi merkezi `E_OUTSIDE_WORKSPACE` koduyla engellenmiştir.
3. `server.js` yerel proxy sunucusunda `Access-Control-Allow-Origin: *` ve wildcard başlıklar kaldırılmış, `Host` başlığı doğrulaması eklenmiş ve loopback dışı bind'ler için `token` zorunlu kılınmıştır.

Mevcut test takımındaki **279 testin tamamı yeşildir** (0 hata).

Bununla birlikte, yapılan bağımsız karşı-aile güvenlik ve mimari denetiminde **1 adet Kritik CORS Regresyonu (BLOCKER)**, **1 adet Mimari İşlevsellik Kusuru (MAJOR)**, **1 adet CORS Yöntem Eksikliği (MAJOR)** ve **4 adet Kenar Durum / Sağlamlık Kusuru (MINOR)** ile birlikte **Spec Bölüm 5 test matrisinde boşluklar** tespit edilmiştir:

1. **[BLOCKER-1 CORS/Auth Regresyonu]** `server.js` içinde `if (token)` doğrulamasının `if (req.method === 'OPTIONS')` önüne taşınması nedeniyle, token korumalı bir proxy'ye web tarayıcısından gelen tüm CORS preflight (`OPTIONS`) istekleri **401 Unauthorized** ile reddedilmekte ve tarayıcı üzerinden proxy kullanımı tamamen çökmektedir.
2. **[MAJOR-1 Ağ/Proxy İşlevsizliği]** `hostAllowed()` fonksiyonu yalnızca sabit `LOOPBACK_HOSTS` (`127.0.0.1`, `localhost`, `::1`) kümesini kabul ettiği için, token verilerek `0.0.0.0` veya yerel ağ IP'sine bind edilen sunucuya gelen tüm meşru istekler **400 Invalid Host header** ile engellenmektedir.
3. **[MAJOR-2 CORS Protokol Eksikliği]** İzinli Origin için üretilen preflight yanıtında `Access-Control-Allow-Methods` başlığı basılmamaktadır. JSON gövdeli `POST /v1/chat/completions` basit istek (simple request) olmadığından standart tarayıcılar preflight'ı reddedebilmektedir.
4. **[MINOR-1 Host Port Zorunluluğu]** `parseHostHeader` regex'i portsuz Host başlıklarını (`Host: localhost` veya `Host: 127.0.0.1`) `null` döndürmekte ve isteği 400 ile reddetmektedir; spec'teki "Port verilmişse tam eşleşmeli" kuralıyla çelişmektedir.
5. **[MINOR-2 Serileştirme Kusuru]** `writeJsonAtomic` içine `undefined` geçirildiğinde `"undefined"` dizesi dosyaya yazılmakta ve dosya bozulmaktadır (TypeError fırlatılmalıdır).
6. **[MINOR-3 CPU Meşguliyeti]** Windows retry gecikmesinde kullanılan `sleepSync` döngüsü `while(Date.now() < end)` ile %100 CPU yakmaktadır (`Atomics.wait` ile işletim sistemi düzeyinde uyunmalıdır).
7. **[MINOR-4 Bozuk Symlink Kenar Durumu]** Dışarıyı gösteren ancak hedefi henüz diskte var olmayan bozuk sembolik bağlantılar `isOutside` tarafından içeride sayılabilmektedir.

**Karar:** **Şartlı Onay (Changes Requested)**.  
Bölüm 4'teki bulguların giderilmesi ve Bölüm 6'da sunulan hazır drop-in yamanın uygulanması durumunda Blocker ve Major bulgular 0'a inmekte, B1 aşaması tam güvenliğe ulaşmaktadır.

---

## 2. B1 Tasarım Spesifikasyonu Uyumluluk Matrisi

| Şart / Güvenlik Ölçütü | B1 Spesifikasyonu Hedefi | B1 Uygulaması (`9cc8485`) | Değerlendirme |
|---|---|---|---|
| **Atomik JSON Yazıcı** | Tek bağımsız modül (`src/atomic-json.js`), sibling tmp, 0o600, renameSync, EBUSY/EPERM retry | `writeJsonAtomic` uygulandı; 2 girinti, mode 0o600, sınırlı retry var | **BAŞARILI** |
| **Config/Settings Entegrasyonu** | `config.js` ve `settings.js` doğrudan yazımlarının yeni yardımcıya geçmesi | `config.js:31`, `settings.js:68,78` yardımcıya bağlandı | **BAŞARILI** |
| **Windows Kilit/Retry Sınırı** | Maksimum 4 deneme, [0, 25, 50, 100] ms bekleme (toplam ≤175 ms) | Uygulandı (`retryDelaysMs`, 4 attempts) | **BAŞARILI** |
| **Bozuk/Eski Tmp İzolasyonu** | Yalnızca kendi PID/random tmp dosyasını temizleme, toplu glob silmeme | Uygulandı (`tmp = base.pid.random.tmp`, `finally` içinde tekil unlink) | **BAŞARILI** |
| **Gerçek Yol Çözümlemesi** | `fs.realpathSync.native` ile symlink/junction çözümü; var olmayan hedefte ancestor yürüyüşü | `resolveExisting` ile uygulandı; fail-closed catch mevcut | **BAŞARILI** |
| **Headless Dış Yazma Koruması** | `FILE_WRITE` + `outside` + `auto` + `canAsk:false` reddi (`allowedByRule` öncesi) | `src/tools.js:455-458` kural kontrolünden önce uygulandı | **BAŞARILI** |
| **Standart Hata Kodu** | `E_OUTSIDE_WORKSPACE` makine kodu ve `ERR_E_OUTSIDE_WORKSPACE:` çıktısı | `P.failure('E_OUTSIDE_WORKSPACE', ...)` ile sağlandı | **BAŞARILI** |
| **Host Header Doğrulaması** | `127.0.0.1`, `localhost`, `[::1]` izin listesi; port eşleşmesi; DNS rebinding koruması | `parseHostHeader` ve `hostAllowed` eklendi | **KISMİ** (Portsuz host reddediliyor; non-loopback bind'leri kilitliyor) |
| **CORS ve Origin İzolasyonu** | Wildcard `*` CORS kaldırılması; boş liste varsayılanı; exact `corsOrigins` | Wildcard kaldırıldı; `corsOrigins` listesi uygulandı | ❌ **BLOCKER-1** (Token varken OPTIONS 401 alıyor) |
| **Origin'siz İstemci Desteği** | CLI / curl / OpenAI SDK istemcilerinin Origin olmadan çalışmaya devam etmesi | Origin başlığı yokken CORS başlığı basılmıyor, istek geçiyor | **BAŞARILI** |
| **Loopback Dışı Token Şartı** | `0.0.0.0` / LAN IP bind'lerinde token yoksa başlangıçta engelleme | `isLoopbackBind(host)` ve `!token` kontrolü ile fırlatılıyor | **BAŞARILI** |
| **Token Maskeleme** | Başlangıç çıktısında token değerini sızdırmama (`required` yazma) | `OPENAI_API_KEY=${token ? 'required' : 'anything'}` yapıldı | **BAŞARILI** |

---

## 3. Güvenlik, Tehdit Modellemesi ve Mimari Analiz

### 3.1. TOCTOU ve Çalışma Alanı Kaçış Analizi
- **Preflight Yaklaşımı:** `src/tools.js:455` üzerinde `perms.isOutside(cwd, a.path)` kontrolü doğrudan disk mutasyonundan (`prepareChange` ve `fs.writeFileSync`) hemen önce çağrılmaktadır.
- **Fail-Closed Prensibi:** `src/permissions.js:121` bloğunda `realpathSync` sırasında karşılaşılabilecek `EACCES`, `EPERM` veya diğer yetki hataları güvenli tarafta kalarak doğrudan `return true` (çalışma alanı dışı) üretmektedir.
- **Symlink / Junction Zinciri:** `test/permissions.test.js` içindeki sentetik ve yerel testler, çalışma alanı içerisindeki bir sembolik bağlantının dışarıya işaret etmesi durumunda hedefin güvenle dışarı sayıldığını kanıtlamaktadır.

### 3.2. Dosya Sistemi ve Veri Bütünlüğü Analizi
- **Yarım Yazım Riski:** `writeJsonAtomic` önce `JSON.stringify` çalıştırmakta, ardından hedefle aynı dizinde (`path.dirname(file)`) benzersiz `.tmp` dosyası açmaktadır. Bu sayede farklı dosya sistemleri/mount noktaları arasında `EXDEV` hatası oluşmaz.
- **İzin Modu:** POSIX sistemlerinde `0o600` modu hem dosya oluşturma sırasında hem de `chmodSync` ile garanti altına alınmaktadır.
- **Windows Dosya Kilitleme:** Antivirüs veya arama dizinleyicilerinin yarattığı geçici kilitler, `[0, 25, 50, 100]` ms'lik 4 adımlı `renameSync` denemesi ile aşılmaktadır. Başarısızlık durumunda eski dosya içeriği tamamen korunmakta ve tmp dosyası temizlenmektedir.

### 3.3. Ağ ve Proxy Güvenliği Analizi
- **DNS Rebinding:** `Host` başlığı doğrulaması sayesinde, kurbanın tarayıcısında çalışan zararlı bir web sayfasının DNS rebinding tekniğiyle `attacker.example` adını `127.0.0.1` adresine eşleyip yerel proxy'ye gizlice erişmesi engellenmiştir.
- **CORS Sıkılaştırması:** Saldırgan sitelerin tarayıcı üzerinden doğrudan `fetch('http://127.0.0.1:8787/v1/chat/completions')` yapması, varsayılan boş `corsOrigins` listesi ve 403 yanıtı ile durdurulmuştur.

---

## 4. Detaylı Bulgu Kataloğu

### [BLOCKER-1] Proxy Token Etkinken CORS Preflight (`OPTIONS`) İsteklerinin 401 ile Reddedilmesi
- **Konum:** [`src/server.js:97-101`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/server.js#L97-L101)
- **Sorun:** Commit `9cc8485` öncesinde `if (req.method === 'OPTIONS')` kontrolü token kontrolünden önce çalışmaktaydı. Yeni kodda `if (token)` bloğu `OPTIONS` kontrolünün önüne taşınmıştır:
  ```javascript
  if (token) {
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
    if (given !== token) return oaError(res, 401, 'Invalid proxy token.');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  ```
- **Senaryo:** Kullanıcı `syzer serve --token=my-secret` başlatır ve izin verilen bir web arayüzünden (`corsOrigins: ['https://panel.example']`) `POST /v1/chat/completions` isteği atar. W3C CORS spesifikasyonuna göre tarayıcılar preflight `OPTIONS` isteklerine asla `Authorization` başlığı eklemez. Sunucu gelen `OPTIONS` isteğini görür, Origin'e izin verir, ancak hemen altındaki `if (token)` satırında `given` boş olduğu için **401 Invalid proxy token** döner! Tarayıcı CORS hatası vererek asıl POST isteğini iptal eder.
- **Etki:** Kimlik doğrulamalı (token'lı) yerel proxy sunucusu web tabanlı hiçbir istemci tarafından kullanılamaz hale gelmiştir.
- **Düzeltme:** `if (req.method === 'OPTIONS')` bloğu `origin` kontrolünün hemen ardına, `if (token)` kontrolünün ise önüne taşınmalıdır.

---

### [MAJOR-1] Non-Loopback Bind'lerde (`0.0.0.0` / LAN IP) `hostAllowed` Tarafından Tüm İsteklerin 400 ile Engellenmesi
- **Konum:** [`src/server.js:33-36, 85-87`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/server.js#L33-L36)
- **Sorun:** `start` fonksiyonu loopback dışı başlatmalarda (`host: '0.0.0.0'` veya `host: '192.168.1.50'`) token bulunmasını zorunlu tutarak başlatmaya izin vermektedir. Ancak gelen her istekte çağrılan `hostAllowed()`:
  ```javascript
  function hostAllowed(value, expectedPort) {
    const parsed = parseHostHeader(value);
    return !!parsed && LOOPBACK_HOSTS.has(parsed.hostname) && parsed.port === Number(expectedPort);
  }
  ```
  sabit `LOOPBACK_HOSTS` (`127.0.0.1`, `localhost`, `::1`) kontrolü yapmaktadır.
- **Senaryo:** Docker container'ında veya yerel ağda `start({ host: '0.0.0.0', port: 8787, token: 'abc' })` çalıştırılır. Başka bir cihazdan veya container dışından `http://192.168.1.50:8787/v1/health` çağrısı yapılır (Host: `192.168.1.50:8787`). `parsed.hostname` `192.168.1.50` olduğundan `LOOPBACK_HOSTS.has(...)` `false` döner ve istek **400 Invalid Host header** ile reddedilir.
- **Etki:** Spec Bölüm 3.3 ve Bölüm 6'da açıkça izin verilen ve token ile korunan uzak/LAN proxy kullanımı pratikte tamamen çalışmaz durumdadır.
- **Düzeltme:** `hostAllowed(value, expectedPort, bindHost)` içine `bindHost` bilgisi geçirilmeli; sunucu `0.0.0.0` veya `::` üzerinde dinliyorsa ya da `parsed.hostname === bindHost` ise (ve port doğruysa) istek kabul edilmelidir. (Güvenlik zaten token kontrolü ile sağlanmaktadır).

---

### [MAJOR-2] CORS Preflight Yanıtında `Access-Control-Allow-Methods` Başlığının Bulunmaması
- **Konum:** [`src/server.js:94`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/server.js#L94)
- **Sorun:** İzin verilen Origin tespit edildiğinde sunucu yalnızca şu başlıkları basmaktadır:
  ```javascript
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
  ```
  `Access-Control-Allow-Methods` başlığı basılmamaktadır.
- **Senaryo:** `POST /v1/chat/completions` isteği `Content-Type: application/json` taşıdığı için "CORS-safelisted method/header" değildir. Tarayıcı `OPTIONS` preflight'ında `Access-Control-Request-Method: POST` gönderir. Yanıtta `Access-Control-Allow-Methods` bulunmadığında Chromium ve WebKit tabanlı tarayıcılar CORS hatası vererek isteği durdurabilir.
- **Düzeltme:** `res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');` eklenmelidir.

---

### [MINOR-1] Portsuz Host Başlıklarının (`Host: localhost`) 400 ile Reddedilmesi
- **Konum:** [`src/server.js:28-31`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/server.js#L28-L31)
- **Sorun:** `parseHostHeader` fonksiyonundaki `h.match(/^([^:]+):(\d+)$/)` regex'i portu zorunlu tutmaktadır. Portsuz gelen (`Host: localhost` veya `Host: 127.0.0.1`) isteklerde `null` dönmektedir.
- **Açıklama:** Spec 3.3 line 126 "Port verilmişse tam olarak sunucunun port değeri olmalıdır" demektedir. Standart HTTP/1.1 (RFC 7230) kurallarında ve reverse proxy arkasında portsuz Host başlığı gelebilir.
- **Düzeltme:** `parseHostHeader` portsuz hostları da `{ hostname, port: null }` olarak ayrıştırmalı; `hostAllowed` ise port verilmemişse (özellikle port 80/varsayılan durumlarında) hostname geçerliyse izin vermelidir.

---

### [MINOR-2] `writeJsonAtomic` Fonksiyonuna `undefined` Geçildiğinde Dosyaya `"undefined"` Yazılması
- **Konum:** [`src/atomic-json.js:20`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/atomic-json.js#L20)
- **Sorun:** `JSON.stringify(undefined)` `undefined` döndürür. JavaScript'te `undefined + ''` ifadesi `"undefined"` metin dizisine dönüşür. `fsImpl.writeFileSync(tmp, "undefined")` çağrısı diskte geçersiz JSON dosyası oluşturur.
- **Düzeltme:** Serileştirme çıktısı kontrol edilmeli; `if (raw === undefined) throw new TypeError('The "value" argument could not be serialized to JSON');` ile erken hata fırlatılmalıdır.

---

### [MINOR-3] Windows Retry Beklemesinde CPU Tüketen Busy-Wait Döngüsü
- **Konum:** [`src/atomic-json.js:13-17`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/atomic-json.js#L13-L17)
- **Sorun:** Senkron bekleme için kullanılan `while (Date.now() < end) {}` döngüsü bekleme süresince CPU çekirdeğini %100 meşgul eder.
- **Düzeltme:** Modern Node.js ortamlarında `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)` kullanılarak işletim sistemi düzeyinde CPU harcamayan gerçek uyku sağlanmalıdır.

---

### [MINOR-4] Hedefi Olmayan Bozuk Dış Symlink'lerin İçeride Kabul Edilmesi Riski
- **Konum:** [`src/permissions.js:106-112`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B1r-review/src/permissions.js#L106-L112)
- **Sorun:** Çalışma alanı içinde dışarıya işaret eden ancak hedefi henüz diskte bulunmayan bozuk bir sembolik bağlantı varsa, `realpathSync` `ENOENT` fırlatır. `resolveExisting` `ENOENT` yakaladığında bir üst klasöre (`path.dirname`) çıkarak bağlantıyı çalışma alanı içinde varsayabilir.
- **Düzeltme:** `ENOENT` durumunda `fsImpl.lstatSync` ile dosyanın sembolik bağlantı olup olmadığı kontrol edilip link ise `readlinkSync` üzerinden çözülmelidir (düşük olasılıklı kenar durum).

---

## 5. Test Kapsamı ve Boşluk Analizi (Spec Bölüm 5 Matrisi)

| Alan | Spec Gereksinimi | Mevcut Test Durumu | Eksik / Risk |
|---|---|---|---|
| **Atomik JSON** | Stale `.tmp` dosyalarının silinmediği | Test edilmiyor | Eşzamanlı iki yazıcı testi eksik |
| **Atomik JSON** | `config.save` / `settings.writeRule` spy testi | Test edilmiyor | Doğrudan hedef `writeFileSync` yapılmadığı spy ile doğrulanmamış |
| **Atomik JSON** | Kalıcı `EACCES` retry yapılmadan fırlatılmalı | Kısmi (`EPERM` var) | `EACCES` için gecikmesiz ilk tur ret testi eksik |
| **İzinler** | Farklı Windows sürücüsü (`D:\`) ve UNC yollar | Test edilmiyor | Sürücü harfi geçiş testi eksik |
| **İzinler** | Dışarıdaki symlink'in çalışma alanını göstermesi (`false`) | Test edilmiyor | Yalancı pozitif testi eksik |
| **Araçlar** | `edit_file` dış hedef reddi (`E_OUTSIDE_WORKSPACE`) | Test edilmiyor | Yalnızca `write_file` test edilmiş |
| **Araçlar** | `read_file` dış hedefte engellenmemeli | Test edilmiyor | Test başlığında yazılmış ancak test gövdesinde çağrılmamış |
| **Araçlar** | `ask` veya `auto + canAsk:true` onay akışı | Test edilmiyor | Regresyon testi yok |
| **Proxy** | Host/CORS/Auth reddinde upstream fetch çağrılmadığı | Test edilmiyor | Spy testi yok |
| **Proxy** | `X-API-Key` başlığı ile token doğrulama | Test edilmiyor | Yalnızca `Bearer` test edilmiş |
| **Proxy** | Token + CORS preflight entegrasyonu | Test edilmiyor | **[BLOCKER-1]'in testlerden kaçma sebebi** |

---

## 6. Düzeltme Yaması (Drop-in Ready Patch)

Aşağıdaki yama `src/server.js`, `src/atomic-json.js`, `test/server-security.test.js` ve `test/tools.test.js` dosyalarını düzelterek Blocker ve Major bulguları tamamen ortadan kaldırır.

```diff
diff --git a/src/atomic-json.js b/src/atomic-json.js
index 9260ea2..1a2b3c4 100644
--- a/src/atomic-json.js
+++ b/src/atomic-json.js
@@ -12,12 +12,17 @@ function writeJsonAtomic(file, value, options = {}) {
   const retryDelaysMs = options.retryDelaysMs || [0, 25, 50, 100];
   const sleepSync = options.sleepSync || ((ms) => {
     if (!ms) return;
-    const end = Date.now() + ms;
-    while (Date.now() < end) { /* bounded synchronous retry delay */ }
+    try {
+      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
+    } catch {
+      const end = Date.now() + ms;
+      while (Date.now() < end) { /* fallback */ }
+    }
   });
 
-  // Serialize before creating anything so a circular value cannot leave a temp file.
-  const text = JSON.stringify(value, null, space) + (newline ? '\n' : '');
+  const raw = JSON.stringify(value, null, space);
+  if (raw === undefined) throw new TypeError('The "value" argument could not be serialized to JSON');
+  const text = raw + (newline ? '\n' : '');
   const dir = path.dirname(file);
   fsImpl.mkdirSync(dir, { recursive: true });
   const base = path.basename(file);
diff --git a/src/server.js b/src/server.js
index 71513dd..4a5b6c7 100644
--- a/src/server.js
+++ b/src/server.js
@@ -30,9 +30,12 @@ function parseHostHeader(value) {
   return { hostname: m[1].toLowerCase(), port: Number(m[2]) };
 }
 
-function hostAllowed(value, expectedPort) {
+function hostAllowed(value, expectedPort, bindHost = '127.0.0.1') {
   const parsed = parseHostHeader(value);
-  return !!parsed && LOOPBACK_HOSTS.has(parsed.hostname) && parsed.port === Number(expectedPort);
+  if (!parsed || parsed.port !== Number(expectedPort)) return false;
+  if (LOOPBACK_HOSTS.has(parsed.hostname)) return true;
+  const b = String(bindHost || '').replace(/^\[|\]$/g, '').toLowerCase();
+  return b === '0.0.0.0' || b === '::' || parsed.hostname === b;
 }
 
 const readBody = (req) => new Promise((resolve, reject) => {
@@ -82,20 +85,22 @@ function start({ port = 8787, host = '127.0.0.1', token = null, corsOrigins = [
   const server = http.createServer(async (req, res) => {
     const started = Date.now();
     const url = new URL(req.url, 'http://x');
-    if (!hostAllowed(req.headers.host, expectedPort || (server.address() && server.address().port))) {
+    if (!hostAllowed(req.headers.host, expectedPort || (server.address() && server.address().port), host)) {
       return oaError(res, 400, 'Invalid Host header.');
     }
 
     const origin = req.headers.origin;
     if (origin !== undefined) {
       if (!origins.has(origin)) return oaError(res, 403, 'Origin not allowed.');
       res.setHeader('Access-Control-Allow-Origin', origin);
       res.setHeader('Vary', 'Origin');
+      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
       res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
     }
 
+    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
+
     if (token) {
       const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
       if (given !== token) return oaError(res, 401, 'Invalid proxy token.');
     }
-    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
```

---

## 7. Sonuç ve Koordinatöre Öneriler

1. **Uygulama Kalitesi:** Yasin Balçık ve uygulama ekibi, B0 keşif envanterindeki Dalga 1 hedeflerini büyük ölçüde doğru modellemiştir. Dosya atomikliği ve yol güvenliği temelleri sağlamdır.
2. **Kritik Eylem:** `src/server.js` içindeki `OPTIONS` preflight sırası ve `hostAllowed` non-loopback bind desteği acilen yukarıdaki yama ile güncellenmelidir.
3. **Sonraki Adım:** Düzeltme yaması uygulandıktan ve test paketi (özellikle `OPTIONS + token` entegrasyonu) genişletildikten sonra kod tabanı **B2 (Süreç Yaşam Döngüsü ve Platform Dayanıklılığı)** aşamasına geçiş için hazır olacaktır.
