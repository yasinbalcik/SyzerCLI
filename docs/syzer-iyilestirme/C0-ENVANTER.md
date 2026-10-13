# C0 Keşif Envanteri: SyzerCLI Kullanım ve UX (User Experience) Mimarisi

**Tarih:** 2026-10-13  
**Kart:** C0 (Alan C: Kullanım / UX Keşif ve Envanter)  
**Rol:** C0 (L2 Worker)  
**Üst Şef:** Koordinatör (Claude Sonnet 5.5 / Orca)  
**Çalışma Alanı:** `syzer-C0` (`feat/syzer-C0` / `yasinbalcik/syzer-C0`)  
**Kapsam:** CLI giriş noktaları, komut satırı bayrakları, ilk kurulum (onboarding) ve animasyonlar, interaktif terminal REPL düzeni, editör ve klavye/fare etkileşimleri, canlı dock ve alt ajan paneli, slash komutları sistemi, izin ve onay diyalogları, geri alma (undo/checkpoints), çoklu dil (i18n), terminal erişilebilirliği (a11y) ve kullanıcı deneyimi boşlukları (UX friction points).  
**Durum:** Tamamlandı (`git diff --stat` kod dosyalarında boş, yalnızca bu envanter raporu üretildi).

---

## 1. Yönetici Özeti ve UX Mimarisi Genel Bakışı

SyzerCLI, terminal üzerinde çalışan son derece yetenekli, yerel ve sıfır harici UI bağımlılığına (`0 runtime npm dependencies`) sahip bağımsız bir yapay zeka kodlama ve otomasyon ajanıdır. Arayüzün tüm zenginliği saf Node.js (`readline`, ANSI/VT100 kaçış dizileri, DECSTBM ekran bölgeleme ve SGR fare protokolleri) ile inşa edilmiştir.

### 1.1 Çift Çalışma Modu Felsefesi (Dual UX Mode)
SyzerCLI'ın arayüz mimarisi iki ana çalışma biçimine ayrılır:
1. **Zengin Sabit Ekran Modu (Rich Fixed-Screen Viewport):**
   - Terminal TTY ortamında, en az 16 satır yüksekliğinde, renk destekli ve `SYZER_NO_FRAME` ayarlanmamışken devreye girer ([`src/repl.js:248`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L248)).
   - Terminalin alternatif ekran tamponunu (`\x1b[?1049h`) kullanır. Üstte dönen logolu/maskotlu canlı bir başlık, altta sabit durum ve giriş çerçevesi yer alır. Aradaki bölge (`DECSTBM` kaydırma bölgesi) çıktıların kaydığı bağımsız bir çalışma alanıdır.
