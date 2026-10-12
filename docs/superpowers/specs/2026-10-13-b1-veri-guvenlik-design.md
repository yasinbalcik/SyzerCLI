# SyzerCLI veri bütünlüğü ve güvenlik sertleştirmesi tasarım spesifikasyonu

**Tarih:** 2026-10-13  
**Kart:** B1 (SPEC, kod değişikliği yok)  
**Kaynak:** `C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/docs/syzer-iyilestirme/B0-ENVANTER.md`, özellikle Dalga 1 ve Dalga 3  
**Uygulama sahibi:** Yasin onayından sonra atanacak ayrı worker  
**İnceleme sahibi:** Uygulamadan sonra atanacak ayrı review worker  
**Bu kartın yazma sınırı:** yalnızca bu dosya; `src/` ve `test/` değişmez.

## 1. Amaç ve başarı ölçütleri

Bu tasarım, SyzerCLI’nin yapılandırma/API anahtarı JSON’larını yarım yazımdan korur, dosya araçlarının sembolik bağlantı/junction üzerinden çalışma alanı sınırını aşmasını engeller ve yerel OpenAI uyumlu proxy’yi tarayıcı kaynaklı yetkisiz çağrılara karşı daraltır.

Başarı ölçütleri:

1. `config.json`, `keys.<provider>.json` ve proje ayarlarının yazımı tek bir `tmp + rename` JSON yardımcısından geçer. Süreç yazım sırasında sonlandırılsa hedefte eski geçerli JSON veya yeni geçerli JSON kalır; 0 baytlık hedef oluşturulmaz.
2. Windows’ta hedef dosya geçici olarak kilitliyse yalnızca sınırlı `EBUSY`/`EPERM` yeniden denemesi yapılır; denemeler bitince eski hedef korunur ve hata kaynağa bildirilir.
3. `isOutside(cwd, p)` mevcut ve var olmayan hedeflerde gerçek yolları karşılaştırır. Symlink/junction ile dışarı çıkan yollar dışarı kabul edilir. `perm === 'auto' && canAsk === false` iken dışarı yazma, izin kuralı olsa dahi reddedilir ve A5 hata sözleşmesine uyar.
4. `server.js` yalnızca loopback Host değerlerini ve beklenen portu kabul eder; `*` CORS kaldırılır. `Origin` olmayan `OPENAI_BASE_URL` istemcileri çalışmaya devam eder. Loopback dışı bind için token zorunludur.
5. Yeni davranışlar birim/entegrasyon testleriyle kanıtlanır; özellikle `tools` ve `permissions` için ilk doğrudan test dosyaları eklenir. Mevcut testlerin ve mevcut config dosyalarının biçimi korunur.

## 2. Mevcut durum

### 2.1 Veri yazımı

- `src/config.js:28` `readJson` hatalı/olmayan JSON’da `null` döndürür.
- `src/config.js:29-32` `writeJson` dizini oluşturup `fs.writeFileSync(p, JSON.stringify(...), { mode: 0o600 })` ile doğrudan hedefe yazar.
- `src/config.js:47-49, 73-85, 96-106, 109-115` sağlayıcı anahtarları, eski biçim göçü, normal config kaydı ve sağlayıcı değişimi bu yardımcıyı kullanır; dolayısıyla doğrudan yazım API anahtarı dosyalarını da kapsar.
- `src/settings.js:61-69` `writeRule` ve `src/settings.js:72-79` `removeRule` doğrudan `fs.writeFileSync` kullanır; `mode` verilmez.
- Tutarlı örnekler: `src/key-health.js:24-29` (`.tmp` + `renameSync`, `0o600`), `src/sessions.js:26-30` ve `src/checkpoints.js:24-28` (`.tmp` + `renameSync`). Bu örneklerde Windows kilitli hedef için retry yoktur; B1 yardımcısının davranış sözleşmesi bunlarla aynı atomiklik modelini, ilave sınırlı retry ile standardize eder.

### 2.2 Çalışma alanı sınırı

