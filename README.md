# SyzerCLI

OpenRouter **ve** NVIDIA için, çoklu API key havuzu, otomatik key/model yedekleme, ajan araçları, subagent'lar, MCP ve
yerel proxy sunan terminal ajanı. Komut: `syzer` (aynı zamanda `syzercli`).

Kurulum: bu klasörde `npm link` → `syzer`

## Kurulum, exe ve otomatik güncelleme

- İlk açılışta kurulum sihirbazı çalışır (dil, kısa eğitim, sağlayıcı, key'ler, izin modu); yeniden: `syzer setup`.
- Sürümler özel GitHub reposunda (`yasinbalcik/SyzerCLI`) yayınlanır. `dist/syzer.exe` bir launcher'dır: her açılışta (1 saat önbellekli) son sürümü kontrol eder, varsa indirip `~/.syzercli/app/<sürüm>` altına kurar ve öyle açar. Atlamak: `--no-update` / `SYZER_NO_UPDATE=1`.
- Repo özel olduğundan token gerekir: `GITHUB_TOKEN`, `~/.syzercli/github-token` veya `gh auth login`.
- Yeni sürüm yayınlama: `package.json` sürümünü artır → `npm run build:exe` → `gh release create vX.Y.Z dist/syzercli-X.Y.Z.tar.gz dist/syzer.exe`.
- `syzer usage --summary --json` sağlayıcı başına kalan hak yüzdesini verir (Orca entegrasyonu: `SyzerCLI-Orca`).

## Orca entegrasyonu (Windows)

`syzer orca install [--shortcut]` — bir kez çalıştır, gerisi otomatik:
- Orca'nın Usage panelinde/durum çubuğunda **Syzer** (sağlayıcı başına yüzde, key sayısı, kalan hak), "yeni terminal" ajan menüsünde Syzer, kenar çubuğunda çalışıyor/bitti göstergesi, oturum geçmişinde `[Syzer]` oturumları (devam et = `syzer --resume`).
- Yama Orca'nın `app.asar` dosyasına uygulanır; yedek `app.asar.syzer-orig` olarak kalır (`syzer orca restore` geri alır, `syzer orca uninstall` otomatik bakımı kaldırır).
- Orca kendini güncelleyip yamayı silerse, zamanlanmış görev (10 dk'da bir + oturum açılışında) Orca **kapalıyken** yamayı yeniden uygular. `--shortcut` masaüstüne "Orca (Syzer)" kısayolu da koyar: açmadan önce yamayı denetler.
- Syzer güncellenince yama kodu da güncellenir (yama sürümü işaretlidir). Orca beklenmedik biçimde değişirse yama atlanır, Orca bozulmaz (`syzer orca status`, günlük: `~/.syzercli/orca/patch.log`).

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