2. **Standart Akış / Sade Mod (Headless / Raw Scrollback Mode):**
   - CI/CD boru hatlarında, borulanmış (piped) girdilerde, TTY olmayan kabuklarda veya dar terminallerde çalışır ([`bin/syzer.js:126-210`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/bin/syzer.js#L126-L210), [`src/headless.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/headless.js)).
   - Çıktı doğrudan `stdout`/`stderr` akışına düz metin veya tekil JSON (`--json`) olarak basılır.

### 1.2 UX Bileşen Haritası ve Dosya Sorumlulukları
SyzerCLI kullanıcı deneyimi **14 temel kaynak dosyası** etrafında şekillenmiştir:
- **Komut Satırı ve Dispatcher:** [`bin/syzer.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/bin/syzer.js), [`src/headless.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/headless.js)
- **İlk Karşılama ve Maskot:** [`src/setup.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/setup.js), [`src/splash.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/splash.js), [`src/logo3d.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/logo3d.js), [`src/pet.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/pet.js)
- **Terminal Düzeni ve Etkileşim:** [`src/repl.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js), [`src/header.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/header.js), [`src/scrollback.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/scrollback.js)
- **Girdi, Düzenleme ve Seçiciler:** [`src/input.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js)
- **Canlı Görev Yürütme ve Dock:** [`src/dock.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js), [`src/agent-tree.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/agent-tree.js)
- **Slash Komutları ve Bilgi Sistemi:** [`src/cmdinfo.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmdinfo.js), [`src/cmds.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js), [`src/cmds2.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js)
- **İzin, Onay ve Kurtarma:** [`src/permissions.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/permissions.js), [`src/checkpoints.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/checkpoints.js)
- **Görselleştirme ve Çıktı:** [`src/ui.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/ui.js), [`src/diff.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/diff.js)

---

## 2. CLI Giriş Noktaları, Argümanlar ve Komut Satırı UX (`bin/syzer.js`)

`bin/syzer.js`, hem terminal kullanıcısının etkileşimli REPL kapısı hem de CI/CD ve harici otomasyonların (Orca vb.) çağırdığı komut satırı arayüzüdür.

### 2.1 Argüman Ayrıştırma ve Öncelik Hiyerarşisi
- **Konum:** [`bin/syzer.js:58-104`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/bin/syzer.js#L58-L104) (`parseArgs`), [`bin/syzer.js:316-330`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/bin/syzer.js#L316-L330)
- **İstem Kaynağı Önceliği (Prompt Resolution):**
  1. `--prompt-file <dosya>` (Orca işçileri ve betikler için dosya tabanlı görev)
  2. `--prompt "<metin>"` (Açık CLI bayrağı)
  3. Konumsal argümanlar (`syzer "görevi yap"`)
  4. Borulanmış Standart Girdi (`echo "görev" | syzer -` veya `stdinIsTTY == false`)
  5. Hiçbiri yoksa -> İnteraktif REPL başlatılır ([`src/repl.js:207`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L207)).

### 2.2 CLI Bayrakları ve Kullanıcı Seçenekleri Kataloğu

| Bayrak | Kısa | Açıklama | Davranış & UX Etkisi |
|---|---|---|---|
| `--prompt <text>` | - | Görev metni | Headless tek atımlık çalıştırma başlatır. |
| `--prompt-file <f>` | - | Dosyadan görev oku | Uzun görevleri dosyadan okur, dosya yoksa `EXIT.USAGE (2)` verir. |
| `--out <f>` | - | Çıktı dosyası | Sonucu atomik olarak (`.tmp` -> rename) dosyaya yazar. |
| `--json` | - | JSON çıktısı | Başarı/hata, süre, token ve dosya değişikliklerini tek JSON nesnesi olarak döner. |
| `--quiet` | - | Sessiz mod | `stderr` üzerindeki araç ilerleme loglarını susturur; yalnızca sonucu verir. |
| `-y`, `--yes` | `-y` | Otomatik onay | Araç onaylarını atlar (`--unrestricted` takma adı Orca uyumluluğu içindir). |
| `-p`, `--print` | `-p` | Tek seferlik çıktı | Etkileşimsiz çalıştırmayı zorlar. |
| `-m`, `--model <id>` | `-m` | Model seçimi | Bu oturum için modeli ezerek başlatır. |
| `-e`, `--effort <lvl>` | `-e` | Düşünme eforu | `auto`, `off`, `low`, `medium`, `high`, `xhigh` seviyesini ayarlar. |
| `-k`, `--key <n>` | `-k` | Anahtar indeksi | Belirtilen API anahtarını kullanır (1-tabanlı). |
| `--provider <p>` | - | Sağlayıcı | Yalnızca bu çalıştırma için `openrouter` veya `nvidia` seçer. |
| `-c`, `--continue` | `-c` | Son oturumu sürdür | Çalışma alanındaki en son oturumu hafızaya yükleyerek açar. |
| `--resume <id>` | - | Oturum ID ile sürdür | Belirtilen kimlikli oturumu ekrana dökerek devam ettirir. |
| `-a`, `--agent <name>` | `-a` | Alt ajan olarak çalış | Görevi doğrudan belirli bir alt ajan profiliyle (`explore`, `plan` vb.) koşar. |
| `--no-agents` | - | Alt ajanları devre dışı bırak | Alt ajan (`spawn_agent`) çağırma yeteneğini kısıtlar. |
| `--no-tools` | - | Araçları kapat | Modeli salt sohbet modunda başlatır. |
| `--budget-tokens N` | - | Token bütçesi | Belirtilen token limitinde görevi güvenli durdurur. |
| `--budget-turns N` | - | Tur bütçesi | Maksimum adım/tur sayısını sınırlar. |
| `--budget-minutes N` | - | Süre bütçesi | Dakika bazlı tavan süre koyar. |
| `--timeout-minutes N`| - | Zaman aşımı | Süre aşımında süreci `TIMEOUT` hatası ve kod 1 ile sonlandırır. |

### 2.3 Headless Sözleşmesi ve Çıkış Kodları (Exit Codes)
- **Konum:** [`src/headless.js:6-17`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/headless.js#L6-L17)
- `0 (OK)`: Görev başarıyla tamamlandı.
- `1 (ERROR)`: Model hatası, çalışma zamanı istisnası veya `TIMEOUT`.
- `2 (USAGE)`: Geçersiz bayrak, eksik anahtar veya sözdizimi hatası.
- `3 (BUDGET)`: Görev bütçesi (`--budget-*`) aşıldı ve işlem durduruldu.
- `4 (DENIED)`: Araç çalıştırma izni kullanıcı/sistem tarafından reddedildi (`-y` verilmedi).
- `130 (INTERRUPTED)`: `SIGINT` (Ctrl+C) veya `SIGTERM` ile kesildi.

---

## 3. İlk Kurulum, Onboarding ve Karşılama Deneyimi

### 3.1 İlk Kurulum Sihirbazı (`src/setup.js`)
- **Tetiklenme Kuralı (`needed`):** Kurulum henüz yapılmadıysa (`!cfg.setupDone`), terminal TTY ise ve kayıtlı hiçbir API anahtarı yoksa otomatik başlar ([`src/setup.js:60-62`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/setup.js#L60-L62)). Ayrıca `syzer setup` komutu ile her zaman yeniden çalıştırılabilir.
- **Adım Adım Sihirbaz Akışı:**
  1. **Dil Seçimi (Language):** İlk ekranda henüz dil bilinmediğinden çift dilli (`Language / Dil`) başlık gösterilir; 8 desteklenen dil (`tr, en, de, es, ja, zh, ko, pl`) numaralandırılarak seçtirilir.
  2. **Eğitim ve Karşılama:** SyzerCLI'ın özellikleri, komutları ve konfigürasyon dizini (`~/.syzercli`) hakkında kısa eğitici özet metin basılır ([`src/setup.js:32-34`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/setup.js#L32-L34)).
  3. **Sağlayıcı Seçimi:** OpenRouter veya NVIDIA seçenekleri anahtar formatı ipuçlarıyla sunulur.
  4. **Toplu API Anahtarı Girişi:** Çok satırlı anahtar yapıştırma konsolu açılır; girilen anahtarlar doğrulanır (`keyAdd`). Boş geçilirse kullanıcı uyarılır ancak akış kesilmez.
  5. **İzin Modu Seçimi:** `ask` (her değişiklikte sor), `auto` (otomatik onayla) veya `readonly` (salt-okunur) modlarından biri varsayılan olarak belirlenir.

### 3.2 3D Logo ve Karşılama Ekranı (`src/splash.js` & `src/logo3d.js`)
- **Tetiklenme:** Yalnızca zengin ekran modu aktif **değilken** (`!rich`), yeterli satır/sütun varsa (`>=24 satır, >=50 sütun`), `SYZER_NO_LOGO` tanımlanmamışsa ve ilk açılışsa gösterilir ([`src/splash.js:22-27`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/splash.js#L22-L27)).
- **3D Nokta Bulutu İzdüşümü (`src/logo3d.js`):**
  - Syzer'in simgesel logosunu oluşturan 2D nokta bulutu (`LOGO_POINTS`), 3 Z-katmanına (`LAYERS = 3`) çoğaltılarak hacimlendirilir ([`src/logo3d.js:7-10`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/logo3d.js#L7-L10)).
  - Y ekseni ve X ekseni etrafında trigonometrik dönüş matrisiyle açı (`angle = t * 0.9`) ve eğim (`tilt = 0.18 * sin(t * 0.7)`) hesaplanır.
  - Perspektif formülü (`CAM / (CAM - z)`) ile hücre koordinatlarına dönüştürülür. Z-buffer algoritması (`pickFront`) ile aynı hücreye denk gelen noktalardan en yakını seçilir ve derinlik renklendirmesi yapılır.
- **Tuş Yakalama ve Güvenli Çıkış:** Kullanıcı herhangi bir tuşa bastığında animasyon anında sonlanır; ancak kullanıcının o sırada bastığı tuşlar kaybolmaz (`pendingKeys`), REPL editörüne enjekte edilir ([`src/splash.js:54-82`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/splash.js#L54-L82), [`src/repl.js:612`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L612)).

### 3.3 Zip Maskotu ve Canlı Piksel Sanatı (`src/pet.js`)
- **Kimlik:** Turuncu tilki yavrusu "Zip". Kuyruğu logodaki gibi köşeli bir Z/S zikzağıdır.
- **Çizim Tekniği:** Yarım blok karakterleri (`▀`, `▄`, `█`) kullanılarak hücre başına 2 dikey piksel çözünürlük sağlanır; toplam `14x6` hücrede `14x12` piksel alan kaplar ([`src/pet.js:9-11`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/pet.js#L9-L11)).
- **Durum Animasyonları:**
  - **Boşta (Idle):** ~4 saniyede bir kısa göz kırpma, 7 saniyede bir kulak oynatma, 6 saniyede bir kuyruk sallama ve periyodik olarak sağdaki başlık metnine bakma ([`src/pet.js:37-56`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/pet.js#L37-L56)).
  - **Meşgul (Busy - Model/Araç Çalışırken):** Maskot 1 piksel yukarı zıplar (`up = 0`), kuyruğunu hızlıca sallar (`t * 6`), gözleri sağa-sola hareket eder ([`src/pet.js:43, 53, 59`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/pet.js#L43)).

---

## 4. İnteraktif Terminal REPL ve Düzen Mimarisi (Layout UX)

### 4.1 Sabit Ekran Düzeni (Fixed-Screen Viewport Architecture)
SyzerCLI'ın en belirgin UX gücü, modern editörler (Claude Code vb.) gibi çalışan sabit ekran düzenidir ([`src/repl.js:254-332`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L254-L332)):

```
┌────────────────────────────────────────────────────────────────────────┐
│  [Zip Maskotu]    Syzer Code v3.29.0                                   │ <- Sabit Üst Başlık (Header)
│  (Canlı 12 FPS)   anthropic/claude-3.5-sonnet · high effort · OpenRouter│    (Satır 1..7)
│                   ~/projects/my-app                                    │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ● Read(package.json)                                                  │ <- Kaydırma Bölgesi (DECSTBM)
│    ⎿ 28 lines read                                                     │    (Scrollback Buffer: satır 8..N-5)
│  ◆ İşte projenizin mimari yapısı...                                    │    Yalnızca bu alan kayar.
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│                                              key #1/4  ·  ○ high · /effort │ <- Üst Çerçeve (Tıklanabilir)
├────────────────────────────────────────────────────────────────────────┤
│  ❯ Görevinizi buraya yazın...                                          │ <- Giriş Kutusu (Editor)
├────────────────────────────────────────────────────────────────────────┤
│────────────────────────────────────────────────────────────────────────│
│  ⏵⏵ ask · /perm                         OpenRouter · claude-3.5-sonnet │ <- Alt Durum Çubuğu (Tıklanabilir)
└────────────────────────────────────────────────────────────────────────┘
```

- **DECSTBM Bölgelemesi:** `\x1b[top;bottomr` komutuyla terminal donanımsal olarak üst ve alt sınırları kilitler ([`src/header.js:89`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/header.js#L89)). Çıktılar aktıkça ne başlık ne de giriş kutusu kayar.
- **Canlı Başlık Animasyonu:** [`src/header.js:99-115`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/header.js#L99-L115) üzerinde 12 FPS ile çalışan zamanlayıcı, maskotun karesini günceller ve imleci bozmadan saklanan konuma geri döner (`\x1b7` / `\x1b8`).

### 4.2 Tıklanabilir Durum Çubuğu (Clickable Status Bar & Mouse Hit Regions)
Terminalde SGR fare modu (`\x1b[?1000h\x1b[?1006h`) açıktır. Çerçeve üzerindeki kritik metinler tıklanabilir bölgeler (`hits`) olarak taranır ([`src/header.js:39-73`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/header.js#L39-L73)):
- **`key #n/m` tıklanınca:** API Anahtarı seçici modalı açılır (`Editor#pick`).
- **`○ effort · /effort` tıklanınca:** Efor seviyesi seçici modalı açılır (`auto, off, low, medium, high, xhigh`).
- **`⏵⏵ perm` tıklanınca:** İzin modu seçici modalı açılır (`ask, auto, readonly`).
- **`provider` tıklanınca:** Sağlayıcı seçici modalı açılır (`OpenRouter, NVIDIA`).
- **`model` tıklanınca:** Model listesi ve arama modalı açılır.

### 4.3 Dahili Kaydırma Tamponu (`src/scrollback.js`)
Alternatif ekranda terminalin yerel kaydırma çubuğu devre dışı kaldığından SyzerCLI kendi kaydırma mekanizmasını çalıştırır:
- Son 4.000 satırı bellekte saklar (`MAX_LINES = 4000`).
- Fare tekerleği (`wheel`) veya `PgUp` / `PgDn` tuşlarına basıldığında yalnızca kaydırma bölgesi geriye doğru taranır ([`src/scrollback.js:152-161`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/scrollback.js#L152-L161)).
- Altta `↓ N satır aşağıda · tekerlek / PgDn · bir tuş canlıya döner` uyarısı çıkar.
- Kullanıcı herhangi bir tuşa bastığında otomatik olarak canlı ekrana (`live()`) dönülür.
- **Tıklanabilir Ajan Kartları:** Çıktı alanında daha önce tamamlanmış bir ajanın kartına tıklandığında (`hitAt`), o ajanın detaylı tam ekran raporu açılır ([`src/scrollback.js:142-150`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/scrollback.js#L142-L150), [`src/repl.js:277-278`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L277-L278)).

---

## 5. Girdi ve Editör Deneyimi (`src/input.js`)

`src/input.js`, readline modülü yerine ham modda çalışan, gelişmiş tek satırlık ve çok satırlı bir terminal editörüdür.

### 5.1 Klavye Kısayolları ve Düzenleme İşlemleri

| Tuş Kombinasyonu | Eylem | Uygulama Konumu |
|---|---|---|
| `Enter` / `Return` | Komutu veya görevi gönderir | [`src/input.js:390`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L390) |
| `Shift+Enter`, `Alt+Enter`, `Ctrl+J`, `\ + Enter` | Yeni satır ekler (kutu yukarı doğru büyür) | [`src/input.js:387-388`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L387-L388) |
| `↑` / `↓` (Çok satırlı) | Satırlar arasında imleci gezdirir (`_vert`) | [`src/input.js:326-339`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L326-L339) |
| `↑` / `↓` (İlk/Son satırda) | Oturum komut geçmişinde gezinir (`_hist`, son 200 komut) | [`src/input.js:448-460`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L448-L460) |
| `Ctrl+C` | Giriş doluysa metni temizler; boşsa görevi iptal eder / çıkar | [`src/input.js:405-412`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L405-L412) |
| `Ctrl+D` | Giriş boşsa SyzerCLI'dan çıkar (`exit`); doluysa karakter siler | [`src/input.js:413-417`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L413-L417) |
| `Ctrl+A` / `Home` | Satırın en başına gider | [`src/input.js:395, 418`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L395) |
| `Ctrl+E` / `End` | Satırın en sonuna gider | [`src/input.js:396, 419`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L396) |
| `Ctrl+U` | İmleçten satır başına kadar olan kısmı siler | [`src/input.js:420`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L420) |
| `Ctrl+K` | İmleçten satır sonuna kadar olan kısmı siler | [`src/input.js:421`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L421) |
| `Ctrl+W` | Soldaki kelimeyi siler (`_wordLeft`) | [`src/input.js:422`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L422) |
| `Ctrl+Left` / `Ctrl+Right` | Kelime kelime sola/sağa atlar | [`src/input.js:393-394`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L393-L394) |
| `Tab` | Slash komutunu otomatik tamamlar | [`src/input.js:399, 462-479`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L399) |
| `Escape` | Açık öneri menüsünü veya seçici modalı kapatır | [`src/input.js:177, 383`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L177) |

### 5.2 Akıllı Parantezli Yapıştırma (Bracketed Paste & Atomic Placeholders)
Kullanıcı terminale uzun bir metin veya görsel yapıştırdığında ekranın bozulmaması için özel bir mekanizma kullanılır ([`src/input.js:481-502`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L481-L502)):
- **Uzun Metin Yapıştırma:** Metin 1 satırdan fazla veya 300 karakterden uzunsa, satır içine `[Pasted text #1 +42 lines]` şeklinde tek bir **atomik placeholder** yerleştirilir.
- **Görsel Dosyası Yapıştırma:** Yapıştırılan metin bir veya daha fazla görsel yolu içeriyorsa (`.png, .jpg, .webp` vb.), `[Image #1]` placeholder'ı eklenir ve arka planda vision API parçasına dönüştürülür ([`src/input.js:16-25, 484-489`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L16-L25)).
- **Atomik Silme:** Tek bir `Backspace` tuşu tüm placeholder'ı tek seferde siler.
- **Gönderimde Çözümleme:** Kullanıcı Enter'a bastığında bu placeholder'lar orijinal içerikleriyle genişletilerek modele gönderilir.

### 5.3 Komut Öneri Menüsü ve Seçici Modalı (Overlay Pickers)
- **Komut Önerisi (`_updateMenu`, `_menuRows`):** Kullanıcı `/` yazdığı anda giriş kutusunun hemen üzerinde yarı saydam bir overlay menü belirir ([`src/input.js:125-136, 237-248`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L125-L136)). Yukarı/aşağı ok tuşlarıyla komutlar arasında gezilebilir; Enter ile argümansız komutlar anında çalıştırılır.
- **Filtrelenebilir Seçici (`Editor#pick`):** Model, efor, sağlayıcı veya anahtar seçimi için açılan tam ekran modalı. Kullanıcı yazı yazdıkça listeyi anında filtreler (`query`), fare tekerleği ile kaydırılabilir, Enter ile seçilir ([`src/input.js:139-183`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L139-L183)).

### 5.4 `@dosya` Bahsetmeleri (File Mentions)
- **Konum:** [`src/repl.js:134-149`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L134-L149) (`expandMentions`)
- Kullanıcı mesajında `@src/config.js` veya `@package.json` gibi bir ifade kullandığında, SyzerCLI bu dosyayı yerel diskten okur ve mesajın sonuna `<file path="...">...</file>` formatında otomatik olarak iliştirir. Maksimum dosya boyutu `LIMITS.mentionFile` (60.000 karakter) ile sınırlandırılır.

---

## 6. Canlı Görev Yürütme ve Dock / Alt Ajan Paneli UX

Model bir görev üzerinde çalışırken, terminalin alt kısmında dinamik olarak büyüyüp küçülen bir **Dock** alanı açılır ([`src/dock.js`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js)).

### 6.1 Dock Mimarisi ve Durum Gösterimi
- **Dinamik Yükseklik Yönetimi (`need`, `grow`, `shrink`):** Dock; durum satırı, sıradaki mesajlar, kullanıcı giriş kutusu ve alt ajan sayısına göre yüksekliğini dinamik olarak ayarlar (asgari 4-5 satır, panel modunda 12+ satır). Üstteki kaydırma bölgesi buna göre anlık daraltılır veya genişletilir ([`src/dock.js:74-79, 112-147`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L74-L79)).
- **Düşünce ve Spinner:** Braille karakterli döner spinner (`⠋, ⠙, ⠹...`), geçen süre saniyesi, token göstergesi (`↓ 420 tok`) ve modelin o an ürettiği son düşünce parçası (italik ve silik gri yazı) canlı akar ([`src/dock.js:385-392`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L385-L392)).

### 6.2 Ajan Çalışırken Eşzamanlı Mesaj Kuyruğu (Concurrent Input Queue)
- Ajan araç çalıştırırken veya düşünürken kullanıcının giriş yapması engellenmez.
- Kullanıcı alttaki giriş kutusuna yeni bir talimat yazıp Enter'a basabilir. Bu mesajlar `queue` dizisine alınır ve dock üzerinde `⏎ 1 mesaj sırada: "..."` şeklinde görünür ([`src/dock.js:167-170, 393`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L167-L170)). Aktif tur biter bitmez sıradaki mesaj otomatik olarak yürütülür.
- Ayrıca kullanıcı `/runs` veya `/tree` yazarsa, tur bitmesini beklemeden canlı olarak çalıştırılır ([`src/dock.js:163`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L163)).

### 6.3 Ajan Paneli ve Canlı Kartlar (`src/agent-tree.js`)
- Terminal satır sayısı `>=28` ve sütun sayısı `>=70` olduğunda **Panel Modu** devreye girer ([`src/dock.js:63`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L63)).
- Her alt ajan için 6 satırlık yuvarlak kenarlı bir kart (`card`) çizilir ([`src/agent-tree.js:125-140`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/agent-tree.js#L125-L140)):
  - Başlık: Durum ikonu (`●, ✓, ✖, …`) + Ajan türü (`explore, plan, general`)
  - Model adı ve etiketi
  - Anlık yaptığı eylem (örn. `src/config.js okunuyor`)
  - İstatistikler: adım sayısı, token miktarı ve çalışma süresi.

### 6.4 Tam Ekran Canlı Ajan İnceleme Modu (`openView`)
- Giriş kutusu boşken kullanıcı `↓` tuşuna basarak veya fareyle bir ajan kartına tıklayarak ajanı seçebilir ([`src/dock.js:173-181, 213-228`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L173-L181)).
- `Enter`'a basıldığında SyzerCLI geçici olarak alternatif tam ekrana geçer (`enterAlt`):
  - Ajanın görevi (prompt), attığı tüm adımlar, çağırdığı araçlar, canlı konsol çıktısı ve ürettiği nihai rapor tam ekran olarak gösterilir ([`src/dock.js:306-333`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L306-L333)).
  - Kullanıcı `↑ / ↓ / PgUp / PgDn` ile kaydırabilir. `Esc` veya `q` tuşuna bastığında ana ekrana pürüzsüz geri dönülür.

---

## 7. Slash Komutları Sistemi Kataloğu (`src/cmdinfo.js`, `src/cmds.js`, `src/cmds2.js`)

SyzerCLI'da `/help` veya `/` yazıldığında listelenen tüm dahili komutlar 5 mantıksal gruba ayrılmıştır ([`src/cmdinfo.js:7-13`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmdinfo.js#L7-L13)):

### 7.1 Grup 1: Sohbet ve Oturum Yönetimi (`help_g_chat`)
- `/clear`: Oturum mesajlarını sıfırlar, ekranı ve kaydırma tamponunu tamamen temizler ([`src/repl.js:428-434`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L428-L434)).
- `/compact [hint|trim]`: Bağlam penceresini özetleyerek daraltır; `trim` yalnızca eski araç çıktılarını budar ([`src/repl.js:356-366`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L356-L366)).
- `/resume`: Mevcut çalışma alanındaki son 9 oturumu listeleyen etkileşimli seçim menüsü açar ([`src/repl.js:541-549`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L541-L549)).
- `/plan`: Salt-okunur planlama modunu açar/kapatır; promptun başına `[PLAN MODE]` ekler ([`src/repl.js:531-534`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L531-L534)).
- `/go`: Hazırlanan planı onaylar ve uygulama turunu başlatır ([`src/repl.js:535-540`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L535-L540)).
- `/undo [n] [--force]`: SyzerCLI'ın yaptığı son dosya değişikliklerini checkpoint deposundan geri alır ([`src/cmds2.js:154-169`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L154-L169)).
- `/context`: Mevcut aktif bağlamdaki token miktarını, mesaj sayısını ve enjekte edilen dosyaları listeler ([`src/repl.js:576-585`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L576-L585)).
- `/continue`: Yarım kalan göreve devam etmesi için modeli tetikler ([`src/repl.js:526`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L526)).
- `/exit` veya `/quit`: Oturumu kaydedip REPL'den çıkar ([`src/repl.js:427`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L427)).

### 7.2 Grup 2: Model ve Ayarlar (`help_g_model`)
- `/model [set <id>]`: Geçerli modeli gösterir veya değiştirir ([`src/cmds.js:255-268`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L255-L268)).
- `/models [arama]`: Kullanılabilir ücretsiz ve yetenekli modelleri bağlam boyutu ve araç desteğiyle listeler ([`src/cmds.js:229-234`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L229-L234)).
- `/effort [seviye]`: Düşünme derinliğini (`auto, off, low, medium, high, xhigh`) ayarlar ([`src/cmds.js:311-319`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L311-L319)).
- `/fallback [auto|off|set ...]`: Ana model çöktüğünde devreye girecek yedek modeller zincirini yönetir ([`src/cmds.js:321-330`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L321-L330)).
- `/provider [openrouter|nvidia]`: Sağlayıcılar arasında anlık geçiş yapar ([`src/cmds.js:19-36`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L19-L36)).
- `/perm [ask|auto|readonly]`: Araç izin modunu belirler ([`src/cmds.js:299-305`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L299-L305)).
- `/lang [kod]`: Arayüz dilini (`tr, en, de, es, ja, zh, ko, pl`) değiştirir ([`src/cmds.js:287-297`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L287-L297)).
- `/keys [list|add|use|remove]`: API anahtar havuzunu yönetir ([`src/cmds.js:48-100`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L48-L100)).
- `/usage`: Anahtar başına kalan günlük kota ve kullanım durumunu gösterir ([`src/cmds.js:201-211`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L201-L211)).
- `/stats`: Son 7 günlük istek ve token kullanım istatistiklerini döker ([`src/cmds.js:338-346`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L338-L346)).
- `/route`: Görev rollerine göre model yönlendirmesini (`route`) yönetir ([`src/cmds2.js:205-237`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L205-L237)).

### 7.3 Grup 3: Ajanlar ve Yürütme (`help_g_agents`)
- `/agents`: Sistemdeki tanımlı yerleşik ve özel alt ajanları listeler ([`src/cmds.js:350-358`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L350-L358)).
- `/subagent [model|effort|concurrency]`: Alt ajanların varsayılan model, efor ve eşzamanlılık ayarlarını belirler ([`src/cmds.js:360-378`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L360-L378)).
- `/runs`: Oturum boyunca çalışan tüm alt ajanların özet durum tablosunu basar ([`src/repl.js:478-484`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L478-L484)).
- `/run <no>`: Belirtilen numaralı alt ajanın görevini, araç adımlarını ve nihai raporunu detaylı inceler ([`src/repl.js:494-502`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L494-L502)).
- `/tree`: Süreç ağacını terminalde görsel olarak çizer ([`src/repl.js:485-493`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L485-L493)).

### 7.4 Grup 4: Proje ve Geliştirme Araçları (`help_g_project`)
- `/init`: Projeyi analiz edip AI ajanları için 60 satırlık `SYZER.md` kılavuzu oluşturur ([`src/repl.js:572-575`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L572-L575)).
- `/diff`: Çalışma alanındaki git değişikliklerini renkli olarak gösterir ([`src/cmds2.js:67-81`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L67-L81)).
- `/commit [mesaj]`: Model destekli git commit mesajı üretip onay sonrası commit atar ([`src/cmds2.js:84-108`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L84-L108)).
- `/review`: Mevcut git diff'ini LLM'e göndererek kod incelemesi yaptırır ([`src/cmds2.js:110-115`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L110-L115)).
- `/checkpoints`: Oturum içindeki dosya ve git checkpoint geçmişini listeler ([`src/cmds2.js:117-120, 144-152`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L117-L120)).
- `/restore`: Eski bir git checkpoint noktasına geri döner ([`src/cmds2.js:122-131`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L122-L131)).
- `/todos`: Aktif todo listesinin durumunu render eder ([`src/cmds2.js:60-63`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L60-L63)).
- `/tasks [stop <id>]`: Arka planda çalışan süreçleri listeler veya durdurur ([`src/cmds2.js:43-58`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L43-L58)).
- `/rules`, `/allow <kural>`, `/deny <kural>`: İzin kurallarını görüntüler ve kalıcı kural ekler ([`src/cmds2.js:17-39`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L17-L39)).
- `/mcp`: Bağlı MCP sunucularını ve sağladıkları araçları listeler ([`src/repl.js:557-563`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L557-L563)).
- `/skills`: Projedeki özel becerileri ve prompt komutlarını gösterir ([`src/repl.js:457-468`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L457-L468)).
- `# <not>`: `SYZER.md` dosyasına doğrudan kalıcı bir geliştirici notu ekler ([`src/repl.js:618-620`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L618-L620)).

### 7.5 Grup 5: Ekstra ve Harici Bağlantılar (`help_g_more`)
- `/web [port]`: Yerel web arayüzünü arka planda başlatır ve tarayıcıda açar ([`src/repl.js:503-508`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L503-L508)).
- `/budget [tokens|turns|minutes|off]`: Oturum bütçesi limitlerini anlık yönetir ([`src/cmds2.js:175-201`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds2.js#L175-L201)).

---

## 8. Güvenlik, İzinler ve Onay Diyalogları UX (`src/permissions.js`, `src/tools.js`)

SyzerCLI'ın güvenlik modeli, kullanıcının terminalini ve dosya sistemini korurken iş akışını gereksiz yere tıkamamak üzerine tasarlanmıştır.

### 8.1 Tehlikeli Komut Koruması (Hard Block)
- **Konum:** [`src/permissions.js:16-32`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/permissions.js#L16-L32)
- Hiçbir kural (`allow`) veya kullanıcı onayı ile açılamayan kesin yasaklı komut kalıpları:
  - `rm -rf /`, `rm -rf ~`, `rm -rf *`, `rm --no-preserve-root`
  - `Remove-Item -Recurse C:\` / `$env:USERPROFILE`
  - `format C:`, `mkfs`, `dd of=/dev/sd*`
  - Forkbomb (`:(){ :|:& };:`)
  - `shutdown`, `Stop-Computer`
  - `git push --force origin main/master`
- Bu komutlar tespit edildiğinde kullanıcıya dahi sorulmadan anında engellenir (`blocked_danger`).

### 8.2 Etkileşimli Onay Diyaloğu UX
- **Konum:** [`src/repl.js:221-238`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L221-L238), [`src/tools.js:460-477`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/tools.js#L460-L477)
- İzin gerektiren bir araç (`run_command`, `write_file`, `edit_file` veya MCP aracı) tetiklendiğinde:
  1. Canlı dock ve spinner duraklatılır (`s.out.pause(true)`).
  2. Eylemin türü ve özeti sarı `?` işaretiyle ekrana basılır.
  3. Değişiklik dosyadaysa renkli terminal diff önizlemesi (`preview`) gösterilir.
  4. Kullanıcıya seçenekler sunulur: `[y/n/a/r]`
     - `y` (Yes): Yalnızca bu çağrıyı onayla.
     - `n` (No): Çağrıyı reddet (modele ret hatası döner).
     - `a` (Always): Oturum boyunca bu tür değişikliklere otomatik onay ver (`session.perm = 'auto'`).
     - `r` (Rule): Önerilen kuralı (`suggestRule`: örn. `Bash(npm test:*)` veya `Edit(src/*.js)`) kalıcı olarak `.syzercli/settings.json` veya proje köküne yaz ve kaydet.
- **Paralel Ajan Onay Kuyruğu (`confirmChain`):** Birden fazla alt ajan aynı anda onay istediğinde kullanıcıyı bombardımana tutmamak için sorular bir `Promise` zincirine (`confirmChain`) bağlanarak sırayla sorulur ([`src/repl.js:220, 235-237`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L220)).

---

## 9. Geri Alma (Undo), Checkpoint ve Kurtarma UX (`src/checkpoints.js`)

SyzerCLI, ajanın kod yazarken yaptığı hataları kullanıcıya kolayca geri aldırmak için **dosya düzeyinde otomatik anlık görüntü (checkpoint)** tutar.

### 9.1 Otomatik Tur Başı Checkpoint Mekanizması
- Bir kullanıcı turunda model ilk kez `write_file` veya `edit_file` çağırmadan hemen önce, dokunulacak dosyanın o anki ham içeriği `~/.syzercli/checkpoints/<sessionId>/<turn>/` klasörüne atomik olarak yedeklenir ([`src/checkpoints.js:43-73`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/checkpoints.js#L43-L73)).
- Her oturum için son 30 tur saklanır (`MAX_KEEP = 30`).
- 5 MB'tan büyük dosyalar yedeklenmeyerek disk şişmesi engellenir (`MAX_FILE = 5MB`).
- Model dosya yazmayı bitirdiğinde dosyanın son SHA-1 hash'i kaydedilir (`wrote`).

### 9.2 `/undo` ile Geri Alma ve Dış Çakışma Koruması
- Kullanıcı `/undo` veya `/undo 2` yazdığında son n turun dosyaları geri yüklenir.
- **Harici Değişiklik Koruması (Conflict Detection):** Eğer model dosyayı yazdıktan sonra kullanıcı dosyayı IDE'sinde elle düzenlediyse veya bir git komutuyla dosya değiştiyse (`current_hash !== after_hash`), `/undo` dosyayı ezmez ([`src/checkpoints.js:108-111`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/checkpoints.js#L108-L111)). Kullanıcıya `Conflict in checkpoint #N` uyarısı verilir ve zorlamak için `/undo --force` önerilir.

---

## 10. Çoklu Dil (i18n), Erişilebilirlik (a11y) ve Terminal Uyumluluğu

### 10.1 Çoklu Dil Mimarisi (`src/i18n.js` ve Ek Dosyalar)
- SyzerCLI 8 dili resmi olarak destekler:
  `tr` (Türkçe - varsayılan), `en` (İngilizce), `de` (Almanca), `es` (İspanyolca), `ja` (Japonca), `zh` (Çince), `ko` (Korece), `pl` (Lehçe).
- **Parçalı Mimari:** Çeviri tablosu zamanla büyüdüğü için `src/i18n.js` ana dosyasının yanı sıra `i18n-new.js`, `i18n-new2.js`, `i18n-new3.js` ve `i18n-setup.js` modülleri `Object.assign` ile çalışma zamanında birleştirilmektedir ([`src/i18n.js:417-422`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/i18n.js#L417-L422)).
- **Dil Politikası:** Kod, JSON ve araç anahtarları (`read_file`, `ok`, `error`, `status`) uluslararası İngilizce standartlarında kalırken; kullanıcıya dönük arayüz metinleri, açıklamalar ve yardım ekranları seçilen dilde görüntülenir. Eksik çevirilerde İngilizceye güvenli geri dönüş (fallback) yapılır.

### 10.2 Terminal Uyumluluğu ve Renk Standartları
- **ANSI & Renk Desteği (`src/ui.js:3`):** `process.env.NO_COLOR` varsa tüm renk kodları kapatılır; `FORCE_COLOR` veya TTY varsa ANSI renkleri (`C.bold, C.cyan, C.green, C.yellow, C.red, C.orange`) aktifleşir.
- **Karakter Genişliği Hesabı (`charWidth` / `vlen`):** CJK dilleri (Çince, Japonca, Korece) ve emojiler terminalde 2 hücre genişlik kaplar ([`src/ui.js:16-24`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/ui.js#L16-L24)). `vlen` fonksiyonu bu karakterleri doğru hesaplayarak metin kırpmalarını (`fit`, `pad`) bozulmadan yapar.
- **Windows Terminal ve ConPTY:** Windows üzerinde terminal boyutu değişiklikleri (`resize`) bazen güvenilir gelmediği için `setInterval` ile 250ms'de bir `getWindowSize()` canlı sorgulanarak ekran güncellenir ([`src/repl.js:331`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L331)).

---

## 11. Kullanıcı Deneyimi Boşlukları ve Sürtünmeler (UX Friction Points)

Kod tabanı ve çalışma zamanı akışı derinlemesine incelendiğinde, C1 (Spec) ve C2 (Uygulama) aşamalarında çözülmesi gereken **10 somut UX sürtünme noktası** tespit edilmiştir:

### 11.1 Sürtünme 1: Komut Argümanlarında Tab Tamamlama Eksikliği
- **Mevcut Durum:** [`src/input.js:210-214`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L210-L214) Tab tamamlama fonksiyonu yalnızca boşluk içermeyen `/komut` adlarını tamamlamaktadır (`if (text.includes(' ')) return []`).
- **Sorun:** Kullanıcı `/model ` yazdığında model listesini, `/provider ` yazdığında sağlayıcıları, `/lang ` yazdığında dil kodlarını veya dosya yollarını Tab ile tamamlayamamaktadır. Kullanıcı her seferinde tam model ID'sini elle kopyalayıp yapıştırmak zorunda kalmaktadır.
- **Öneri (C1):** Argüman düzeyinde bağlamsal tamamlama (`completeArgs`) eklenmeli; `/model [Tab]` mevcut modelleri, `/lang [Tab]` dilleri dökmelidir.

### 11.2 Sürtünme 2: Çok Satırlı Giriş Keşfedilebilirliği ve Windows Kısayol Farklılıkları
- **Mevcut Durum:** Giriş kutusunda `Shift+Enter`, `Alt+Enter` veya `\ + Enter` ile alt satıra geçilebilmektedir ([`src/input.js:387-388`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/input.js#L387-L388)).
- **Sorun:** Windows CMD ve bazı eski PowerShell sürümlerinde ConPTY, `Shift+Enter` kaçış kodunu (`\x1b[13;2u`) yutmakta ve doğrudan Enter olarak göndermektedir; kullanıcı görevi tamamlamadan mesaj yanlışlıkla gitmektedir. Ayrıca arayüzde bu kısayol açıkça belirtilmemektedir (placeholder'da yalnızca `/help` yazar).
- **Öneri (C1):** Giriş ipucuna `(Shift+Enter for newline)` göstergesi eklenmeli; Windows için `\` ile bitirip Enter'a basma davranışı daha belirgin görselleştirilmelidir.

### 11.3 Sürtünme 3: Sabit Ekranda Metin Seçme / Kopyalama Güçlüğü
- **Mevcut Durum:** Alternatif ekran ve fare yakalama modu (`?1000h / ?1006h`) aktiftir.
- **Sorun:** Fare tıklama olayları SyzerCLI tarafından yakalandığı için, kullanıcı çıktı alanındaki bir kod bloğunu veya dosya yolunu fareyle seçip panoya (clipboard) kopyalamak istediğinde terminalin yerel metin seçimi engellenebilmektedir (kullanıcının `Shift` tuşuna basılı tutarak seçmesi gerekmektedir, ancak bu bilinmemektedir).
- **Öneri (C1):** Kod bloklarına veya araç çıktılarına hızlı kopyalama kısayolu sağlanmalı ya da Shift-select ipucu yardım ekranında vurgulanmalıdır.

### 11.4 Sürtünme 4: Model Seçimi ve Yüzlerce Modelin Konsola Dökülmesi
- **Mevcut Durum:** `/models` yazıldığında konsola yüzlerce model birden yazdırılmaktadır ([`src/cmds.js:218-227`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/cmds.js#L218-L227)).
- **Sorun:** Ekran çok hızlı kaymakta, kullanıcının en son gördüğü modeller kaybolmaktadır. Tıklanabilir modal (`Editor#pick`) ise yalnızca sınırlı sayıda ücretsiz modeli sunmaktadır.
- **Öneri (C1):** Modeller kategorize edilmeli (En İyiler, Ücretsizler, Hızlılar, Düşünme Modelleri) ve etkileşimli sayfalanabilir/filtrelenebilir bir arayüzle sunulmalıdır.

### 11.5 Sürtünme 5: "Always" İzni Sonrası Geri Dönüşün Görünmezliği
- **Mevcut Durum:** Onay sorusunda kullanıcı `a` (always) seçtiğinde `session.perm = 'auto'` olmakta ve artık soru sorulmamaktadır.
- **Sorun:** Kullanıcı bu izni tek bir komut için "bu komuta hep izin ver" zannederek vermekte, ancak SyzerCLI tüm oturumu `auto` moduna almaktadır. Oturumun `auto` olduğunu fark etmeyen kullanıcı istemeden riskli komutların onaylanmasına sebep olabilmektedir.
- **Öneri (C1):** `a` seçildiğinde açıkça `Oturum 'auto' moduna alındı. Geri almak için: /perm ask` uyarısı belirgin bir şekilde basılmalıdır.

### 11.6 Sürtünme 6: Küçük Terminallerde Panel Bilgi Yoğunluğunun Düşmesi
- **Mevcut Durum:** Satır sayısı <28 olduğunda ajan paneli (`panelMode`) kapanmakta ve kompakt ağaç moduna dönmektedir ([`src/dock.js:63, 417`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/dock.js#L63)).
- **Sorun:** 24 satırlık standart terminal kullanan geliştiriciler zengin kart görünümünü ve detaylı ajan ilerleme durumunu hiç görememektedir.
- **Öneri (C1):** 20-27 satır aralığı için 2 satırlık yatay kart mini-panel tasarımı geliştirilmelidir.

### 11.7 Sürtünme 7: i18n Dosya Dağınıklığı ve Karmaşık Dil Durumları
- **Mevcut Durum:** Çeviri dizgeleri `i18n.js`, `i18n-new.js`, `i18n-new2.js`, `i18n-new3.js`, `i18n-setup.js` olmak üzere 5 ayrı dosyaya dağılmıştır.
- **Sorun:** Yeni bir komut veya hata mesajı eklendiğinde hangi dosyaya yazılacağı belirsizdir; bazı Türkçe sistem mesajları ile İngilizce araç dönüşleri aynı anda ekranda dilde çorba (language mix) hissi yaratmaktadır.
- **Öneri (C1):** i18n tabloları Alan A'daki `prompts.js` refaktörüne benzer şekilde tek bir modüler yapı altında konsolide edilmelidir.

### 11.8 Sürtünme 8: Rate Limit ve Kota Tükendiğinde Rehberlik Eksikliği
- **Mevcut Durum:** OpenRouter veya NVIDIA günlük istek sınırına ulaşıldığında `low_keys` veya `key_exhausted` uyarısı basılmaktadır.
- **Sorun:** Kullanıcıya o an ne yapması gerektiği (örn: `/provider nvidia` ile diğer sağlayıcıya geç, `/keys add` ile yeni anahtar ekle veya bekle) aksiyon odaklı bir "quick action" önerisi olarak sunulmamaktadır.
- **Öneri (C1):** Kota bittiğinde kullanıcıya doğrudan çalıştırabileceği bir öneri butonu/kısayolu (`Öneri: /provider nvidia ya da /keys add`) sunulmalıdır.

### 11.9 Sürtünme 9: Eski Oturumlarda Arama / Filtreleme Olmaması
- **Mevcut Durum:** `/resume` komutu yalnızca son 9 oturumu tarihe göre listelemektedir ([`src/repl.js:542-544`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-C0/src/repl.js#L542-L544)).
- **Sorun:** Birkaç gün önce çalışılmış bir görevi başlığına veya içeriğine göre aramak mümkün değildir.
- **Öneri (C1):** `/resume <arama_metni>` desteği ve `Editor#pick` tabanlı canlı filtrelenebilir oturum listesi eklenmelidir.

### 11.10 Sürtünme 10: Web UI ve Terminal CLI Arasındaki Durum Kopukluğu
- **Mevcut Durum:** Terminalde çalışırken `/web` dendiğinde yerel sunucu açılmakta ve tarayıcı başlatılmaktadır.
- **Sorun:** Web arayüzü ile terminal REPL oturumları bağımsız `session` nesneleri kullanmaktadır. Terminaldeki aktif oturum web arayüzünde canlı izlenememekte; iki taraflı durum senkronizasyonu tam sağlanamamaktadır.
- **Öneri (C1):** Web UI ile terminal oturumunun aynı `sessionId` üzerinden senkronize izlenebilmesi (live mirror) hedeflenmelidir.

---

## 12. Sonuç ve C1 (Tasarım & Spec) İçin Yol Haritası

C0 keşfi sonucunda elde edilen veriler, SyzerCLI'ın terminal UX altyapısının son derece sağlam (sabit ekran, DECSTBM bölgeleme, canlı Zip maskotu, dock, çift yönlü kuyruk, SGR fare takibi, checkpoint geri alma) olduğunu; ancak **keşfedilebilirlik, bağlamsal tamamlama, küçük ekran adaptasyonu ve hata anı rehberliği** konularında önemli iyileştirme alanları bulunduğunu göstermektedir.

### C1 Spec Kartı İçin Öncelikli Tasarım Alanları:
1. **Etkileşimli Girdi ve Tamamlama:** Argüman düzeyinde Tab tamamlama (`/model [Tab]`, `/lang [Tab]`, `@dosya [Tab]`).
2. **Klavye & Fare UX İyileştirmeleri:** Windows ConPTY Shift+Enter güvencesi, kopyalama kolaylaştırıcıları, klavye ile dock odak yönetimi.
3. **Küçük Ekran Mini-Panel:** Düşük çözünürlüklü terminaller için kompakt 2 satırlık kart ızgarası.
4. **Akıllı Kurtarma ve Kota Rehberliği:** API/kota tükenmelerinde anında sağlayıcı değiştirme veya anahtar ekleme eylem önerileri.
5. **Oturum Yönetimi Modernizasyonu:** `/resume` için interaktif arama/filtreleme seçicisi.

Bu envanter raporu, **Alan C (Kullanım / UX)** için C1 tasarım spec'ine zemin hazırlamak üzere Koordinatör'ün incelemesine ve onayına hazırdır.
