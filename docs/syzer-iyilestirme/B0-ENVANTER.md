# B0 Keşif Envanteri: SyzerCLI Altyapı Sağlamlığı (Infrastructure Robustness & Reliability)

**Tarih:** 2026-10-13  
**Kart:** B0 (Alan B: Altyapı Sağlamlığı)  
**Rol:** B0 | L2 | Kart B0 (KEŞİF, altyapı sağlamlığı)  
**Üst Şef:** Koordinatör (Claude Sonnet 5.5 / Orca)  
**Çalışma Alanı:** `syzer-B0` (`feat/syzer-B0` / `yasinbalcik/syzer-B0`)  
**Hedef:** SyzerCLI kod tabanındaki işlem yönetimi, ağ dayanıklılığı, dosya sistemi atomikliği, eşzamanlılık, güvenlik sınırları, köprüler ve test altyapısını `dosya:satır` kesinliğiyle haritalamak; mimari zayıflıkları, yarış durumlarını (race conditions), yetim süreç (orphan process) risklerini ve platform tutarsızlıklarını belgelemek; kod dosyalarında 0 değişiklik (`git diff --stat` kod dosyalarında boş) bırakmak.

---

## 1. Yönetici Özeti ve Mimari Durum

SyzerCLI v3.29.0; OpenRouter, NVIDIA ve özel sağlayıcılar üzerinden çalışan çoklu anahtar havuzlu, alt ajan ve orkestrasyon kabiliyetine sahip bir terminal ajanıdır. A (Prompt & Çıktı Kalitesi) ve E (Web Arayüzü) alanlarındaki iyileştirmelerin ardından kod tabanı işlevsel olarak olgunlaşmış ve 266 birim/entegrasyon testine ulaşmıştır.

Ancak altyapı ve çalışma zamanı dayanıklılığı incelendiğinde, **7 kritik alanda** yapısal kırılganlıklar, platform uyumsuzlukları ve veri kaybı riskleri tespit edilmiştir:

1. **Kabuk ve Süreç Yaşam Döngüsü (Process & Shell Lifecycle):** Windows üzerinde `powershell.exe` çağrılarında kod sayfası/UTF-8 çıktı bozulmaları, `killTree` fonksiyonunun asenkron ve denetimsiz çalışması, POSIX tarafında `child.kill('SIGTERM')` çağrısının süreç ağacını (process group) öldürememesi sonucu oluşan yetim (orphan/zombie) süreçler.
2. **Ağ ve API Direnci (Network & API Resilience):** SSE akışında `STALL_MS` bekçisinin varlığına rağmen, `res.body` okuma döngüsünde istisnai ağ kopmalarında soket sızıntısı riski; 429 üstel geri çekilmesinde (`retry429`) tek anahtar havuzu kilitleme mekanizmasının olmaması.
3. **Dosya Sistemi ve Durum Atomikliği (Filesystem & State Atomicity):** `config.js` ve `settings.js` modüllerinde `fs.writeFileSync` ile doğrudan dosya üzerine yazılması (ani elektrik kesintisi veya süreç sonlanmasında 0 baytlık bozuk JSON riski); Windows NTFS üzerinde `fs.renameSync` çağrılarının kilitli dosyalarda `EBUSY`/`EPERM` fırlatması; yol karşılaştırmalarında büyük/küçük harf ve sürücü harfi normalizasyon eksiklikleri.
4. **Eşzamanlılık ve Orkestrasyon Güvenliği (Concurrency & Orchestration):** `orchestra.js` içindeki `runPlan` fonksiyonunun aynı dalga içindeki tüm bağımsız alt ajanları eşzamanlı başlatırken ortak dosya yazma çakışmalarını denetlememesi; `subagents.js` içindeki `gate` yapısının iptal sinyallerine (`AbortSignal`) duyarsız beklemesi.
5. **Güvenlik, İzinler ve İzolasyon (Security & Sandboxing):** `server.js` yerel proxy'sinde `Access-Control-Allow-Origin: *` ile açık CORS bırakılması ve `Host` doğrulamasının bulunmaması; `permissions.js` içindeki `isOutside` kontrolünün symlink/junction çözümü yapmaması; `perm === 'auto'` modunda `canAsk: false` iken çalışma alanı dışına yazma izninin sessizce verilmesi.
6. **Harici Köprüler ve Entegrasyonlar (External Bridges & MCP):** `mcp.js` içinde Windows platformunda `spawn(..., { shell: true })` komut dizgileme açığı (`\"` tırnaklama kusuru); `mcp.js` `close()` metodunun süreç ağacını öldürmeyerek yetim MCP sunucuları bırakması; `orca-workers.js` içinde işçi sürecinin yaşayıp yaşamadığı denetlenmeksizin 15 dakika boyunca kör dosya yoklaması (`fs.existsSync`).
7. **Test Kapsamı Boşlukları (Test Coverage Blindspots):** `src/tools.js` dosya araçları (`read_file`, `write_file`, `edit_file`), kabuk komut yürütücüsü (`runShell`), MCP protokolü, yerel proxy sunucusu ve kural motoru için bağımsız, kapsamlı test paketlerinin bulunmayışı.

