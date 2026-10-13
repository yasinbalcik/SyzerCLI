# D0 Envanter Raporu: SyzerCLI Orca Eklentisi, Entegrasyonu ve Yama Mimarisi Keşfi

**Tarih:** 2026-10-13  
**Kart:** D0 (Alan D: Orca Eklentisi ve Entegrasyonu Keşif ve Envanter)  
**Rol:** D0 | L2 | kart D0 (KESIF, Orca eklentisi)  
**Üst Şef:** Koordinatör (Claude Sonnet 5.5 / Orca)  
**Çalışma Alanı:** `syzer-D0` (`yasinbalcik/syzer-D0`)  
**Kapsam:**
- SyzerCLI repo tarafı (`src/orca-bridge.js`, `src/orca-hooks.js`, `src/orca-workers.js`, `src/agent-tree.js`, `src/doctor.js`, `src/keys-json.js`, `src/usage-summary.js`, `src/analytics.js`, `src/sessions.js`, `src/selfupdate.js`, `bin/syzer.js`, ilgili testler)
- Orca eklentisi tarafı (`SyzerCLI-Orca` / `~/.syzercli/orca-plugin/app`: `bin/syzer-orca.js`, `src/orca-patch.js`, `src/orca-edits.js`, `src/orca-edits-usage.js`, `src/orca-edits-analytics.js`, `src/orca-analytics-edits.js`, `src/orca-edits-restore.js`, `src/orca-edits-shells.js`, `src/doctor.js`, platform modülleri)
- Orca çalışma ortamı ve arayüz sözleşmeleri (`app.asar` yamalama mimarisi, IPC/HTTP hook kanalları, ortam değişkenleri sözleşmesi, terminal işçi izolasyonu, oturum ve kota yönetimi)  
**Durum:** Tamamlandı (`git diff --stat` kod dosyalarında boş, yalnızca bu envanter belgesi oluşturuldu)

---

## 1. Yönetici Özeti ve Mimari Durum

SyzerCLI ve Orca entegrasyonu, standart bir CLI eklentisinin ötesinde **iki katmanlı hibrit bir mimari** üzerinde çalışır:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           ORCA UYGULAMASI (ELECTRON)                           │
│                                                                                │
│  [ app.asar Yamaları ]                                                         │
│   • core               : Yama sürüm belirteci ve fatal guard                   │
│   • agent              : Ajan menüsü, katalog, ikon, /hook/syzer yönlendirmesi │
│   • usage & settings   : Durum çubuğu kullanım yüzdesi, key rotasyon uyarısı   │
│   • history            : Oturum tarayıcısı (__syzerParse, __syzerSubs)         │
│   • keys               : Ayarlar → AI Provider Accounts (__SyzerKeys paneli)   │
│   • analytics          : Ayarlar → Stats & Usage (Syzer paneli & metrikleri)   │
│   • restore            : Sekme kapanıp açılınca 'syzer --resume <id>'          │
│   • shells             : Orca çıkışında sahipsiz arka plan terminallerini yok  │
│                          etme (quit-kill)                                      │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
           ┌────────────────────────────┼───────────────────────────┐
           │ HTTP Hook (POST /hook/syzer)│ IPC / CLI Çağrıları       │
           │ (Prompt, ToolStart, Plan...)│ (usage, keys, stats)     │
           ▼                            ▼                           ▼