- `src/permissions.js:91-94` `isOutside` yalnızca `path.relative(cwd, path.resolve(cwd, p))` sonucunu sözel olarak kontrol eder; gerçek yol çözmez.
- `src/tools.js:444-461` dosya aracı değişikliğini hazırlar, ardından `outside` hesaplar. `needAsk` ifadesi `auto + outside + canAsk` koşulunu gerektirir; `canAsk:false` olduğunda dışarı yazma sessizce ilerleyebilir.
- `src/tools.js:460` B1’deki tek mevcut `isOutside` çağrı noktasıdır; hata reddi burada merkezi biçimde uygulanmalıdır.

### 2.3 Yerel proxy

- `src/server.js:50-52` `start` varsayılan olarak `127.0.0.1:8787` üzerinde ve `token = null` ile başlar.
- `src/server.js:55-65` her istekte `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *` yazar; `OPTIONS` hemen döner; token yalnızca verilmişse kontrol edilir. Host başlığı doğrulanmaz.
- `src/server.js:166-170` `OPENAI_BASE_URL` ve `OPENAI_API_KEY` kullanım bilgisini verir. Origin başlığı olmayan CLI/OpenAI istemcileri bu akıştan yararlanır ve korunmalıdır.

## 3. Hedef tasarım

### 3.1 A — Tek atomik JSON yazma yardımcısı

#### API

Yeni, bağımlılığı olmayan bir modül (önerilen yol: `src/atomic-json.js`) şu senkron API’yi sağlar:

```js
writeJsonAtomic(file, value, {
  space: 2,
  mode: 0o600,
  newline: false,
  fsImpl,             // test enjeksiyonu; varsayılan fs
  renameAttempts: 4, // ilk deneme + en fazla 3 retry
  retryDelaysMs: [0, 25, 50, 100],
  sleepSync,          // üretimde sınırlı bekleme, testte no-op
});
```

Sözleşme:

1. `value` `JSON.stringify(value, null, space)` ile serileştirilir; `newline` seçeneği yalnızca çağıran açıkça isterse eklenir. Config/settings mevcut girinti ve dosya biçimini korur.
2. `path.dirname(file)` recursive oluşturulur. Geçici dosya hedefle aynı dizinde, benzersiz bir sibling adla (`<basename>.<pid>.<random>.tmp`) açılır; böylece rename aynı dosya sistemi üzerinde kalır.
3. Geçici dosya UTF-8 ve `mode: 0o600` ile yazılır; POSIX’te gerekirse ayrıca `chmodSync(tmp, 0o600)` çağrılır. Rename sonrası yeni dosya 0o600’dür. Windows’ta `mode` ACL yerine geçmez; yalnızca mevcut Node davranışıyla uyumlu en iyi çabadır.
4. Yazım tamamlanınca yalnızca `renameSync(tmp, file)` ile hedef değiştirilir. Hedef silinerek boşluk yaratılmaz; rename başarısız olursa eski hedefe dokunulmaz.
5. `EPERM` veya `EBUSY` için `[0,25,50,100]` ms ile en fazla dört rename denemesi yapılır. Başka hata kodları retry edilmez. Son hata yeniden fırlatılır; geçici dosya `finally` içinde yalnızca kendi adı için temizlenmeye çalışılır.
6. Yardımcı, `fsImpl` ve `sleepSync` enjeksiyonu sayesinde gerçek dosya sistemi olmadan retry/cleanup testine izin verir. Üretim çağrıları senkron kalır; config/settings çağrı sözleşmesi değişmez.

`src/config.js:29-32` içindeki yerel `writeJson` kaldırılarak bu modül çağrılır. `src/settings.js:61-79` içindeki iki doğrudan yazım da aynı yardımcıyı kullanır. `key-health.js`, `sessions.js` ve `checkpoints.js` B1’de davranış referansı olarak kalır; bu kartta onların veri formatı veya public API’si değiştirilmez. Yardımcıdaki temp sibling, rename ve 0o600 kuralları bu mevcut yazımlarla tutarlı olmalıdır.

#### Kenar durumları ve Windows

- JSON serileştirme başarısızsa temp dosya hedefe rename edilmeden hata fırlatılır.
- Hedef dosya yoksa ilk rename normal çalışır; hedef mevcutsa replace semantiği platforma bırakılır, `EPERM`/`EBUSY` yalnızca sınırlı retry alır.
- Antivirüs, editör veya başka worker hedefi kısa süreli kilitlerse retry aralığı toplamda 175 ms’yi geçmez. Kalıcı kilitte kullanıcıya gerçek hata döner; eski config/key dosyası korunur.
- Çökmüş eski `.tmp` dosyaları otomatik olarak topluca silinmez. Yeni çağrı yalnızca kendi benzersiz temp adını temizler; bu, başka sürecin yazısını silme riskini önler.
- `fs.renameSync` başarılı olduktan sonra temp dosyanın yokluğu başarı kabul edilir. `chmod` yalnızca temp üzerinde yapılır; rename sonrası veri atomikliği için hedef üzerinde ikinci yazım yapılmaz.