---

## 2. Bileşen Bazlı Derin Envanter (`dosya:satır` Referanslarıyla)

### 2.1. İşlem, Kabuk ve Süreç Yaşam Döngüsü

#### 2.1.1. Kabuk Başlatma ve Platform Ayrımı
- **Konum:** [`src/tools.js:129-133`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L129-L133)
- **Kod:**
  ```javascript
  function spawnShell(command, cwd) {
    return process.platform === 'win32'
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd })
      : spawn('sh', ['-c', command], { cwd, detached: false });
  }
  ```
- **Kırılma Noktaları:**
  1. **Windows Kod Sayfası ve UTF-8 Bozulması:** Windows PowerShell 5.1 (`powershell.exe`) varsayılan konsol kod sayfasını (OEM/ANSI, örn. CP1254/CP857) kullanır. `$OutputEncoding` ve `[Console]::OutputEncoding` UTF-8'e zorlanmadığı için Türkçe karakterler veya UTF-8 araç çıktıları (`stdout`/`stderr`) bozulur.
  2. **PowerShell 7 (`pwsh`) Önceliği Eksikliği:** Sistemde modern `pwsh` kurulu olsa dahi eski Windows PowerShell 5.1'e sabitlenmiştir.
  3. **Tırnaklama ve Sözdizimi Bozulması:** `-Command` parametresine geçirilen karmaşık komutlar Windows komut satırı ayrıştırma kuralları (`CreateProcessW`) nedeniyle çift tırnakların soyulmasına ve sözdizimi hatalarına yol açar.

#### 2.1.2. Süreç Ağacı Sonlandırma (`killTree`) ve Yetim Süreçler
- **Konum:** [`src/tools.js:135-140`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L135-L140), [`src/tools.js:148`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L148), [`src/tools.js:168-170`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L168-L170)
- **Kod:**
  ```javascript
  function killTree(child) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      else child.kill('SIGTERM');
    } catch { /* zaten bitmiş */ }
  }
  ```
- **Kırılma Noktaları:**
  1. **Windows Asenkron `taskkill`:** `spawn('taskkill', ...)` çağrısı sonucu beklenmeyen, hata dinleyicisi (`child.on('error')`) olmayan ateşle-ve-unut bir çağrıdır. Sistemde yetki veya PID yeniden kullanımı sorunu olursa yakalanamaz.
  2. **POSIX Süreç Grubu Kaçağı:** POSIX üzerinde `spawn('sh', ['-c', command], { detached: false })` ile başlatılan süreçte `child.kill('SIGTERM')` yalnızca `sh` kabuğuna sinyal gönderir; kabuğun altındaki alt süreçler (derleyiciler, sunucular, test koşucuları) süreç grubu öldürülmediği (`process.kill(-child.pid)`) için yetim (orphan) kalır.
  3. **Zaman Aşımında Takılma Riski:** `runShell` içinde zaman aşımına uğrayan çocuk süreç `killTree(child)` ile vurulur ancak `close` olayı tetiklenene kadar promise çözülmez. Eğer bir süreç `SIGTERM`'i yakalayıp yutarsa işlem sonsuza dek askıda kalabilir.

#### 2.1.3. Arka Plan Süreç Yönetimi (`run_background`, `bg_output`, `bg_stop`)
- **Konum:** [`src/tools.js:154-166`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L154-L166), [`src/tools.js:542-555`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L542-L555)
- **Kırılma Noktaları:**
  1. **Bellek Tamponu Sınırı:** `entry.out` maksimum 200.000 karakterle sınırlandırılmıştır (`tools.js:158`). Çok hızlı ve yoğun çıktı üreten süreçlerde dilimleme (`slice`) işlemi CPU yükü oluşturur.
  2. **Oturum Kapanışında Temizlik:** `killAll(session)` fonksiyonu yalnızca `session.bg` içindeki `done: false` olan süreçleri öldürür. CLI ani kapandığında (Ctrl+C veya `process.exit`) arka plan süreçleri sistemde asılı kalabilir.
  3. **ID Çakışması:** `bgCounter` modül düzeyinde tek bir global sayaçtır; oturumlar arası veya REPL sıfırlamalarında senkronizasyon sorunu yaratabilir.