┌────────────────────────┐   ┌────────────────────────┐   ┌─────────────────────┐
│   src/orca-hooks.js    │   │   src/orca-bridge.js   │   │  src/orca-workers.js│
│ (Yerel HTTP istemcisi, │   │ (syzer orca köprüsü,   │   │ (orca terminal      │
│  seri kuyruk, 800ms)   │   │  indirme, doctor sync) │   │  create, izole sekme│
└──────────┬─────────────┘   └──────────┬─────────────┘   └──────────┬──────────┘
           │                            │                            │
           └────────────────────────────┼────────────────────────────┘
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                         SYZERCLI ÇEKİRDEĞİ (CORE RUNTIME)                      │
│                                                                                │
│  • src/agent.js         : Tur/araç yaşam döngüsü hook tetikleyicileri          │
│  • src/tools.js         : 'spawn_syzer' işçi aracı (yalnızca Orca'da aktif)    │
│  • src/orchestra.js     : Plan ve çoklu ajan durumlarının Orca'ya aktarımı     │
│  • src/agent-tree.js    : Ağaç renderında Orca sekme işçisi ayrımı (w<id>)     │
│  • src/usage-summary.js : 700+ key havuzu için 120sn önbellekli kota hesaplama │
│  • src/keys-json.js     : Makine okunur key yönetimi (add, remove, test, prune)│
│  • src/analytics.js     : Schema v1 formatında günlük token/maliyet analitiği  │
│  • src/sessions.js      : Girintili JSON oturum formatı ve alt ajan izleri     │
│  • src/selfupdate.js    : ORCA_AGENT_LAUNCH_TOKEN algılandığında oto-güncelleme│
│                           atlama                                               │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Temel Mimari Bulguları
1. **Sıfır Dış Bağımlılık (Zero External Dependencies):** Hem SyzerCLI çekirdeğindeki Orca modülleri hem de `SyzerCLI-Orca` yama motoru hiçbir harici npm bağımlılığı kullanmaz. Asar ayrıştırma, blok bazlı SHA-256 hash üretimi, HTTP hook çağrıları ve Windows zamanlayıcı entegrasyonu saf Node.js (`fs`, `crypto`, `child_process`, `http`, `vm`) ile çözülmüştür.
2. **Kendi Başına Ayakta Duran Ajan Kimliği (Independent Provider & Agent Identity):** Eski topluluk yamalarındaki gibi var olan bir sağlayıcı (Kimi/Autohand) üzerine parazit yazılmaz; Syzer doğrudan `syzer` ajan kimliği, `syzer` sağlayıcı kimliği ve `/hook/syzer` HTTP rotasıyla sisteme birinci sınıf (first-class) vatandaş olarak enjekte edilir.
3. **Orca İçinde Çalışırken Davranış Adaptasyonu:** SyzerCLI, `ORCA_PANE_KEY` veya `ORCA_AGENT_LAUNCH_TOKEN` ortam değişkenlerini algıladığında:
   - `orca-workers.available()` `true` döner ve modelin kullanımına `spawn_syzer` aracı sunulur.
   - `selfupdate.js` otomatik güncelleme kontrolünü sessizce atlar (`skip()`).
   - `agent.js` ve `tools.js`, araç onay ve çalışma durumlarını anlık olarak Orca'nın durum çubuğuna ve kenar paneline bildirir.
   - `agent-tree.js`, işçi ajanları `[kind] · Orca` rozetiyle terminalde görselleştirir.
4. **Dayanıklılık ve Kendi Kendini Onarma:**
   - Orca güncellendiğinde `app.asar` üzerine yazılırsa, Windows Görev Zamanlayıcısı (her 10 dakikada bir) ve `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` anahtarı Orca kapalıyken yamayı otomatik olarak geri yükler.
   - Yama kaynağında bir bayt dahi değişirse (`sourceHash`), yama belirteci (`marker`) otomatik güncellenir ve eski sürüm bayat kabul edilerek yenilenir.
   - Yazma öncesinde `vm.Script` ve `node --check` ile sözdizimi doğrulaması yapılır. Bozulan bir grup varsa o grup atlanır (`skip`), sistem asla kırık asar bırakmaz.

---

## 2. SyzerCLI İçi Entegrasyon Bileşenleri (Dosya:Satır Kataloğu)

SyzerCLI çekirdeğinde Orca entegrasyonuna doğrudan hizmet eden dosyalar ve satır kesinliğiyle görevleri aşağıda listelenmiştir:

### 2.1 Eklenti Köprüsü: `src/orca-bridge.js` (99 satır)
- **Konum:** [`src/orca-bridge.js:1-99`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/orca-bridge.js#L1-L99)
- **Görev:** `syzer orca <alt-komut>` çağrılarını karşılar. Ayrı bir repo olan `github.com/yasinbalcik/SyzerCLI-Orca` projesinin son GitHub release'ini (`syzer-orca-*.tar.gz`) indirir, açar ve eklenti CLI'ını çalıştırır.
- **Kritik Satırlar:**
  - `src/orca-bridge.js:9-12`: `PLUGIN_REPO` (`yasinbalcik/SyzerCLI-Orca`), `DIR` (`~/.syzercli/orca-plugin`), `APP` (`~/.syzercli/orca-plugin/app`), `ENTRY_REL` (`bin/syzer-orca.js`).
  - `src/orca-bridge.js:14-18`: `SYZER_ORCA_PLUGIN_DIR` ortam değişkeni varsa yerel geliştirme klasörünü kullanır; `installed()`, `installedVersion()` paket durumunu döner.
  - `src/orca-bridge.js:21-24`: `cliCmd()`: Orca ana sürecinin Syzer'ı çağıracağı komut dizisini hazırlar (`SYZER_CLI_CMD`). Exe launcher varsa doğrudan exe yolunu, aksi halde `node "bin/syzer.js"` yolunu tırnaklar.
  - `src/orca-bridge.js:28-33`: `latest()`: GitHub Releases API'si üzerinden son release ve tar.gz varlığını sorgular.
  - `src/orca-bridge.js:35-47`: `install(info)`: Atomik kurulum: `${APP}.tmp` klasörüne indirir, `tar -xzf` ile açar ve `fs.renameSync` ile yer değiştirir.
  - `src/orca-bridge.js:50-65`: `ensure({ force })`: Eklenti kurulu değilse ya da zorlandıysa son sürümü indirir.
  - `src/orca-bridge.js:72-80`: `run(args)`: Alt komutları (`install`, `status`, `patch`, `doctor`, `update` vb.) eklentiye devreder.
  - `src/orca-bridge.js:83-87`: `status()`: `syzer-orca status` JSON çıktısını döndürür.
  - `src/orca-bridge.js:91-96`: `doctorJson({ timeout, spawn })`: `syzer-orca doctor --json` çıktısını çalıştırır (0 = tam, 2 = atlanan grup var).

### 2.2 HTTP Hook İstemcisi: `src/orca-hooks.js` (127 satır)
- **Konum:** [`src/orca-hooks.js:1-127`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/orca-hooks.js#L1-L127)
- **Görev:** Orca'nın yerel HTTP hook sunucusuna (`POST 127.0.0.1:<port>/hook/syzer`) anlık ajan durumlarını serileştirilmiş kuyrukla gönderir.
- **Kritik Satırlar:**
  - `src/orca-hooks.js:9`: `TIMEOUT_MS = 800`: Hiçbir olay 800ms'den uzun süre akışı engellemez.
  - `src/orca-hooks.js:10`: `SOURCE = 'syzer'`: Orca'da Syzer'ın kendi rotası (`/hook/syzer`).
  - `src/orca-hooks.js:11-13`: `chain = Promise.resolve()`: Olayların sırasını korumak için seri Promise kuyruğu. `setSession(id)`: Oturum kimliğini hafızaya alır (`--resume <id>` için).
  - `src/orca-hooks.js:15-33`: `readEndpoint()`: `ORCA_AGENT_HOOK_ENDPOINT` dosyasını okur (varsa env satırlarını ayrıştırır), yoksa `ORCA_AGENT_HOOK_PORT`, `ORCA_AGENT_HOOK_TOKEN`, `ORCA_AGENT_HOOK_ENV`, `ORCA_AGENT_HOOK_VERSION` ortam değişkenlerinden yapılandırır.
  - `src/orca-hooks.js:35-71`: `send(eventName, payload)`: `http.request` ile yerel sunucuya `X-Orca-Agent-Hook-Token` başlığıyla `POST` atar. Yanıt okunmadan kapatılır (`res.resume()`), `TIMEOUT_MS` aşımında `req.destroy()` çağrılır. Hata durumunda sessizce çözülür (`never throws`).
  - `src/orca-hooks.js:73-77`: `enqueue(eventName, payload)`: `ORCA_PANE_KEY` yoksa sessizce no-op döner.
  - `src/orca-hooks.js:82-98`: Yaşam döngüsü fonksiyonları: `promptSubmitted(prompt)` (`Prompt`), `toolStarted(name, input)` (`ToolStart`), `toolFinished(name)` (`ToolEnd`), `turnDone(lastMsg)` (`Done`), `waiting(kind)` (`Waiting`), `resumed()` (`Resumed`).
  - `src/orca-hooks.js:100`: `subagentStart({ id, kind, description })`: Kenar çubuğunda çalışan alt ajan listesine ekler (`SubagentStart`).
  - `src/orca-hooks.js:103-118`: `plan(list)`: `todo_write` orkestra planını Orca'nın alt ajan görünümüne yansıtır (`Plan`). Maksimum 32 madde sınırlar. Çalışan madde `working`, sıradakiler `idle`, bekleyenler `waits` listesiyle aktarılır. Aynı plan art arda gönderilmez (`lastPlan` önbelleği).
  - `src/orca-hooks.js:119-124`: `subagentStop({ id })` (`SubagentStop`), `end()` (`End`), `flush()`: Süreç çıkışından önce kuyruğu bekler.

### 2.3 Terminal İşçi Yöneticisi: `src/orca-workers.js` (137 satır)
- **Konum:** [`src/orca-workers.js:1-137`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/orca-workers.js#L1-L137)
- **Görev:** Orca çalışma alanında bağımsız sekmelerde `syzer ... --prompt-file ... --out ...` komutuyla görsel işçiler başlatır.
- **Kritik Satırlar:**
  - `src/orca-workers.js:15`: `available()`: `!!process.env.ORCA_PANE_KEY && !process.env.SYZER_NO_WORKERS`. Yalnızca Orca içinde ve engellenmemişse aktiftir.
  - `src/orca-workers.js:16-17`: `MAX_ATTEMPTS = 2`, `keyCounter = 0`.
  - `src/orca-workers.js:19-23`: `clipWorkerReport`: Raporu `LIMITS.subagentReport` karakterde keser; `workerFailure`: `P.error('TOOL_FAILED', ...)` standardı.
  - `src/orca-workers.js:25`: `orcaCli()`: `ORCA_CLI_COMMAND` veya platforma göre `orca.exe` / `orca`.
  - `src/orca-workers.js:33-41`: `selfCmd()`: PATH'teki `syzer` komutunu doğrular (`where/which syzer`); yoksa launcher veya `bin/syzer.js` yolunu PowerShell çağrı işleciyle (`& "..."`) hazırlar.
  - `src/orca-workers.js:44-48`: `nextKeyFlag(cfg, attempt)`: Paralel işçilere döngüsel olarak farklı key indeksleri verir (`-k <n>`), böylece aynı key kotasına çarpmazlar.
  - `src/orca-workers.js:50-74`: `runOnce(parent, a, id, attempt, signal)`:
    - İletişim dizini: `~/.syzercli/workers/<id>/prompt.txt` ve `result.txt`.
    - Terminal başlatma: `runCli(['terminal', 'create', '--worktree', wt, '--title', title, '--command', cmd, '--json'])`.
    - Çıktı bekleme döngüsü: `result.txt` oluşana kadar her 1000ms'de bir kontrol (15 dakika `deadline`).
    - Otomatik kapatma: `SYZER_WORKER_CLOSE=1` ise terminal kapatılır (`runCli(['terminal', 'close', ...])`).
  - `src/orca-workers.js:76-134`: `spawnWorker(parent, call, signal)`:
    - `id = crypto.randomBytes(4).toString('hex')`.
    - Ağaç kimliği: `w${id}` (Agent tree'de Orca rozeti tetikler).
    - Hook bildirimleri: `hooks.subagentStart({ id: 'syz-w-' + id, kind: 'syzer-worker' })` ve `hooks.subagentStop`.
    - Hata durumunda 2. deneme (`MAX_ATTEMPTS`), farklı API key ile tekrar çalıştırılır.

### 2.4 Ajan Ağacı Orca Entegrasyonu: `src/agent-tree.js` (376 satır)
- **Konum:** [`src/agent-tree.js:42, 87, 343`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/agent-tree.js#L42)
- **Kritik Satırlar:**
  - `src/agent-tree.js:42`: Ağaç düğüm nesnesinde `orca: !!o.orca` bayrağı tutulur.
  - `src/agent-tree.js:87`: `kindLabel = (n) => (n.orca ? n.kind + ' · Orca' : n.kind)`: Terminalde ajan sekmesinde "worker · Orca" etiketi basılır.
  - `src/agent-tree.js:343`: `trackOut`: Başlatılan alt ajanın ID'si `string` ve ilk harfi `'w'` ise (`w<hex>`), otomatik olarak `orca: true` olarak işaretlenir.

### 2.5 Sistem Tanı Entegrasyonu: `src/doctor.js` (95 satır)
- **Konum:** [`src/doctor.js:25-45, 67-84`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/doctor.js#L25-L45)
- **Kritik Satırlar:**
  - `src/doctor.js:26-44`: `orcaDoctorRows(d, opts)`: `syzer-orca doctor --json` çıktısını satırlara böler. Eklenti sürümü güncel mi, her grup uygulandı mı yoksa atlandı mı kontrol eder.
  - `src/doctor.js:67-84`: Windows üzerinde `orca-bridge.status()` ve `doctorJson()` çağrılarını yürütür. Kurulu değilse isteğe bağlı uyarı basar; kuruluysa her grubun sağlık durumunu raporlar.

### 2.6 Makine Okunur Key Yönetimi: `src/keys-json.js` (171 satır)
- **Konum:** [`src/keys-json.js:1-171`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/keys-json.js#L1-L171)
- **Görev:** Orca Ayarlar → AI Provider Accounts sayfasındaki `__SyzerKeys` bileşeninin ihtiyaç duyduğu tüm arka plan işlemlerini CLI üzerinden JSON olarak sunar.
- **Komutlar ve Karşılıkları:**
  - `syzer keys list --json`: `listAll()` -> tüm sağlayıcılar, maskeli key'ler, durumlar (`ready`, `off`, `wait`), kota özetleri.
  - `syzer keys usage --json`: `usage(provider)` -> 25 saniyelik zaman bütçesiyle arka planda kullanım önbelleğini yeniler ve güncel listeyi döner.
  - `syzer keys add --json`: `add(text)` -> çoklu satır API key ekleme, doğrulama ve sonuç bildirimi.
  - `syzer keys remove <index> --json`: `remove(provider, index)` -> belirtilen indeksteki key'i siler.
  - `syzer keys use <index> --json`: `use(provider, index)` -> aktif key işaretçisini değiştirir.
  - `syzer keys test --json`: `test(provider)` -> canlı HTTP testi yapar, 401 alanları devre dışı bırakır (`off`).
  - `syzer keys prune --json`: `prune(provider)` -> çalışmayan (disabled) key'leri havuzdan temizler.

### 2.7 Durum Çubuğu Kota Özeti: `src/usage-summary.js` (107 satır)
- **Konum:** [`src/usage-summary.js:1-107`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/usage-summary.js#L1-L107)
- **Görev:** Orca durum çubuğunun (Status Bar) sık sık sorguladığı kullanım yüzdesini hesaplar (`syzer usage --summary --json`).
- **Kritik Satırlar:**
  - `src/usage-summary.js:18-19`: `FRESH_MS = 120000` (2 dakika altındaki önbellek tekrar sorgulanmaz), `MAX_AGE_MS = 24 * 3600e3` (24 saatlik önbellek aşımı).
  - `src/usage-summary.js:20-27`: SHA-1 parmak izi ile `~/.syzercli/usage-key-cache.json` dosyasına yazma/okuma.
  - `src/usage-summary.js:33-45`: `refreshInto`: 700+ key'lik havuzda sorgu sınırına çarpmamak için zaman bütçesi (`budgetMs`) dahilinde en eski key'leri parça parça yeniler.
  - `src/usage-summary.js:80-104`: `summary()`: Toplam kalan haklar, hazır key oranı ve sağlayıcı bazlı yüzdeleri birleştirir.

### 2.8 Analitik Sözleşmesi: `src/analytics.js` (62 satır)
- **Konum:** [`src/analytics.js:1-62`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/analytics.js#L1-L62)
- **Görev:** Orca Ayarlar → Stats & Usage içindeki "Syzer" filtresi için Schema 1 formatında veri üretir (`syzer stats --json --usage-analytics`).
- **Veri Yapısı:**
  - `daily`: `[ { day, model, projectKey, projectLabel, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, eventCount, estimatedCostUsd } ]`
  - `sessions`: `[ { sessionId, firstTimestamp, lastTimestamp, primaryModel, primaryProjectLabel, models, projectKeys, eventCount, ... } ]`

### 2.9 Oturum ve Geri Yükleme Biçimi: `src/sessions.js` (78 satır)
- **Konum:** [`src/sessions.js:3-7, 25-30`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-D0/src/sessions.js#L3-L7)
- **Kritik Satırlar:**
  - `src/sessions.js:6-7`: `~/.syzercli/sessions/<id>.json` dosyaları 2 boşluk girintili ve sonda `\n` ile atomik yazılır (`writeAtomic`). Orca oturum tarayıcısı ve "View Log" penceresi bu dosyaları doğrudan okur.
  - `src/sessions.js:32-35`: Alt ajan izleri `~/.syzercli/sessions/<id>/subagents/agent-<n>.json` altında transkript olarak saklanır. Orca'nın `__syzerSubs` tarayıcısı bu alt klasörü okuyarak alt ajan listesini oluşturur.

### 2.10 Diğer Tamamlayıcı Entegrasyon Noktaları
- **`src/selfupdate.js:49`:** `skip = (argv) => !!(... || process.env.ORCA_AGENT_LAUNCH_TOKEN || ...)`. Orca tarafından başlatılan Syzer oturumlarında otomatik güncelleme kontrolü engellenir, kullanıcı akışı bölünmez.
- **`src/repl.js:318-319, 630`:** ConPTY / Orca sekme boyutlandırmasında `SIGWINCH` / `resize` olay yönetimi ve `orca-hooks.setSession(sessionId)` ile geri yükleme kimliğinin hook katmanına aktarılması.
- **`src/tools.js:112`:** `require('./orca-workers').available() ? [...defs, ...extra, WORKER_DEF] : ...`: `spawn_syzer` aracı yalnızca Orca içinde sunulur, bağımsız terminalde gizlenir.
- **`bin/syzer.js:42, 63, 262`:**
  - `--unrestricted`: Orca'nın "bypass permissions" seçeneğini karşılar (`-y` / `--yes` eşdeğeridir).
  - `--prompt-file <f> [--out <f>]`: Orca worker'larının çalıştırılma sözleşmesi.
  - `syzer orca ...`: `require('../src/orca-bridge').run(...)` yönlendirmesi.

---

## 3. Orca Eklentisi (`SyzerCLI-Orca`) ve `app.asar` Yama Mimarisi

Orca eklentisi (`~/.syzercli/orca-plugin/app`), Orca uygulamasının Electron derlemesindeki `app.asar` paketini çalışma zamanında tersine mühendislikle yamalayarak SyzerCLI'ı yerel bir ajan olarak sisteme entegre eder.

### 3.1 `app.asar` Manipülasyon Mekanizması (`src/orca-patch.js`)
- **Doğrudan İkili Asar Ayrıştırma (`openAsar`):**
  - Asar dosyasının ilk 16 baytlık başlığını okur: `[4, headerSize, 4 + align4(jsonLen), jsonLen]`.
  - JSON dosya ağacını (`header`) belleğe alır; dosya ofsetlerini (`dataStart + offset`) hesaplar.
- **Blok Bütünlüğü (`integrity`):**
  - Düzenlenen dosyalar için 4MB'lık bloklar halinde SHA-256 hash'leri (`integrity.blocks`) yeniden hesaplanır.
- **Atomik Yazma ve Kurtarma (`recoverInterrupted`, `restoreFiles`):**
  - Orijinal dosya `app.asar.syzer-orig` ve meta bilgisi `app.asar.syzer-orig.json` olarak saklanır.
  - Yeni paket önce `app.asar.syzer-new` geçici dosyasına yazılır, ardından atomik olarak `app.asar` üzerine taşınır.
  - Yarım kalmış bir yazım tespit edilirse (`patch-state.json: { state: 'writing' }` veya `.syzer-new` artığı), orijinal yedekten otomatik geri yükleme (`recoverInterrupted`) yapılır.
- **Sözdizimi Doğrulama (`syntaxError`, `buildValidated`):**
  - Main/Preload dosyaları CommonJS olduğundan `vm.Script` içine sarılarak sözdizimi denetlenir.
  - Renderer dosyaları ES Module (`.mjs`) olduğundan geçici dosyada `node --check` ile ayrıştırılır.
  - Eğer bir yama grubu sözdizimi hatasına yol açarsa, o grup suçlu bulunur ve atlananlar listesine (`skipped`) eklenerek geri alınır; sistem asla açılmayan bir Orca bırakmaz.

### 3.2 Yama Belirteci (`markerOf`) ve Sürüm Kontrolü
```javascript
const markerOf = (cmd) => `/*syzer-orca:${PATCH_VERSION}:${crypto.createHash('sha1')
  .update(cmd)
  .update(sourceHash())
  .update(`skip:${skipList().join(',')}`)
  .digest('hex').slice(0, 8)}*/`;
```
- `PATCH_VERSION`: 11 (mevcut yama sürümü).
- `sourceHash`: `orca-edits*.js` ve `orca-snippets/*` dosyalarının içerik özetidir. Yama betiğinde bir karakter dahi değişse hash değişir.
- Marker, `out/main/index.js` dosyasının en başına enjekte edilir. Orca açılışında `status()` bu belirteci okur; eşleşmezse yama eski (`upToDate: false`) kabul edilir.

---

### 3.3 Dokuz (9) Yama Grubu Kataloğu

| Grup Adı | Hedef Dosyalar / Glob | Yapılan Değişiklik / Enjeksiyon Özeti | Kırılma Durumunda Sonuç |
|---|---|---|---|
| **`core`** | `out/main/index.js` | Dosya başına `marker` enjeksiyonu (`/*syzer-orca:11:...*/`) ve fatal guard koruması. | Temel gruptur; başarısız olursa yama durur. |
| **`agent`** | `out/main/index.js`<br>`out/renderer/assets/store-*.js`<br>`out/main/chunks/tui-agent-*.js`<br>`out/renderer/assets/agent-catalog-*.js` | 1. `jcode` yanına `syzer` tanımları (`detectCmd`, `launchCmd`, `promptInjectionMode: stdin-after-start`).<br>2. Terminal açma menüsüne ve katalog listesine Syzer eklenmesi (S ikonu, arama takma adları: `openrouter`, `nvidia`).<br>3. HTTP yönlendirmesi: `POST /hook/syzer` rotası açılır.<br>4. Olay ayrıştırıcısı: `__syzerEvent` enjeksiyonu ile Syzer olayları Orca durum makinesine bağlanır. | Syzer terminal açma menüsünden veya hook listesinden düşer. |
| **`usage`** | `out/main/index.js`<br>`out/renderer/assets/store-*.js`<br>`out/renderer/assets/StatusBar-*.js` | 1. Ana süreçte `fetchSyzerUsage`: `syzer usage --summary --json` çağrısı.<br>2. `szMap` haritalayıcısı: Kota yüzdesi, kalan istek sayısı, en kötü seviye (`ok`/`warn`/`crit`) hesaplaması.<br>3. Durum çubuğuna S logolu sayaç, tıklanınca açılan detay rozeti (`0 keys ready`, `rotated: key #X`). | Durum çubuğunda Syzer kota kutusu görünmez. |
| **`usage-settings`** | `out/renderer/assets/Settings-*.js` | Ayarlar sayfasında kullanım sağlayıcıları listesine Syzer eklenmesi. | Ayarlarda kullanım görünmez. |
| **`history`** | `out/main/chunks/session-scanner-*.js`<br>`out/renderer/assets/ai-vault-*.js`<br>`out/main/session-scanner-service-entry.js` | 1. Oturum tarayıcısına `syzer` ajan tipi ve `~/.syzercli/sessions` dizini tanıtılır.<br>2. `__syzerParse`: Syzer JSON oturum dosyalarını Orca oturum kartına çevirir.<br>3. `__syzerSubs`: `subagents/agent-*.json` transkriptlerini alt ajan oturumları olarak okur.<br>4. Resume komutu: `syzer --resume <sessionId>` sözleşmesi bağlanır. | Oturum geçmişinde Syzer oturumları listelenmez. |
| **`keys`** | `out/main/index.js`<br>`out/preload/index.js`<br>`out/renderer/assets/Settings-*.js`<br>`out/renderer/assets/useSettingsNavigationMetadata-*.js` | 1. IPC kanalları: `syzerKeys:list`, `add`, `remove`, `use`, `test`, `usage`, `prune` (`keys-main.js`).<br>2. Preload köprüsü: `window.syzerKeysApi`.<br>3. UI enjeksiyonu: Ayarlar → AI Provider Accounts içine `__SyzerKeys` React bileşeni (`keys-renderer.js`). Kullanıcı arayüzünden key ekleme, silme, doğrulama yapılabilir. | Ayarlarda Syzer API anahtarları yönetim kutusu çıkmaz. |
| **`analytics`** | `out/main/index.js`<br>`out/preload/index.js`<br>`out/renderer/assets/store-*.js`<br>`out/renderer/assets/Settings-*.js` | 1. Ana süreçte `__getSyzerUsage`: `syzer stats --json --usage-analytics` çağrısı.<br>2. Preload köprüsü: `window.api.syzerUsage`.<br>3. Ayarlar → Stats & Usage içine "Syzer" sekmesi ve `__SyzerUsagePane` enjeksiyonu. Günlük girdi/çıktı token ve maliyet grafikleri. | Stats & Usage sayfasında Syzer filtresi görünmez. |
| **`analytics-overview`** | `out/renderer/assets/Settings-*.js` | Stats & Usage genel bakış (Overview) özet tablosuna Syzer toplamlarının eklenmesi. | Genel bakışta Syzer tokenları toplanmaz. |
| **`restore`** | `out/renderer/assets/store-*.js`<br>`out/main/chunks/agent-session-host-authority-*.js` | Orca kapatılıp açıldığında açık Syzer sekmelerini tespit eder ve `syzer --resume <id>` argümanıyla önceki oturum durumunda yeniden ayağa kaldırır. | Orca yeniden açılınca sekmeler boş `syzer` olarak başlar. |
| **`shells`** | `out/main/index.js` | Orca normal kapatılırken (`X` veya tepsi Quit), arka planda çalışan daemon içindeki tüm açık ConPTY/terminal kabuklarını (`pwsh`, `claude` vb.) `quit-kill.js` ile kapatır. | Kapanışta arka planda yetim `pwsh.exe` süreçleri birikir. |

---

## 4. Protokol ve İletişim Sözleşmeleri (IPC, HTTP, Ortam Değişkenleri)

### 4.1 Ortam Değişkenleri (Environment Variables) Sözleşmesi

| Değişken Adı | Kaynak | Tüketici | Değer / Amaç |
|---|---|---|---|
| `ORCA_AGENT_HOOK_ENDPOINT` | Orca Ana Süreci | `src/orca-hooks.js` | Hook yapılandırma dosyasının tam yolu (dosyadan port ve token okunur). |
| `ORCA_AGENT_HOOK_PORT` | Orca Ana Süreci | `src/orca-hooks.js` | Yerel HTTP hook sunucu portu (örn. `52341`). |
| `ORCA_AGENT_HOOK_TOKEN` | Orca Ana Süreci | `src/orca-hooks.js` | `X-Orca-Agent-Hook-Token` kimlik doğrulama belirteci. |
| `ORCA_PANE_KEY` | Orca Terminali | `orca-hooks.js`, `orca-workers.js` | Terminal bölmesinin tekil anahtarı. Varlığı oturumun Orca içinde olduğunu kanıtlar. |
| `ORCA_TAB_ID` | Orca Terminali | `src/orca-hooks.js` | Sekme kimliği. |
| `ORCA_AGENT_LAUNCH_TOKEN` | Orca Terminali | `orca-hooks.js`, `selfupdate.js` | Orca tarafından başlatıldığını gösterir; otomatik güncellemeyi engeller. |
| `ORCA_WORKTREE_ID` | Orca Terminali | `src/orca-workers.js`, `orca-hooks.js` | Çalışılan worktree kimliği (işçiler aynı worktree'de sekme açar). |
| `ORCA_CLI_COMMAND` | Kullanıcı / Ortam | `src/orca-workers.js` | `orca` CLI komutunun yolu (varsayılan: Windows'ta `orca.exe`). |
| `SYZER_NO_WORKERS` | Kullanıcı | `src/orca-workers.js` | `1` ise `spawn_syzer` aracı devre dışı kalır. |
| `SYZER_WORKER_CLOSE` | Kullanıcı | `src/orca-workers.js` | `1` ise işçi işini bitirince Orca terminal sekmesi kapatılır. |
| `SYZER_CLI_CMD` | `src/orca-bridge.js` | Orca Yamaları (`cli.json`) | Orca'nın Syzer'ı başlatmak için çağıracağı komut dizesi. |
| `SYZER_ORCA_PLUGIN_DIR` | Geliştirici | `src/orca-bridge.js` | Yerel eklenti kaynak dizini (GitHub indirmesini atlar). |

---

### 4.2 HTTP Hook Olay Sözleşmesi (`POST /hook/syzer`)

Orca yerel HTTP sunucusuna gönderilen tüm isteklerin şeması:

- **HTTP Metodu & Yolu:** `POST http://127.0.0.1:<PORT>/hook/syzer`
- **Başlıklar:**
  ```http
  Content-Type: application/json
  X-Orca-Agent-Hook-Token: <ORCA_AGENT_HOOK_TOKEN>
  ```
- **Ortak İstek Gövdesi:**
  ```json
  {
    "paneKey": "pane-abc123",
    "tabId": "tab-xyz789",
    "launchToken": "tok-...",
    "worktreeId": "wt-...",
    "env": "",
    "version": "1",
    "hook_event_name": "<EventName>",
    "payload": {
      "hook_event_name": "<EventName>",
      "session_id": "20261013010310-a1b2",
      "...": "olaya özgü alanlar"
    }
  }
  ```

#### Olay Kataloğu:
1. **`Prompt`:** Kullanıcı mesaj gönderdiğinde tetiklenir (`status: working`).
   - `payload`: `{ prompt: string }`
2. **`ToolStart`:** Araç çağrısı başladığında tetiklenir (`status: working`, satırda araç adı görünür).
   - `payload`: `{ tool_name: string, tool_input: object|{ command: string } }`
3. **`ToolEnd`:** Araç çağrısı bittiğinde tetiklenir.
   - `payload`: `{ tool_name: string }`
4. **`Done`:** Asistan turu tamamlandığında tetiklenir (`status: done / idle`).
   - `payload`: `{ last_assistant_message: string }`
5. **`Waiting`:** Araç çalıştırma onayı veya kullanıcı girdisi beklenirken tetiklenir (`status: waiting`).
   - `payload`: `{ tool_name: string }`
6. **`Resumed`:** Kullanıcı onay verip akış devam ettiğinde tetiklenir.
   - `payload`: `{ tool_name: "approval" }`
7. **`Plan`:** `todo_write` planı güncellendiğinde tetiklenir (Orca alt ajan paneline yansır).
   - `payload`:
     ```json
     {
       "total": 4,
       "done": 1,
       "plan": [
         {
           "id": "b",
           "n": 2,
           "title": "write code",
           "status": "working",
           "agent": "general",
           "model": "m1",
           "waits": []
         },
         {
           "id": "c",
           "n": 3,
           "title": "write tests",
           "status": "idle",
           "agent": "general",
           "model": "",
           "waits": ["b"]
         }
       ]
     }
     ```
8. **`SubagentStart`:** Alt ajan veya işçi başladığında tetiklenir (kenar çubuğunda canlı liste).
   - `payload`: `{ agent_id: string, agent_type: string, description?: string }`
9. **`SubagentStop`:** Alt ajan bittiğinde tetiklenir (kenar çubuğundan çıkarılır).
   - `payload`: `{ agent_id: string }`
10. **`End`:** Syzer oturumu kapandığında tetiklenir.
    - `payload`: `{}`

---

### 4.3 Terminal İşçi Sözleşmesi (`spawn_syzer`)

`src/orca-workers.js` üzerinden çalışan işçilerin yaşam döngüsü sözleşmesi:
1. Ana oturum `~/.syzercli/workers/<id>/prompt.txt` dosyasını yazar.
2. CLI komutu çalıştırılır:
   ```bash
   orca.exe terminal create --worktree id:<wtId> --title "Syzer: <title>" --command "syzer -y -k <nextKey> --title ... --prompt-file <prompt.txt> --out <result.txt>" --json
   ```
3. Ana oturum `result.txt` dosyasının diske yazılmasını 15 dakika boyunca yoklar (`fs.existsSync`).
4. Sonuç dosyasındaki metin okunur. Eğer metin `ERR_` veya `ERROR:` ile başlıyorsa 2. bir deneme (`MAX_ATTEMPTS = 2`) farklı bir API key ile başlatılır.
5. Sonuç ana ajana `LIMITS.subagentReport` (8.000 karakter) sınırında döner.

---

### 4.4 Oturum ve Transkript Dosya Sözleşmesi

- **Ana Oturum:** `~/.syzercli/sessions/<id>.json`
  - Biçim: `{ id, cwd, model, ts, title, messages: [{ role, content }] }`
  - Orca tarayıcısı (`__syzerParse`) bu dosyayı okur; ilk kullanıcı mesajını başlık, mesaj sayısını sayaç olarak alır.
- **Alt Ajan Transkriptleri:** `~/.syzercli/sessions/<id>/subagents/agent-<n>.json`
  - Biçim: `{ id, agentType, description, status, messages: [...] }`
  - Orca alt ajan tarayıcısı (`__syzerSubs`) bu dizindeki dosyaları tarayarak oturum geçmişi kartında hiyerarşik olarak listeler.

---

## 5. Windows Entegrasyonu, Süreç Yaşam Döngüsü ve Dayanıklılık

Windows platformu üzerinde eklenti üç ana bileşenle kalıcılık sağlar (`src/platform/win32.js`):

1. **Zamanlanmış Görev (`schtasks`):**
   - Görev Adı: `SyzerOrcaPatch`
   - Tetikleyici: Her 10 dakikada bir (`/SC MINUTE /MO 10`).
   - Eylem: `wscript.exe //B "~/.syzercli/orca/patch.vbs"`.
   - Amaç: Orca otomatik güncellendiğinde yeni `app.asar` geldiğinde, Orca kapalı olduğu ilk 10 dakikalık aralıkta yamayı sessizce yeniden uygular.
2. **Kullanıcı Oturum Açılışı Kayıt Defteri (`HKCU Run`):**
   - Anahtar: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\SyzerOrcaPatch`.
   - Eylem: Bilgisayar yeniden başlatıldığında veya kullanıcı oturum açtığında yama kontrolü çalışır.
3. **Masaüstü Kısayolu (`Orca (Syzer).lnk`):**
   - Hedef: `~/.syzercli/orca/orca-start.vbs`.
   - Betik: Önce `patch --quiet` çalıştırarak yamayı garantiye alır, ardından `Orca.exe` sürecini başlatır.
4. **Çalışırken Yamalamama Emniyeti (`runningCheck`):**
   - `tasklist /FI "IMAGENAME eq Orca.exe" /NH` ile kontrol edilir. Orca açıkken asar dosyasına asla dokunulmaz (`status: running` döner).

---

## 6. Mevcut Durum, Test Kapsamı ve Zayıf/Riskli Noktalar (D1 Spec Girdileri)

### 6.1 Canlı Sistem Doğrulama Sonuçları (2026-10-13)
- **Node.js:** v24.15.0
- **Platform:** Windows 10 (10.0.19045 x64)
- **Orca Sürümü:** 1.4.224
- **Orca Eklenti Sürümü:** v1.4.0 (Yama Sürümü: 11)
- **Uygulanan Gruplar:** 9/9 tam (`core`, `usage`, `agent`, `history`, `keys`, `analytics`, `analytics-overview`, `restore`, `shells`)
- **Atlanan Gruplar:** 0
- **Birim Testler:** 266/266 yeşil (`bridge.test.js`, `plan-hook.test.js`, `agent-tree.test.js`, `key-health.test.js`, `a5-errors.test.js` vb.).

---

### 6.2 Zayıf Noktalar, Kırılganlıklar ve Risk Analizi

1. **Minified Kod Çapaları (Anchor Fragility):**
   - Yama motoru Regex çapaları ve yakalama grupları kullanır. Orca'nın Vite/Electron paketleme zincirinde değişken adı çakışması veya küçük bir kod yeniden düzenlemesi (refactoring) çapaların eşleşmemesine (`anchor matched 0x`) yol açabilir.
   - *Mevcut Savunma:* Grup yalıtımı vardır; bozulan grup atlanır (`skip`), Orca çökmez. Ancak özellik kaybolur.
2. **Ayrı Depo Bağımlılığı (`SyzerCLI` vs `SyzerCLI-Orca`):**
   - SyzerCLI repo içinde yalnızca köprü (`src/orca-bridge.js`) bulunur; asıl yamalar `github.com/yasinbalcik/SyzerCLI-Orca` reposundadır.
   - İki proje arasındaki sözleşmeler (örneğin `--usage-analytics` şeması veya `--prompt-file` bayrakları) senkron tutulmalıdır.
3. **Windows ConPTY ve Kabuk Belirsizliği:**
   - `src/orca-workers.js:33-41` içindeki `selfCmd()`: Orca terminalinde hangi kabuğun (PowerShell 5, PowerShell 7, CMD, Git Bash) varsayılan olduğu bilinemez. Bu nedenle `& "..."` çağrı işleci ve tırnaklama kuralları özel önem taşır.
4. **Günlük Dosyası Boyutları:**
   - `~/.syzercli/orca/patch.log` 200KB'ta döner (`src/orca-patch.js:97`). Ancak `quit.log` için henüz otomatik döndürme (rotation) yoktur.
5. **Zaman Aşımı ve Yanıt Süresi Limitleri:**
   - Worker 15 dakika (`src/orca-workers.js:67`).
   - Hook gönderimi 800ms (`src/orca-hooks.js:9`).
   - Doctor kontrolü 5.000ms (`src/doctor.js:81`).
   - Ağır key havuzlarında (700 key) `usage-summary.js` 10-25 saniyelik zaman bütçesi uygular; status bar gecikmesi yaşanmaması için önbellek kritik önemdedir.

---

## 7. Sonuç ve Sonraki Adımlar

Bu envanter çalışması (D0), SyzerCLI'ın Orca entegrasyonunun tüm bileşenlerini, veri akışlarını, HTTP ve IPC protokollerini ve `app.asar` yama mekanizmasını `dosya:satır` düzeyinde ortaya koymuştur.

- **Kod Değişikliği Durumu:** `git diff --stat` kod dosyalarında tamamen boştur. Yalnızca bu dokümantasyon eklenmiştir.
- **D1 (Spec) Kartı İçin Girdiler:**
  - Orca eklentisi ve SyzerCLI arasındaki sözleşmelerin tip güvenliği (TypeScript/JSDoc tanımları).
  - Terminal işçi (`spawn_syzer`) hata yönetimi ve ConPTY uyumluluğunun güçlendirilmesi.
  - CI Canary akışının yerel `syzer doctor` ile tam senkronizasyonu.