### 3.2 B — Gerçek-yol çalışma alanı sınırı

#### API ve algoritma

`src/permissions.js:isOutside(cwd, p)` şu saf gözlem sözleşmesini korur: `true` dışarıda, `false` çalışma alanı içinde.

1. `workspaceAbs = path.resolve(cwd)` ve `targetAbs = path.resolve(workspaceAbs, p || '.')` hesaplanır.
2. Hem çalışma alanı hem hedef için `fs.realpathSync.native` kullanılır.
3. Hedef var değilse, hedeften yukarı doğru en yakın var olan ancestor bulunur; ancestor gerçeklenir ve daha önce çıkarılan var olmayan parçalar tekrar eklenir. Böylece `workspace/link/new/file` yolunda `link` dışarıdaki bir junction ise yeni dosya da dışarı kabul edilir.
4. `cwd` veya en yakın ancestor gerçeklenemiyorsa güvenli varsayım `outside === true` olur; `ENOENT` yalnızca ancestor aramak için beklenen durumdur. `EACCES`, `EPERM`, `EINVAL` gibi erişim/biçim hataları dışarı kabul edilip ayrıntı log’a sızdırılmaz.
5. Gerçek yollar `path.relative(realWorkspace, realTarget)` ile karşılaştırılır. Sonuç `..` ile başlıyor veya mutlak ise dışarıdır. Windows sürücü harfi, ayırıcı ve büyük/küçük harf normalizasyonu Node `path`/`realpath` katmanına bırakılır; karşılaştırma için ham kullanıcı metni kullanılmaz.

Bu kontrol bir preflight kontrolüdür; dosya sistemi TOCTOU yarışını tek başına ortadan kaldırmaz. Uygulama worker’ı gerçek-yol kontrolünü mutation’dan hemen önce çağırmalı ve kontrol başarısızsa hiçbir `writeFile`/`mkdir` yan etkisi başlatmamalıdır.

#### `auto` + `canAsk:false` reddi ve hata sözleşmesi

`src/tools.js:455-461` akışı şu sıraya getirilir:

```text
outside = FILE_WRITE && permissions.isOutside(cwd, a.path)
if (outside && session.perm === 'auto' && session.canAsk === false)
  return P.failure('E_OUTSIDE_WORKSPACE', ...)
// sonra mevcut prepareChange / allowedByRule / confirm akışı
```

Bu guard, `allowedByRule` değerinden önce çalışır; headless/alt ajan `-y` yolu bir allow kuralıyla dahi workspace dışına sessizce yazamaz. `ask` modu ve `auto + canAsk:true` mevcut onay akışını korur; kullanıcı onay verirse davranış değişmez.

Makine içi neden kodu `E_OUTSIDE_WORKSPACE` olarak taşınır. A5’in mevcut `ERR_<CODE>:` formatter’ına bu kod verildiğinde dış araç çıktısı `ERR_E_OUTSIDE_WORKSPACE: ...` biçimindedir; stack trace, mutlak secret yolu veya dosya içeriği eklenmez. Uygulama worker’ı bu eşlemeyi `prompts.error`/`P.failure` üzerinden tek noktada yapmalıdır.

#### Kenar durumları ve Windows

- Var olan normal dosya/dizin, var olmayan son parça, `..` traversal, mutlak yol, farklı sürücü (`D:`), UNC yol ve trailing separator ayrı test edilir.
- Symlink dosya ve symlink/junction dizin için gerçek hedef karşılaştırılır; link workspace içinde görünse bile gerçek hedef dışarıdaysa reddedilir.
- Windows’ta symlink oluşturma yetkisi yoksa symlink testi başarısız sayılmaz; test `EPERM`/`EACCES` yakalayıp `t.skip()` ile atlanır. Junction testi mümkünse yönetici gerektirmeyen dizin junction ile yapılır; o da kullanılamıyorsa aynı skip kuralı geçerlidir.
- Gerçekleme sırasında erişim reddi güvenli tarafta kalır (`outside=true`). POSIX’te `/tmp` veya `/etc` gibi hedefler yalnızca test temporary workspace’inden referanslanır; gerçek kullanıcı dosyalarına yazılmaz.