#### 2.1.4. Headless & CI Çıkış Sözleşmesi ve Sinyal Yönetimi
- **Konum:** [`bin/syzer.js:126-210`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/bin/syzer.js#L126-L210), [`src/headless.js:6-17`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/headless.js#L6-L17)
- **Kırılma Noktaları:**
  1. **Tutamaç Boşaltma:** `bin/syzer.js:155` üzerinde `setTimeout(() => process.exit(exitCode), 500).unref()` ile asılı event loop tutamaçlarının çıkışı engellemesi önlenmeye çalışılmıştır. Ancak 500ms içinde tamamlanmayan yazma işlemleri (`writeOut`, `sessions.save`) yarım kalabilir.
  2. **Sinyal Dinleyicisi Sızıntısı:** `SIGINT` ve `SIGTERM` dinleyicileri `process.once` ile eklenip `finally` içinde kaldırılmaktadır; ancak alt ajan çağrılarında sinyal yayılımı (signal propagation) tek bir abort controller üzerinden yürütüldüğünden, derin ağaçlarda bazı alt işçiler sinyali geç alabilir.

---

### 2.2. Ağ İletişimi, API Dayanıklılığı, Key Havuzu ve Hata Kurtarma

#### 2.2.1. SSE Akış Ayrıştırması ve Takılma (Stall) Bekçisi
- **Konum:** [`src/api.js:40-153`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/api.js#L40-L153)
- **Bileşenler:**
  - `stallLimit(stallMs)`: Varsayılan 90.000 ms (`STALL_MS`), ortam değişkeni `SYZER_STALL_MS`.
  - `watchdog`: `arm()` her veri parçasında ve keep-alive yorumlarında süreyi sıfırlar (`src/api.js:53-56, 134`).
  - Çıktı başlatma bayrağı: `started = true` olduğunda oluşan takılmalarda `e.status = 0` atanır (`src/api.js:59, 115`).
- **Kırılma Noktaları:**
  1. **`res.body` Okuma Döngüsünde Soket İptali:** `for await (const chunk of res.body)` döngüsünde hata oluştuğunda veya `ctl.abort()` tetiklendiğinde `res.body.cancel()` çağrısının açıkça yapılmaması (`src/api.js:99` hariç) soket sızıntısına yol açabilir.
  2. **Parçalanmış SSE Satırları:** `TextDecoder` akış modunda kullanılmaktadır (`stream: true`); ancak uç noktadan gelen `data:` satırının tam JSON gövdesi birden çok satıra bölünürse (`\n\n` yerine tek `\n`), `handle(data)` çağrısı JSON parse hatası alıp sessizce atlar (`src/api.js:112`).
  3. **Araç Çağrısı Birleştirme İndeksi:** `calls[tc.index ?? 0]` parçalı `function.arguments` metinlerini birleştirir. Sağlayıcı indekssiz veya bozuk indeksli parça gönderirse argümanlar birbirine karışabilir (`src/api.js:126-130`).

#### 2.2.2. Sınırlı Eşzamanlılık ve 429 Geri Çekilme
- **Konum:** [`src/pool.js:7-51`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/pool.js#L7-L51)
- **Bileşenler:**
  - `DEFAULT_CONCURRENCY = 16`, ortam değişkeni `SYZER_POOL_CONCURRENCY` (1-64 aralığı).
  - `mapLimit(items, limit, fn)`: Sınırlı eşzamanlı worker havuzu.
  - `retry429`: 4 deneme, üstel bekleme (`800ms * 2^i + rand(250ms)`).
- **Kırılma Noktaları:**
  1. **Global Hız Sınırı Paylaşımı Yok:** `mapLimit` yerel bir dizi üzerinde çalışır. Ancak çok sayıda bağımsız süreç veya alt ajan aynı anda API'yi sorguladığında global bir sayaç/token bucket olmadığından tüm havuz topluca 429'a düşer.
  2. **Hata Yakalama ve Yayma:** `mapLimit` içinde `fn` hata fırlatmamalıdır (`src/pool.js:11`), ancak `fn` beklenmedik şekilde patlarsa `Promise.all` çöker ve geri kalan maddeler işlenmeden kalır.

#### 2.2.3. Key Sağlık Takibi, Soğuma ve Rotasyon
- **Konum:** [`src/key-health.js:1-95`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/key-health.js#L1-L95), [`src/keys.js:102-146`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/keys.js#L102-L146)
- **Bileşenler:**
  - Dosya: `~/.syzercli/key-health.json`.
  - Soğuma süreleri: `COOLDOWNS = [30sn, 2dk, 10dk]`.
  - Örneklem penceresi: `N = 20`, minimum örneklem: `MIN_SAMPLES = 3`.
- **Kırılma Noktaları:**
  1. **Dosya Kilidi Yokluğu ve Windows `renameSync` Riski:** `key-health.js:27-28` içinde yazma işlemi:
     ```javascript
     const tmp = `${file}.${process.pid}.tmp`;
     fsImpl.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
     fsImpl.renameSync(tmp, file);
     ```
     Windows üzerinde hedef dosya başka bir süreç (diğer Syzer worker'ı veya Orca) tarafından okunurken `renameSync` çağrısı `EPERM` veya `EBUSY` hatası verir. Satır 48'deki `catch { /* sağlık takibi asla isteği bozmaz */ }` hatayı yutar, ancak güncel istatistik kaybolur.
  2. **Senkron Dosya G/Ç Yükü:** Her API çağrısı sonucunda (`recordOutcome`) dosya baştan okunup (`read()`) diske yazılmaktadır (`write()`). Yüksek sorgu trafiğinde disk I/O darboğazı oluşturur.

#### 2.2.4. Model Yedekleme ve Rol Tabanlı Yönlendirme (Routing)
- **Konum:** [`src/models.js:10-45`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/models.js#L10-L45), [`src/agent.js:31-96`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/agent.js#L31-L96), [`src/routing.js:1-85`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/routing.js#L1-L85)
- **Kırılma Noktaları:**
  1. **`busy-models.json` Eşzamanlı Yazma:** Yoğun modeller `markBusy` ile `busy-models.json` dosyasına yazılır (`src/agent.js:21-23`). Atomik yazma (`.tmp` + rename) kullanılmamış, doğrudan `writeFileSync` çağrılmıştır.
  2. **Yedek Zinciri Döngüsel Bekleme:** Sağlayıcı tüm modellerde 5xx veriyorsa `fallbackChain` sonuna kadar gider ve ardından başarısız olur; modeller arası geçişte her biri için tam zaman aşımı beklenir.

---

### 2.3. Dosya Sistemi, Durum Atomikliği ve Geri Alma (Checkpoints & Undo)

#### 2.3.1. Yapılandırma ve Ayarların Kaydedilmesi (`config.js`, `settings.js`)
- **Konum:** [`src/config.js:29-32, 96-107`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/config.js#L29-L32), [`src/settings.js:61-80`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/settings.js#L61-L80)
- **Kod (`src/config.js:29-32`):**
  ```javascript
  const writeJson = (p, obj) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), { mode: 0o600 });
  };
  ```
- **Kırılma Noktaları:**
  1. **KRİTİK VERİ KAYBI RİSKİ:** `config.js` ve `settings.js` içinde `writeJson` doğrudan hedef dosya üzerine `fs.writeFileSync` yapmaktadır! Dosya yazılırken süreç sonlandırılırsa (elektrik kesintisi, Task Manager/kill, mavi ekran) `config.json` veya `keys.<provider>.json` 0 bayta düşer ve kullanıcının tüm API anahtarları/ayarları kalıcı olarak silinir!
  2. **Windows İzin Modu Yanılsaması:** `{ mode: 0o600 }` parametresi Windows NTFS dosya izinlerinde (ACL) etkisizdir; anahtar dosyaları diskte şifresiz ve oturum açmış kullanıcı düzeyinde korunmasızdır.

#### 2.3.2. Dosya Değişiklik Checkpoint'leri ve Geri Alma (`checkpoints.js`)
- **Konum:** [`src/checkpoints.js:18-130`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/checkpoints.js#L18-L130)
- **Bileşenler:**
  - Depolama: `~/.syzercli/checkpoints/<sessionId>/`.
  - Limitler: `MAX_KEEP = 30` tur, dosya başına `MAX_FILE = 5 MB`.
  - `writeAtomic(file, data)`: `.tmp` + `renameSync`.
- **Kırılma Noktaları:**
  1. **Yol Karşılaştırmasında Normalizasyon Eksikliği:** `src/checkpoints.js:54` içinde `cp.files.some((f) => f.path === file)` karşılaştırması yapılmaktadır. Windows üzerinde büyük/küçük harf (`C:\Project\file.js` vs `c:\project\file.js`) veya eğik çizgi (`/` vs `\`) farklarında aynı dosya iki kez eklenip ilk içerik üzerine yazılabilir.
  2. **Geri Alma (`undo`) İşleminde Atomik Olmayan Yazma:** `src/checkpoints.js:112` üzerinde `fsImpl.writeFileSync(f.path, blob)` doğrudan hedef dosya üzerine senkron yazmaktadır; `writeAtomic` kullanılmamıştır. Geri alma sırasında süreç çökerse dosya yarım kalabilir.
  3. **Dosya Silme Çakışması:** `src/checkpoints.js:115` üzerinde `fsImpl.rmSync(f.path, { force: true })` dosyayı silerken dosya başka bir uygulama (VS Code/Orca/antivirüs) tarafından kilitliyse hata fırlatabilir.

#### 2.3.3. Oturum Verisi Saklama (`sessions.js`)
- **Konum:** [`src/sessions.js:26-61`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/sessions.js#L26-L61)
- **Bileşenler:**
  - Depolama: `~/.syzercli/sessions/<id>.json`.
  - Alt ajan kayıtları: `~/.syzercli/sessions/<id>/subagents/agent-<n>.json`.
  - Rotasyon: `MAX = 30`.
- **Kırılma Noktaları:**
  1. **Eski Oturumların Temizlenmesinde Hata Yakalama:** `src/sessions.js:55-59` içinde 30'dan eski oturumlar silinirken `fs.unlinkSync` ve `fs.rmSync` çağrıları kilitli dosyalarda patlayabilir. `try-catch` bloğu (`line 60`) tüm işlemi sessizce yuttuğu için diskin dolması fark edilemez.

---

### 2.4. Ajan Orkestrasyonu, Eşzamanlılık ve Görev Bütçesi

#### 2.4.1. Tur Yürütme Döngüsü (`runTurn`)
- **Konum:** [`src/agent.js:98-236`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/agent.js#L98-L236)
- **Bileşenler:**
  - Maksimum adım: `MAX_STEPS = 30`.
  - Tur başı otomatik sıkıştırma: `compactSession(session, { mode: 'auto' })`.
  - Tur ortası budama: `compactSession(session, { mode: 'trim' })`.
- **Kırılma Noktaları:**
  1. **Geçmiş Sıfırlama Riskleri:** `src/agent.js:219-223` içinde hata durumunda `session.messages.length = startLen` yapılarak tur başındaki duruma dönülür. Ancak araçlar çalıştırılmış ve dosya sistemi değiştirilmişse modelin geçmişi ile disk durumu arasında uyumsuzluk (state desynchronization) doğar.
  2. **Todo Döngüsü Koruması:** `src/agent.js:163-168` içinde tamamlanmamış todo maddeleri için yalnızca 1 kez (`nagged = true`) hatırlatma yapılır. İkinci kez hatırlatılmaz ve tur sonlanır.

#### 2.4.2. Orkestra DAG Yöneticisi (`orchestra.js`)
- **Konum:** [`src/orchestra.js:45-122`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/orchestra.js#L45-L122)
- **Bileşenler:**
  - Dalga sınırı: `MAX_WAVES = 12`.
  - Yeniden deneme adımı: `RETRY_STEPS = 24`.
  - Bağımlılık bağlam limiti: `LIMITS.dependencyContext = 2500` karakter.
- **Kırılma Noktaları:**
  1. **AYNI DALGADA DOSYA YAZMA ÇAKIŞMASI:** `Promise.all(ready.map(...))` çağrısı bağımlılıkları tamamlanmış tüm ajanları aynı anda paralel çalıştırır (`src/orchestra.js:66-95`). Eğer iki bağımsız ajan aynı kaynak dosyasını değiştirmeye çalışırsa disk üzerinde yarış durumu (race condition) ve birbirinin kodunu ezme riski oluşur.
  2. **Hata Durumunda Dalga Yayılımı:** Bir ajanın fırlattığı beklenmedik hata (`throw err`, `src/orchestra.js:89`) `Promise.all`'ı anında reddeder; paralel koşan diğer ajanlar durdurulamaz (detached promise execution) ve konsola işlenmemiş promise reddi düşebilir.

#### 2.4.3. Alt Ajan Eşzamanlılık Kapısı (`subagents.js`)
- **Konum:** [`src/subagents.js:13-19`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/subagents.js#L13-L19)
- **Kod:**
  ```javascript
  const gate = { active: 0, waiters: [] };
  async function limited(max, fn) {
    while (gate.active >= max) await new Promise((r) => gate.waiters.push(r));
    gate.active++;
    try { return await fn(); }
    finally { gate.active--; const w = gate.waiters.shift(); if (w) w(); }
  }
  ```
- **Kırılma Noktaları:**
  1. **İptal Edilemeyen Kuyruk (Uncancellable Waiters):** Kullanıcı oturumu iptal ettiğinde (`signal.abort()`), `gate.waiters` kuyruğunda bekleyen alt ajanlar sinyali dinlemez. Önlerindeki ajanlar bitene kadar kuyrukta bloke kalırlar.
  2. **FIFO Sırası ve Açlık (Starvation):** Öncelik sırası yoktur; bağımlı kritik işçiler arka sıraya düşebilir.

---

### 2.5. Güvenlik, İzinler, Kural Motoru ve İzolasyon

#### 2.5.1. Tehlikeli Komut Kara Listesi (`permissions.js`)
- **Konum:** [`src/permissions.js:15-32`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/permissions.js#L15-L32)
- **Kapsam:** `rm -rf /`, `Remove-Item -Recurse`, `rd /s`, `format`, `dd`, `git push -f main`, fork bomb vb.
- **Kırılma Noktaları:**
  1. **PowerShell Değişken ve Alias Kaçışları:** Regex listesi doğrudan bilinen cmdlet adlarına bakar. Örneğin `del -r`, `erase`, `saps`, `Start-Process`, `Invoke-Expression` (`iex`), `& (Get-Command ...)` gibi PowerShell dolaylı çalıştırmaları regex'e takılmadan yıkıcı işlemler yapabilir.
  2. **Boşluk ve Bayrak Varyasyonları:** Karmaşık parametre kombinasyonları (`Remove-Item -Force -Recurse -Path C:\`) regex'lerin sınırlarını aşabilir.

#### 2.5.2. Çalışma Alanı Dışına Çıkış Tespiti (`isOutside`)
- **Konum:** [`src/permissions.js:91-94`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/permissions.js#L91-L94)
- **Kod:**
  ```javascript
  function isOutside(cwd, p) {
    const rel = path.relative(cwd, path.resolve(cwd, p || '.'));
    return rel.startsWith('..') || path.isAbsolute(rel);
  }
  ```
- **Kırılma Noktaları:**
  1. **Sembolik Bağlantı (Symlink / Junction) Boşluğu:** `fs.realpathSync` kullanılmamaktadır. Eğer çalışma alanı içinde sistem klasörüne (örn. `C:\Windows` veya `/etc`) işaret eden bir symlink/junction varsa, `path.resolve` bunu çalışma alanı içinde görerek `isOutside = false` değerlendirir!
  2. **`perm === 'auto'` ve `canAsk: false` Güvenlik Açığı:** [`src/tools.js:468-470`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/tools.js#L468-L470) içinde:
     ```javascript
     const outside = FILE_WRITE.has(name) && perms.isOutside(cwd, a.path);
     const needAsk = !allowedByRule && (session.perm === 'ask' || (session.perm === 'auto' && outside && session.canAsk));
     ```
     Eğer oturum `auto` izninde çalışıyorsa ve `session.canAsk` `false` ise (örneğin headless modda `-y` verildiğinde veya alt ajan çalıştığında), `needAsk` `false` olur! Sonuç olarak çalışma alanı dışındaki dosyalara (örneğin `C:\Windows\System32\...` veya `~/.ssh/...`) kullanıcıya sorulmadan yazılabilir!

#### 2.5.3. Yerel HTTP Sunucu Güvenliği (`server.js`, `web.js`)
- **Konum:** [`src/server.js:58-65`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/server.js#L58-L65), [`src/web.js:94-96, 116`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/web.js#L94-L96)
- **Kırılma Noktaları:**
  1. **`server.js` İçinde Açık CORS ve DNS Rebinding:** `syzer serve` komutu `Access-Control-Allow-Origin: *` başlığı basar. Eğer `--token` verilmemişse, kullanıcının tarayıcısında açtığı herhangi bir web sitesi yerel `http://127.0.0.1:8787` adresine istek atarak kullanıcının API kredisini tüketebilir. `Host` doğrulaması da yoktur.
  2. **`web.js` Güvenlik Katmanı:** `web.js` 18 baytlık rastgele token, HttpOnly çerez, `Host` ve `Origin` kontrolleriyle güçlü korunmuştur; ancak `icon.png` statik dosya sunumunda `path.join(__dirname, '..', 'assets', 'syzer-icon.png')` kullanıldığından dizin geçişi (path traversal) riski bulunmamaktadır.

---

### 2.6. Harici Köprüler, Güncelleme Mekanizması ve Sistem Tanılama

#### 2.6.1. Model Context Protocol İstemcisi (`mcp.js`)
- **Konum:** [`src/mcp.js:21-36, 97`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/mcp.js#L21-L36)
- **Kırılma Noktaları:**
  1. **Windows `shell: true` ve Komut Dizgileme Kusuru:**
     ```javascript
     const q = (s) => (/[\s"&|<>^]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
     this.child = spawn([command, ...args].map(q).join(' '), { ...opts, shell: true });
     ```
     Windows üzerinde `shell: true` kullanıldığında komut `cmd.exe /d /s /c "..."` ile çalıştırılır. `cmd.exe` içinde çift tırnak kaçışı `\"` değil, `""` veya `^"` şeklindedir! Eğer argüman içinde tırnak veya özel karakter (`&`, `|`, `%`) varsa komut satırı bozulur veya komut enjeksiyonu riski oluşur.
  2. **Yetim MCP Süreçleri:** `close()` metodunda `this.child.kill()` çağrılmaktadır. Windows üzerinde `shell: true` ile başlatılan süreçlerde bu çağrı yalnızca `cmd.exe`'yi kapatır; asıl çalışan arka plan MCP sunucusu (node/python süreci) sistemde yetim kalarak portu ve belleği işgal etmeyi sürdürür.

#### 2.6.2. Orca Köprüsü ve İşçiler (`orca-bridge.js`, `orca-workers.js`)
- **Konum:** [`src/orca-bridge.js:35-47`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/orca-bridge.js#L35-L47), [`src/orca-workers.js:59-74`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/orca-workers.js#L59-L74)
- **Kırılma Noktaları:**
  1. **`tar` Bağımlılığı:** `orca-bridge.js` ve `updater.js` arşiv açmak için sistemdeki `tar` komutunu (`spawnSync('tar', ...)`) çağırır. Eski Windows 10/Server sürümlerinde `tar.exe` bulunmayabilir.
  2. **İşçi Canlılık Denetimi Eksikliği:** `orca-workers.js:65-69` içinde işçi sonucu beklenirken 15 dakika boyunca her saniye `fs.existsSync(outFile)` kontrol edilir. Eğer işçi süreci hemen çökerse, ebeveyn süreç çöken süreci fark edemeyip 15 dakika boyunca boşuna bekler.

#### 2.6.3. Kendini Güncelleme Mekanizması (`selfupdate.js`, `updater.js`)
- **Konum:** [`src/selfupdate.js:20-24`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/selfupdate.js#L20-L24), [`src/updater.js:26-31`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B0/src/updater.js#L26-L31)
- **Kırılma Noktaları:**
  1. **Versiyon Karşılaştırması (`cmpVer`):** `x = String(a).replace(/^v/, '').split('.').map(Number)` mantığı yalnızca `MAJOR.MINOR.PATCH` üçlüsünü karşılaştırır. SemVer ön-sürüm etiketleri (`-beta.1`, `-rc`) ayrıştırılamaz ve `NaN` değerine dönüşebilir.
  2. **Açılışta Bloklama:** `main()` içinde `selfupdate` ağ üzerinden GitHub'a bağlanır; yavaş veya kısıtlı ağlarda CLI açılışını geciktirir (her ne kadar 4000ms zaman aşımı olsa da).

---

### 2.7. Test Kapsamı ve CI/CD Sağlamlığı

Mevcut test takımı 26 test dosyasında 266 testten oluşmakta ve `node --test` üzerinde 15 saniyede yeşil geçmektedir. Ancak altyapı bileşenlerinin test dağılımı incelendiğinde ciddi boşluklar görülmektedir:

| Modül / Alan | Mevcut Test Dosyası | Durum | Eksik / Riskli Kapsam |
|---|---|---|---|
| `src/tools.js` (Dosya Araçları) | Yok (`a5-errors.test.js` içinde dar hata testleri) | **Kritik Eksik** | `read_file`, `write_file`, `edit_file` büyük dosya, fuzzy eşleşme, CRLF/LF testleri yok |
| `src/tools.js` (Kabuk & Komut) | Yok | **Kritik Eksik** | `runShell`, `spawnShell`, zaman aşımı, `killTree`, arka plan süreçleri test edilmiyor |
| `src/permissions.js` | Yok | **Kritik Eksik** | `dangerous` regex sınırları, kural eşleştirme, `isOutside` symlink ve sürücü testleri yok |
| `src/mcp.js` | Yok | **Eksik** | JSON-RPC protokolü, stdio haberleşmesi, zaman aşımı ve hata durumları test edilmiyor |
| `src/server.js` | Yok | **Eksik** | OpenAI uyumlu proxy, CORS, akış iletimi test edilmiyor |
| `src/config.js` / `settings.js` | Yok | **Eksik** | Yapılandırma okuma/yazma, sağlayıcı geçişi, bozuk JSON kurtarma test edilmiyor |
| `src/api.js` | `test/api-stall.test.js` | Kısmi | Yalnızca takılma (stall) test ediliyor; normal chunk akışı, tool_calls parçalanması test edilmiyor |
| `src/checkpoints.js` | `test/checkpoints.test.js` | **İyi** | Temel geri alma, çakışma tespiti, sınır testleri mevcut |
| `src/pool.js` / `key-health.js` | `test/pool.test.js`, `test/key-health.test.js` | **İyi** | mapLimit, 429 retry, sağlık puanlama testleri mevcut |
| `src/orchestra.js` | `test/orchestra.test.js` | **İyi** | DAG planı, dalga yürütme, bağımlılık aktarımı testleri mevcut |
| `src/budget.js` / `compact.js` | `test/budget.test.js`, `test/compact.test.js` | **İyi** | Bütçe sayaçları, budama ve özetleme testleri mevcut |

---

## 3. Öncelikli Kırılma Noktaları ve Risk Matrisi

| Risk ID | Alan | Şiddet | Olasılık | Açıklama |
|---|---|---|---|---|
| **R-01** | Durum / Veri | **P0 (Kritik)** | Orta | `config.js` ve `settings.js` içinde `fs.writeFileSync` doğrudan yazma; elektrik kesintisi/kill anında 0 baytlık bozuk JSON ve API anahtarlarının kaybı. |
| **R-02** | Güvenlik | **P0 (Kritik)** | Düşük | `isOutside` symlink çözümü yapmıyor; `perm === 'auto'` ve `canAsk: false` iken çalışma alanı dışına kontrolsüz yazma imkanı. |
| **R-03** | Süreç Yönetimi | **P1 (Yüksek)** | Yüksek | Windows `powershell.exe` kod sayfası UTF-8 değil; Türkçe ve özel karakterli araç çıktılarında bozulma. |
| **R-04** | Süreç Yönetimi | **P1 (Yüksek)** | Orta | `killTree` POSIX üzerinde süreç grubunu öldürmüyor; `mcp.js` `close()` alt süreçleri kapatmıyor; yetim (zombie) süreç birikmesi. |
| **R-05** | Eşzamanlılık | **P1 (Yüksek)** | Orta | `orchestra.js` aynı dalgada bağımsız ajanları çalıştırırken ortak dosya yazma çakışmasını denetlemiyor; yarış durumu ve kod kaybı. |
| **R-06** | Dosya Sistemi | **P1 (Yüksek)** | Yüksek | Windows üzerinde `fs.renameSync` kilitli dosyalarda `EBUSY`/`EPERM` fırlatıyor; `key-health.js` güncellemelerinin sessizce düşmesi. |
| **R-07** | Güvenlik | **P1 (Yüksek)** | Düşük | `syzer serve` yerel proxy sunucusunda `Access-Control-Allow-Origin: *` ve `Host` kontrolü yok; yetkisiz yerel API erişimi. |
| **R-08** | Eşzamanlılık | **P2 (Orta)** | Düşük | `subagents.js` içindeki `gate.waiters` kuyruğu `AbortSignal` dinlemiyor; iptal durumunda gereksiz bekleme. |
| **R-09** | Entegrasyon | **P2 (Orta)** | Düşük | `orca-workers.js` işçi sürecinin canlılığını denetlemiyor; erken çöküşte 15 dakika boyunca kör bekleme. |
| **R-10** | Test Kapsamı | **P2 (Orta)** | Yüksek | `tools.js`, `permissions.js`, `mcp.js` için temel birim/entegrasyon testlerinin bulunmaması. |

---

## 4. Spec B1 İçin İyileştirme ve Güçlendirme Yol Haritası

Spec B1 (Altyapı Sağlamlığı Tasarım Belgesi) için önerilen aksiyonlar önem sırasına göre aşağıdadır:

### Dalga 1 (P0: Veri Bütünlüğü ve Güvenlik Sertleştirmesi)
1. **Atomik Dosya Yazma Standardı:** `config.js`, `settings.js` ve `busy-models` doğrudan `fs.writeFileSync` yerine `writeAtomic` (`.tmp` + güvenli retry'lı rename) modülüne taşınmalıdır. Windows'ta `renameSync` başarısızlığında `retry` veya geçici kilit yönetimi uygulanmalıdır.
2. **Yol Güvenliği ve Symlink Çözümü:** `permissions.js` içindeki `isOutside` fonksiyonu `fs.realpathSync.native` ile gerçek disk yollarını karşılaştırmalı; `canAsk: false` olsa dahi `auto` modda çalışma alanı dışı yazmalar kesinlikle reddedilmelidir (`E_OUTSIDE_WORKSPACE`).
3. **`server.js` Yerel Proxy Sertleştirmesi:** `Access-Control-Allow-Origin: *` kaldırılmalı veya sıkılaştırılmalı; `Host` başlığı doğrulaması (127.0.0.1/localhost) eklenmelidir.

### Dalga 2 (P1: Süreç Yaşam Döngüsü ve Platform Dayanıklılığı)
1. **Windows PowerShell Kod Sayfası Düzeltmesi:** `spawnShell` içinde Windows komutları çalıştırılmadan önce `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` enjekte edilmeli veya UTF-8 bayrakları tanımlanmalıdır. Sistemde varsa `pwsh` tercih edilmelidir.
2. **Sağlam Süreç Ağacı Sonlandırma (`killTree`):**
   - Windows: `taskkill /pid <pid> /t /f` çağrısı senkron veya hata yakalamalı yönetilmeli.
   - POSIX: Süreç `detached: true` ile başlatılıp `-child.pid` süreç grubuna `SIGTERM`/`SIGKILL` gönderilmelidir.
3. **MCP Süreç Yönetimi:** `mcp.js` `close()` metodu `killTree` ile tüm süreç ağacını kapatmalı; Windows `cmd.exe` tırnaklama kuralları düzeltilmelidir.
4. **Orkestra Dosya Çakışma Denetimi:** `orchestra.js`, aynı dalgada paralel koşacak ajanların görev prompt'larını veya yazma hedeflerini analiz ederek aynı dosyaya yazma riski olan adımları sıralı (ardışık) dalgalara bölmelidir.

### Dalga 3 (P2: Test Altyapısı ve Tanılama)
1. **`test/tools.test.js` Eklenmesi:** `prepareChange`, `applyEdit` (fuzzy + exact), `read_file`, `write_file`, `runShell` zaman aşımı ve çıkış kodu testleri.
2. **`test/permissions.test.js` Eklenmesi:** Tehlikeli komut filtreleri, Claude kural eşleştirmeleri, path traversal ve symlink kaçış testleri.
3. **`test/config-resilience.test.js` Eklenmesi:** Bozuk JSON kurtarma, atomik yazma, eşzamanlı okuma/yazma simülasyonu.
4. **`syzer doctor` Genişletmesi:** UTF-8 konsol desteği, arka plan süreç temizliği ve disk yazma izinleri denetiminin eklenmesi.

---

## 5. B0 Sözleşme Uyumu ve Kapanış Kontrolü

- [x] Kod tabanındaki tüm altyapı bileşenleri incelendi (`src/tools.js`, `src/api.js`, `src/pool.js`, `src/key-health.js`, `src/checkpoints.js`, `src/config.js`, `src/settings.js`, `src/sessions.js`, `src/agent.js`, `src/orchestra.js`, `src/subagents.js`, `src/permissions.js`, `src/server.js`, `src/mcp.js`, `src/orca-workers.js`, `src/doctor.js`, `src/selfupdate.js`).
- [x] Tüm bulgular kesin `dosya:satır` referanslarıyla belgelendi.
- [x] Kırılma modları, yarış durumları, platform farklılıkları (Windows vs POSIX) ve yetim süreç riskleri analiz edildi.
- [x] Kod dosyalarında 0 değişiklik yapıldı (`git diff --stat` boş; yalnızca `docs/syzer-iyilestirme/B0-ENVANTER.md` oluşturuldu).
- [x] Test takımı doğrulandı (`npm test` 266 pass, 0 fail).
- [x] Rapor üst şefe (Koordinatör) sunulmaya hazır.
