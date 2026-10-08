# SyzerCLI

**Türkçe** · [English](README.en.md)

> **TR:** OpenRouter ve NVIDIA modelleriyle çalışan, dosya okuyup yazabilen, komut çalıştırabilen terminal yapay zekâ ajanı.
> **EN:** A terminal AI coding agent for OpenRouter and NVIDIA models: reads and edits files, runs commands, spawns parallel subagents.

## Nedir? / What is it?

SyzerCLI, terminalde (ve isteğe bağlı yerel web arayüzünde) çalışan bir kodlama ajanıdır. Bir görev verirsin; ajan projeni okur, dosyaları düzenler, komut çalıştırır, gerekirse paralel alt ajanlar başlatır ve sonucu raporlar. Ücretsiz modellerle (ör. `nvidia/nemotron-3-ultra-550b-a55b:free`) rahatça kullanılabilsin diye **çoklu API key havuzu** ve **otomatik yedekleme** üzerine kuruludur.

**Neden kullanılır?**
- **Key havuzu:** Birden çok OpenRouter/NVIDIA key'i ekle; biri limite takılınca (402/403/429) otomatik sıradakine geçer.
- **Otomatik yedek model:** Sunucu yoğunluğunda (5xx) önce aynı key'le yeniden dener, sonra yedek modele geçer.
- **Güvenli ajan:** Her araç çağrısı için izin modu (`ask` / `auto` / `readonly`), allow/deny kuralları, hook'lar, git checkpoint ve `/undo`.
- **Alt ajanlar:** `spawn_agent` ile bağımsız işler paralel yürür; canlı satırlarla izlenir.
- **Entegrasyonlar:** MCP istemcisi/sunucusu, OpenAI uyumlu yerel proxy, [Orca](https://github.com/stablyai/orca) entegrasyonu.

**Gereksinimler:** Node.js 18+ (exe kullanıyorsan gerekmez), en az bir OpenRouter (`sk-or-v1-…`) veya NVIDIA (`nvapi-…`) API key'i.

## 60 saniyede başla

```powershell
irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1 | iex   # kur
syzer                                   # ilk açılışta sihirbaz: dil, sağlayıcı, key, izin modu
```

```
syzer key add sk-or-v1-... nvapi-...    # key'ler (sağlayıcı biçimden tanınır)
syzer usage                             # key başına kalan hak
syzer                                   # etkileşimli sohbet
syzer -y "src/ altındaki TODO'ları listele"   # tek seferlik, onay istemeden (betikler için)
syzer --resume <id>                     # kayıtlı oturuma devam (veya: syzer -c)
syzer web                               # yerel web arayüzü
syzer doctor                            # kurulum, key, ağ ve Orca yaması denetimi
syzer export last --out sohbet.md         # oturumu Markdown olarak kaydet
```

Sohbette `/help` tüm komutları gösterir; `/plan` önce salt-okunur plan çıkarır, `/go` ile uygulatırsın.

## Hızlı kurulum

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1 | iex
```

**macOS / Linux:** `curl -fsSL https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.sh | sh`

**Her platform (Node 18+):** `npm install -g github:yasinbalcik/SyzerCLI` → `syzer`

**Kurulum exe'si:** [Releases](https://github.com/yasinbalcik/SyzerCLI/releases/latest) sayfasından `SyzerCLI-Setup.exe` indir ve çalıştır: kendini `%LOCALAPPDATA%ProgramsSyzerCLI` altına kurar, `syzer` komutunu PATH'e ekler, Başlat menüsü kısayolu oluşturur (Node.js gerekmez). Sonra yeni bir terminalde `syzer` yaz.

**exe:** aynı sayfadan tek başına `syzer.exe` de indirebilirsin; her açılışta kendini günceller. Aynı sayfadaki `SHA256SUMS.txt` ile doğrulayabilirsin. Exe imzasız olduğundan Windows SmartScreen ilk açılışta uyarabilir ("Daha fazla bilgi" → "Yine de çalıştır").

**Güncelleme:** npm/terminal kurulumu da exe gibi her açılışta (saatte en fazla bir kez) GitHub'daki son sürüme bakar; yeni sürüm varsa `npm install -g` ile kendini günceller ve komutu yeni sürümle yeniden başlatır. Atlamak: `--no-update` / `SYZER_NO_UPDATE=1`. Git klonu (geliştirme) kendini güncellemez.

**Orca entegrasyonu:** Orca'yı kapat → `syzer orca install --shortcut` → masaüstündeki **Orca (Syzer)** kısayolundan aç. Orca zaten kuruluysa `install.ps1` bunu otomatik yapar.

Kaynaktan: depoyu klonla, klasörde `npm link`.

## Kurulum, exe ve otomatik güncelleme

- İlk açılışta kurulum sihirbazı çalışır (dil, kısa eğitim, sağlayıcı, key'ler, izin modu); yeniden: `syzer setup`.
- Sürümler GitHub reposunda (`yasinbalcik/SyzerCLI`) yayınlanır. `dist/syzer.exe` bir launcher'dır: her açılışta (1 saat önbellekli) son sürümü kontrol eder, varsa indirip `~/.syzercli/app/<sürüm>` altına kurar ve öyle açar. Atlamak: `--no-update` / `SYZER_NO_UPDATE=1`.
- Repo herkese açıktır, token gerekmez (özel bir çatal için: `GITHUB_TOKEN`, `~/.syzercli/github-token` veya `gh auth login`).
- Yeni sürüm yayınlama: `package.json` sürümünü artır → `npm run build:exe` → `gh release create vX.Y.Z dist/syzercli-X.Y.Z.tar.gz dist/syzer.exe`.
- `syzer usage --summary --json` sağlayıcı başına kalan hak yüzdesini verir (Orca entegrasyonu: `SyzerCLI-Orca`).

## Orca entegrasyonu (Windows)

Orca eklentisi **ayrı bir projedir**: [SyzerCLI-Orca](https://github.com/yasinbalcik/SyzerCLI-Orca) (kendi sürümleri, testleri ve belgeleri orada). CLI'daki `syzer orca` komutu eklentiyi o repodaki son sürümden indirir ve çalıştırır; ayrıca bir şey kurman gerekmez.

```
syzer orca install --shortcut   # Orca kapalıyken bir kez: eklentiyi indirir, kurar, masaüstü kısayolu oluşturur
syzer orca status | patch | restore | uninstall | skip | config | update
```

Eklenti Orca'da Syzer'ı birinci sınıf bir ajan yapar: ajan menüsü, canlı durum ve alt ajan listesi, oturum geçmişi (Resume), kullanım göstergesi, key yöneticisi, yeniden açılışta sekme geri yükleme ve Orca kapanırken açık terminallerin kapatılması. Ayrıntılar, komut tablosu ve sınırlamalar için eklenti reposunun README'sine bak. CLI tarafında kalan parçalar: Orca'ya durum bildiren hook'lar, `spawn_syzer` işçileri, `usage --summary --json` ve `key --json`.


## Giriş her zaman açık

Ajan çalışırken terminalin altında sabit bir alan kalır: durum satırı, çalışan alt ajanların canlı satırları (görev, son araç, adım, süre), sıradaki mesajlar ve giriş satırı. Çalışırken yeni mesaj yazıp Enter'a basarsan sıraya girer ve tur bitince çalışır; Ctrl+C yazılan metni siler, boşsa yanıtı durdurur. Alt ajanlar çalışırken girişin altında `main` + ajan listesi görünür (ad, görev, süre, token); giriş boşken **↓ / ←** ile listeye geç, **↑↓** ile seç, **Enter** ile ajanın canlı içeriğini (görev, her araç çağrısı ve sonucu, canlı çıktı, rapor) tam ekran aç, **Esc / ←** ile dön. Tur sürerken `/run <no>` de hemen çalışır. `/tree` ajan haritasını (canlı alt ajan ağacı ve olay günlüğü) gösterir. Canlı ajan paneli ana modeli ve her alt ajanın modelini, durumunu, o an yaptığı işi, adım sayısını, token'ını ve süresini kartlar halinde gösterir (canlı panel için en az 28 satır × 70 sütun gerekir; daha küçük terminallerde kompakt ajan satırlarına dönülür). Tur bitince (Ctrl+C dahil) sohbete kalıcı bir bitiş raporu yazılır: ⚠ yarıda kalan, ✖ başarısız, ◌ iptal edilen ajanlar işaretlenir. Kapatmak için `SYZER_NO_DOCK=1`.

## Alt ajanlar ve Orca işçileri

- `spawn_agent`: ana oturumun içinde çalışan alt ajanlar (paralel). Çalışırken her ajan canlı bir satırda görünür (görev, son araç çağrısı, adım sayısı, süre). Ayrıntıları görmek için sohbette `/runs` (liste) ve `/run <no>` (görev, her araç çağrısı ve sonucu, rapor); web arayüzünde alt ajan kartına tıklayınca açılır.
- `spawn_syzer` (yalnızca Orca içinde): her görev **ayrı bir Orca terminalinde çalışan bağımsız bir Syzer** olur; sekmesinden canlı izlenebilir, sonuç ana ajana rapor olarak döner. Tek seferlik kullanım: `syzer -y --prompt-file görev.txt --out sonuc.txt`.

## Dayanıklılık

- Sunucu yoğunluğu (5xx) ya da geçici ağ hatasında aynı key'le 2 kez denenir, sonra **otomatik olarak yedek modele** geçilir (`/fallback`). Yoğun model 5 dakika atlanır (süreçler arasında paylaşılır), sonraki turlar doğrudan sağlam modelle başlar.
- Orca işçileri farklı key'lerle başlar, ana oturumun izin modunu devralır (tam otomat değilse salt okunur), başarısız olursa bir kez yeniden denenir ve hata ana ajana açıkça bildirilir. `SYZER_WORKER_CLOSE=1`: bitince sekme kapanır.
- Alt ajanlar raporu ana oturumun dilinde yazar.

## Web arayüzü

`syzer web [--port 8788] [--no-open]` veya sohbette `/web`: Orca benzeri üç bölme. Sol: beceriler/komutlar/ajanlar (tıkla veya `/` ile), model-efor-izin-dil ayarı, key'ler ve kullanım yüzdesi. Orta: sohbet (akış, araç çağrıları, onay butonları). Sağ: çalışma alanları (klasör, git dalı) ve o klasörün kayıtlı oturumları (devam et).
Yalnızca `127.0.0.1`'e bağlanır; ajan komut çalıştırabildiği için adres rastgele bir erişim token'ı içerir (çerezle korunur, Host/Origin denetlenir).

## Sağlayıcılar

| | OpenRouter | NVIDIA (build.nvidia.com) |
|---|---|---|
| Key biçimi | `sk-or-v1-` + 64 hex | `nvapi-` + 64 karakter |
| Varsayılan model | `nvidia/nemotron-3-ultra-550b-a55b:free` | `nvidia/nemotron-3-ultra-550b-a55b` |
| Kalan kota | `usage` günlük free istek + kredi gösterir | API vermez → yerel sayaç, `usage --check` canlı doğrular (~40 istek/dk sınırı) |
| Model listesi | free modeller canlı çekilir | `models --check` hesabında çalışanları bulur (listedekilerin çoğu hesaba göre 404 verir) |

- **Ayrı key dosyaları:** `~/.syzercli/keys.openrouter.json` ve `~/.syzercli/keys.nvidia.json`. `config.json` içinde key tutulmaz.
- Her sağlayıcının kendi **modeli, effort'u, yedek modelleri ve subagent modeli** vardır.
- `syzer key add <key>...` sağlayıcıyı key'in biçiminden otomatik tanır; karışık liste verebilirsin.
- **Geçiş:** `syzer provider nvidia` / sohbette `/provider nvidia` (sohbet geçmişi korunur). Tek seferlik: `syzer --provider nvidia "soru"`.

## Hızlı başlangıç

```
syzer key add sk-or-v1-... nvapi-...      # toplu ekleme (format + tekrar + canlı doğrulama)
syzer provider nvidia                     # sağlayıcı değiştir
syzer usage                               # key durumu
syzer                                     # etkileşimli sohbet
syzer -y "görev"                          # tek seferlik (betikler / orkestrasyon için)
```

## Key havuzu

- Aktif key'e yapışık kalır; yalnızca limiti dolunca (402/403/429) ya da geçersizse sıradakine geçer.
- Sunucu yoğunluğunda (5xx) aynı key'le bekleyip yeniden dener, sonra **yedek modele** geçer (`/fallback`).
- `key use <n>` ile elle değiştirilir. Paralel alt ajanlar işleri kullanılabilir key'lere dağıtır.
- Mevcut/bozuk key'ler "eklenemedi" diye bildirilir, geçerli olanlar eklenir.

## Sohbet içi komutlar

| Komut | Açıklama |
|---|---|
| `/provider` | sağlayıcıyı göster / değiştir |
| `/model` `/models` | varsayılan modeli göster/seç |
| `/effort` | düşünme eforu: auto off low medium high xhigh |
| `/usage` `/stats` | key durumu · günlük istek/token istatistiği |
| `/keys [add\|use]` | key listesi · toplu ekleme · key değiştirme |
| `/plan` `/go` | önce salt-okunur plan, onaydan sonra uygula |
| `/agents` `/subagent` | subagent listesi · model/effort/paralellik ayarı |
| `/rules` `/allow` `/deny` | izin kuralları (projeye kaydedilir) |
| `/mcp` | MCP sunucuları ve araçları |
| `/compact` | sohbeti özetle (bağlam %75'i aşınca otomatik) |
| `/diff` `/commit` `/review` | git yardımcıları (commit mesajını model yazar) |
| `/checkpoints` `/restore` | her turun ilk değişikliğinden önce alınan git anlık görüntüsü |
| `/undo` | ajanın son dosya değişikliğini geri al |
| `/resume` `-c` | kayıtlı oturuma devam |
| `/todos` `/tasks` | ajanın görev listesi · arka plan işlemleri |
| `/init` · `# not` | SYZER.md üret · ona not ekle |
| `/lang` | tr en de es ja zh ko pl |

Yapıştırılan uzun metin `[Pasted text #1 +N lines]`, görsel dosya yolu `[Image #1]` olarak görünür; `@dosya` içeriği ekler.

## Ajan araçları

`read_file` `write_file` `edit_file` (çoklu + boşluk toleranslı) `list_dir` `find_files` `search_files` `run_command`
`run_background` `bg_output` `bg_stop` `web_fetch` `web_search` `todo_write` `use_skill` `spawn_agent` + MCP araçları.

## Dosyalar ve ayarlar

- Kullanıcı verisi: `~/.syzercli/` (eski `~/.openrouter-cli` ilk çalıştırmada otomatik taşınır).
- Proje talimatları: `SYZER.md`, `OPENROUTER.md`, `CLAUDE.md`, `AGENTS.md`; skill/komut/agent: `.syzer/` (+ `.openrouter/`, `.claude/`).
- Ayar dosyaları (tam yetkili): `~/.syzercli/settings.json`, `.syzer/settings.json`, `.syzer/settings.local.json`.
  Claude Code ayarlarından yalnızca **deny** kuralları okunur (allow ve hook'lar bilerek okunmaz).

```json
{
  "permissions": { "allow": ["Bash(git status:*)", "Edit(src/**)"], "deny": ["Read(.env)", "Bash(curl:*)"] },
  "hooks": {
    "PreToolUse":  [{ "matcher": "Bash",       "hooks": [{ "type": "command", "command": "..." }] }],
    "PostToolUse": [{ "matcher": "Write|Edit", "command": "npm run format" }]
  }
}
```

- Hook stdin'inden JSON alır; `PreToolUse` çıkış kodu **2** ise araç engellenir (stderr modele gider).
- Yıkıcı komutlar (`rm -rf /`, `format C:`, `Remove-Item -Recurse C:\` …) hiçbir kuralla açılamaz.
- Onay isteminde `a` = bu oturum, `r` = kalıcı kural kaydet. Auto modda bile proje dışına yazma onay ister.

## MCP

İstemci: `.mcp.json` veya `.syzer/mcp.json` (`{"mcpServers":{"ad":{"command":"npx","args":[...]}}}`), yalnızca stdio.
Sunucu: `syzer mcp serve` → Claude/başka istemciler `ask`, `agent`, `usage` araçlarını kullanır (aktif sağlayıcıyla).

## Yerel proxy

```
syzer serve --port 8787 --token gizli [--provider nvidia]
OPENAI_BASE_URL=http://127.0.0.1:8787/v1  OPENAI_API_KEY=gizli   (model: "default")
```

OpenAI uyumlu `/v1/chat/completions` (stream dahil), `/v1/models`, `/usage`, `/health`. Seçili sağlayıcının key havuzu,
key değiştirme, yedek model ve effort ayarı proxy'nin arkasında çalışır.

## Alt ajanlar

`spawn_agent` ile bağımsız işler paralel yürür. Yerleşik: `explore`, `plan` (salt okunur), `general`.
Özel: `.claude/agents/*.md` veya `.syzer/agents/*.md` (`name`, `description`, `tools`, `model`).
Model önceliği: ajan dosyası → `/subagent model` → ana model. Dışarıdan: `syzer -a explore -y "görev"`.