### 3.3 C — `server.js` proxy sertleştirmesi

#### Host doğrulama

`start` içinde bağlanan `host` ve `port` kapanımda tutulur. Her istek, auth/CORS’tan önce `req.headers.host` değerini doğrular:

- Kabul edilen hostname’ler: `127.0.0.1`, `localhost`, `[::1]` (büyük/küçük harf yalnızca DNS adı için normalize edilir).
- Port verilmişse tam olarak sunucunun `port` değeri olmalıdır. Varsayılan 8787 için `127.0.0.1:8787`, `localhost:8787`, `[::1]:8787` geçerlidir.
- Host yok, bozuk IPv6 sözdizimi, farklı hostname, farklı port veya DNS adı (`*.localhost` dahil) 400/403 ile reddedilir; upstream’e istek gönderilmez.
- Host başlığı parser’ı elle `split(':')` yapmaz; bracket’lı IPv6 ve port ayrımı için standart URL/host parser veya küçük, testli yardımcı kullanır.

Bu kontrol DNS rebinding’de gelen `Host: attacker.example` isteğini loopback soketine ulaşsa dahi durdurur. Sunucu loopback dışı bir adrese bind ediliyorsa (ör. `0.0.0.0`, LAN IP), start aşamasında token yokluğu hata olarak reddedilir; süreç token’sız açık proxy olarak başlatılmaz. Loopback bind’lerde token geriye dönük olarak isteğe bağlıdır; token verilmişse her host için yine zorunlu doğrulama yapılır.

#### CORS ve Origin geriye uyumluluğu

- `Access-Control-Allow-Origin: *` ve `Access-Control-Allow-Headers: *` kaldırılır.
- Varsayılan izin listesi boştur. İhtiyaç varsa `start` seçeneği veya mevcut CLI yapılandırmasına eklenecek açık `corsOrigins: string[]` listesi kullanılabilir; yalnızca listedeki tam origin için `Access-Control-Allow-Origin: <origin>` ve `Vary: Origin` yazılır.
- İzinli Origin için `OPTIONS` yanıtı 204 ve sınırlı `Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Key` döner. Listede olmayan Origin 403 alır; wildcard veya `null` kabul edilmez.
- `Origin` başlığı olmayan isteklerde hiçbir CORS başlığı yazılmaz ve mevcut endpoint/auth akışı aynen devam eder. Böylece `OPENAI_BASE_URL` kullanan CLI, SDK ve curl istemcileri etkilenmez.
- `Origin` varsa CORS kararı Host ve token doğrulamasını gevşetmez; iki katman da geçmelidir.

#### Token politikası

- `token` doluysa mevcut `Authorization: Bearer` veya `X-API-Key` kontrolü korunur.
- Bind host loopback kümesinin dışındaysa `token` boş/null kabul edilmez; başlangıçta açık bir hata veya `server.on('error')` ile süreç başlatma başarısız olur.
- Token log’a yazılmaz. Mevcut başlangıç mesajındaki `OPENAI_API_KEY=<token veya anything>` davranışı değiştirilirken gerçek token hiçbir zaman gösterilmez; token etkinse yalnızca `required` yazılır.

## 4. Geriye uyumluluk ve göç

### Config/settings dosyaları

- JSON şeması, anahtar adları, sağlayıcı dosya adları, göç mantığı ve `readJson` davranışı değişmez. Yeni helper yalnızca yazma mekanizmasını değiştirir.
- Mevcut geçerli `config.json`, `keys.<provider>.json` ve `.syzer/settings*.json` ilk başarılı kayıtta aynı içerik/indent ile yazılır; anahtarlar yeniden üretilmez veya maskelenmez.
- İlk yazımda dosya yoksa dizin oluşturulur ve yeni dosya 0o600 umulan modla açılır. Mevcut dosyanın modu atomik değiştirme ile yeni temp dosyanın moduna taşınır; Windows ACL’si ayrıca yönetilmez.
- Bozuk JSON için otomatik yedek/göç bu kartın kapsamı değildir; mevcut `readJson` null davranışı korunur. Uygulama worker’ı hata mesajında API anahtarı veya dosya içeriği döndürmemelidir.

### Proxy istemcileri

- `http://127.0.0.1:8787/v1` ve `OPENAI_BASE_URL` ile çalışan Origin’siz istemciler, token verilmemiş loopback başlatmada çalışmaya devam eder.
- Tarayıcıdan gelen eski wildcard-CORS çağrıları kasıtlı olarak geriye dönük desteklenmez; kullanıcı açık origin listesi tanımlamalıdır.
- `localhost` ve `[::1]` Host’ları kabul edilir; port mismatch ve dış Host reddedilir. Loopback dışı kullanım artık token gerektirir.
- Endpoint yolları, OpenAI response gövdesi, `health`, `usage`, model ve stream davranışı bu kartta değiştirilmez.

## 5. Test stratejisi

Bu kart test kodu eklemez; aşağıdaki liste uygulama worker’ı ve review worker’ı için kabul matrisi olarak bağlayıcıdır.

### 5.1 Atomik JSON (`test/atomic-json.test.js`)

- Yeni dosya ve mevcut dosya için JSON parse edilebilirliği, 2-space biçim ve hedefte 0o600 modu.
- Temp dosyanın hedefle aynı dizinde olması; başarılı rename sonrası temp kalmaması.
- `fsImpl.renameSync` ilk 1–3 çağrıda `EPERM`/`EBUSY`, sonra başarı: tam retry ve gecikme enjeksiyonu doğrulanır.
- Kalıcı `EPERM`, `EACCES`, serileştirme hatası: hata dışarı çıkar, eski hedef içeriği ve modu korunur.
- Eşzamanlı görünen iki temp adı birbirini ezmez; stale `.tmp` dosyası silinmez.
- `config.save/switchProvider` ve `settings.writeRule/removeRule` entegrasyonunda içerik aynı kalır ve doğrudan `writeFileSync(target)` çağrısı yapılmadığı spy ile doğrulanır.

### 5.2 İzinler (`test/permissions.test.js`)

- İç dosya, `..` traversal, mutlak dış yol, farklı Windows sürücüsü/UNC ve var olmayan son hedef.
- Workspace içindeki symlink/junction’ın dış hedefe işaret etmesi: `isOutside === true`.
- Workspace dışındaki symlink’in içeri işaret etmesi: hedefin gerçek yolu içerdeyse `false` (link’in sözel konumu tek başına karar değildir).
- `realpath` erişim hatası: güvenli biçimde `true`.
- Windows symlink/junction oluşturma `EPERM`/`EACCES` verirse test `t.skip('symlink privilege unavailable')` ile atlanır; test paketi başarısız sayılmaz. Skip nedeni ve platform `diagnostic` olarak görünür.

### 5.3 Araçlar (`test/tools.test.js`)

- `write_file` ve `edit_file` için `perm:auto, canAsk:false` + dış hedef: `ok:false`, makine kodu `E_OUTSIDE_WORKSPACE`, çıktı `ERR_E_OUTSIDE_WORKSPACE:`; dosya oluşturulmadığı doğrulanır.
- Aynı durumda `allowedByRule:true` olsa dahi reddin sürdüğü doğrulanır.
- `ask` veya `auto + canAsk:true` için mevcut confirm/deny/always akışları regresyon testiyle korunur.
- İç hedefte `auto + canAsk:false` yazma ve edit başarıyla sürer.
- `read_file` dış hedefi yazmadığı için bu yeni guard tarafından yanlışlıkla reddedilmez.

### 5.4 Proxy (`test/server-security.test.js`)

- Kabul: `Host: 127.0.0.1:8787`, `localhost:8787`, `[::1]:8787`; ret: eksik Host, dış hostname, yanlış port, malformed bracket.
- Varsayılan yanıtta `Access-Control-Allow-Origin` ve wildcard `Allow-Headers` bulunmaz.
- Origin’siz `/health` ve OpenAI chat isteği, token’sız loopback sunucuda mevcut sözleşmeyle çalışır.
- İzinli Origin listesi varsa yalnızca exact origin için CORS; başka Origin 403; `OPTIONS` davranışı doğrulanır.
- Token verildiğinde eksik/yanlış Bearer ve `X-API-Key` 401; doğru token başarılıdır. Bind host loopback dışındayken tokensız `start` reddedilir.
- Host/CORS/auth reddinde upstream `fetch` çağrılmadığı spy ile doğrulanır; token ve key log’lanmadığı kontrol edilir.

### 5.5 Mevcut test paketi ve platform matrisi

Uygulama worker’ı önce mevcut `npm test` paketini, sonra yukarıdaki yeni dosyaları çalıştırmalıdır. POSIX CI gerçek symlink senaryolarını koşar. Windows CI symlink yetkisini raporlar; yetki yoksa yalnızca ilgili test case’leri skip eder, geri kalan path/Host/atomic testleri zorunlu tutar. Review worker’ı skip’lerin koşulunun dar (`EPERM`/`EACCES`) olduğunu ve genel hata yutulmadığını incelemelidir.

## 6. Riskler ve geri alma

| Risk | Etki | Önlem / geri alma |
|---|---|---|
| Windows rename hedefi kalıcı kilitli | Config kaydı başarısız görünür | Eski hedefe dokunma, sınırlı retry, kullanıcıya açık hata; uygulama commit’i tek başına revert edilir. |
| Temp cleanup başka sürecin dosyasını siler | Veri kaybı | Benzersiz temp adı ve yalnızca o çağrının temp’ini cleanup et; glob/toplu silme yok. |
| `realpath` erişim hatası false-negative olur | Workspace dışına yazma | Hata durumunda `outside=true`; ilgili araç testi zorunlu. |
| Gerçek-yol kontrolü ile yazım arasında TOCTOU | Symlink sonradan değiştirilebilir | Kontrolü mutation’dan hemen önce yap; B1’de dosya descriptor tabanlı sandbox iddiasında bulunma. Gerekirse sonraki güvenlik kartına taşı. |
| CORS kaldırılması tarayıcı entegrasyonunu kırar | Eski web istemcisi çağrı yapamaz | Origin’siz CLI uyumluluğunu koru; kullanıcıya exact `corsOrigins` ayarı sağla; wildcard’a geri dönme. |
| Host allowlist özel proxy kullanımını reddeder | Uzak/LAN istemci çalışmaz | Loopback dışı kullanımda açık token zorunluluğu ve dokümante edilmiş bind/token seçeneği; sorunlu tek commit revert edilebilir. |
| Hata kodu metin eşlemesi yanlış uygulanır | Otomasyon parse edemez | İç `E_OUTSIDE_WORKSPACE` ve dış `ERR_E_OUTSIDE_WORKSPACE:` golden testi; A5 formatter’ını tek kaynak yap. |

Geri alma, uygulama worker’ının tek commit’ini `git revert <commit>` ile geri almaktır. Bu spec ve B0 envanteri korunabilir; mevcut config dosyalarına geri alma sırasında yazma yapılmaz. Push/merge bu kartın kapsamında değildir.

## 7. Yasin’e sorulacak açık kararlar

1. **Yardımcı modül adı ve konumu:** `src/atomic-json.js` öneriyorum; bağımlılıksız, `fsImpl` enjeksiyonlu ve yalnız JSON sorumluluğu net kalır.
2. **Windows retry zamanlaması:** önerim toplam 175 ms’yi aşmayan `[0,25,50,100]` ms ve dört toplam deneme; kullanıcı deneyimi ile antivirüs/VS Code kilitleri arasında dengelidir.
3. **CORS yapılandırması:** önerim varsayılan boş exact-origin listesi; yalnızca açık `corsOrigins` verildiğinde CORS başlığı üretmek ve wildcard’ı kalıcı olarak kaldırmaktır.
4. **Loopback tanımı:** önerim `127.0.0.1`, `localhost` ve `[::1]`’i güvenilir loopback kabul etmek; bunların dışındaki bind adreslerinde token’ı başlangıçta zorunlu kılmaktır.
5. **Dış hata kodu yazımı:** önerim A5 formatter’ına doğrudan `E_OUTSIDE_WORKSPACE` verip `ERR_E_OUTSIDE_WORKSPACE:` üretmek; böylece istenen makine kodu kaybolmaz ve mevcut `ERR_<CODE>:` sözleşmesi değişmez.
