# HANDOFF: SyzerCLI iyileştirme orkestrası (devralan Claude için)

Yazan: önceki koordinatör Claude oturumu (context dolmasın diye devir) · 2026-10-13
Konuşma dili: **Türkçe**. Kullanıcı: Yasin. Repo: `C:\Users\ROOT\Desktop\SyzerCLI` (Orca repo id `eb33e173-5db6-46b5-ba0a-bdb687452382`). Plan/durum: `PLAN.md`, `STATE.md` (aynı klasör).

## Yasin'in kuralları (bağlayıcı)
- Commit/PR'a **Co-Authored-By veya Claude atfı ekleme**.
- **Push yok**, uzak depoya hiçbir şey gönderme. Merge'ler yerel `main`'e, testler yeşilse yapılır (Yasin "tamamını yaptır ve bitir" dedi, B2/C1/D1 için merge yetkisi var).
- Terminal arayüzünü görsel olarak Yasin kendisi test eder: sen yalnızca birim testi yaz, Orca UI testi yapma. Chrome/Edge BAŞLATMA (Chrome çökme penceresi yaşandı); web QA gerekirse yalnız Edge headless.
- Kendi (Claude) token'ını ucuz tut: iş yaptırmak için worker kullan, uzun dosya okuma yerine makbuz/grep. claude.ai haftalık kota %94 doluydu.
- Worker raporuna körü körüne güvenme: kendin `npm test` çalıştır, kapsam→test eşleşmesini ve diff'te yazma seti dışı dosya olup olmadığını doğrula (B1r2 raporu "kusursuz" dedi, ben deneyle doğruladım).
- Sonunda Yasin'e **Türkçe, tam rapor** ver: baştan beri ne yapıldı (aşağıdaki tarihçe), neler birleşti, test sayıları, bulunan hatalar, kapsam dışı kalanlar, kullanıcının yapacakları.

## Kota/model durumu
- **Codex limiti doldu** (kullanıcı bildirdi). Codex worker açma; açık Codex terminalleri bitmiş olabilir.
- **Antigravity (agy)** ayrı kotaya sahip: `claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gpt-oss-120b-medium`, `gemini-3.8-flash-*`. Gemini 3.1 Pro YOK. `agy --model claude-sonnet-4-6 -p "..."` çalışıyor (model teyit edildi). Yeni worker için: `orca terminal create --worktree "id:<repoId>::<path>" --title X --command "agy --model claude-sonnet-4-6 --dangerously-skip-permissions -i (Get-Content -Raw '<promptfile>')"` ve ilk açılışta "Yes, I trust this folder" onayını `orca terminal send --terminal <handle> --enter` ile ver.
- Codex'te kullanılabilir modeller: gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna (astra/sol DESTEKLENMİYOR). `~/.codex/config.toml`: approval_policy=never, sandbox_mode=danger-full-access (yedek `.bak-2026-10-13`).

## Orca/araç el kitabı (öğrendiklerim)
- Worktree: `orca worktree create --repo id:$REPO --name X --no-parent --base-branch <branch> --json` (id çıktısı `<repoId>::<path>`). Terminal: `orca terminal create --worktree "id:<tam id>" --title X --command "..." --json`. Terminal oku: `orca terminal read --terminal <handle> --json`.
- Shell durumu çağrılar arasında SÜRMEZ: prompt'ları dosyaya yaz (`.../scratchpad/*.txt`) ve `(Get-Content -Raw 'yol')` ile argüman ver. Heredoc içinde ters eğik çizgiyi dikkatli kullan.
- TUI hazır değilken `terminal send` prompt'u kaybeder; `terminal wait --for tui-idle` `satisfied:true` dönmeden gönderme. Komut satırıyla prompt argümanı vermek daha güvenilir.
- Foreground `sleep` engelli; bekleme için `run_in_background` ile until-döngülü script kullan (örnek: `/tmp/wait3.sh`, worktree'de commit sayısı + temiz ağaç + 90 sn yaşa bakar).
- Worker'lar kendi worktree'lerine commit eder. Çalışma ağacında Yasin'in `M .gitignore` ve `?? .ignore` kalıntıları var: bunlara DOKUNMA, commit'e katma.
- `package.json` test listesi her dalda değişir; merge çakışması bekle ve iki listeyi birleştir (önceki çözüm: node ile `<<<<<<<`..`>>>>>>>` bloğundan test dosyalarını birleştirip CRLF'e dikkat ederek yaz).
- node:test akışında proxy banner'ı flake yaptı; `test/server-security.test.js` `console.log`'u susturuyor (`12d95ab`).

## Tarihçe (rapora girecek)
1. **Keşif:** A0 (prompt/çıktı envanteri, Antigravity), E0 (web arayüzü envanteri).
2. **A1/E1 spec** (Codex gpt-6-luna) → Yasin onayı → **A2** prompt mimarisi (`src/prompts.js`, `src/limits.js`, çağrı noktaları; Claude Sonnet) + **A3** golden testler (Antigravity) → 7 test düşünce A2'de uzlaştırıldı → **A4** review (Codex terra; 3 major, 3 minor) → **A5** düzeltme.
3. **E2** web arayüzü "Odak" tasarımı (Codex luna) → **E4** review (Antigravity; 4 blocker, 3 major) → **E5** düzeltme (kontrast ≥4.5:1 testi, odak tuzağı, diff, klavye).
4. `main`'e merge: A5+E5 (`b7a33f3`), npm test 266/266.
5. **E3** görsel QA (Edge headless, 12 kombinasyon): `src/web-ui.js` Türkçe `removeKey:'Key'i kaldır'` tırnak hatası TÜM sayfa JS'ini düşürüyordu (E2/E5 review'leri kaçırmıştı); düzeltildi + script-ayrıştırma testi (`43a00d2`), 267/267.
6. **B0/C0/D0 keşifleri** (altyapı, UX, Orca). Yasin önce B1'i seçti.
7. **B1** veri bütünlüğü + güvenlik: spec (Codex terra) → B1i uygulama (atomic-json, realpath isOutside, proxy Host/CORS/token) → B1r review (Gemini Flash; 1 blocker preflight token sırası, 2 major, 4 minor; MINOR-4 kopuk symlink'i ben major'a yükselttim) → B1f düzeltme → B1r2 ikinci review (güvenilmedi; ben Host/junction/isOutside deneylerini kendim koştum). `main`'e merge: `6485636`; flake düzeltmesi `12d95ab`. Test 284/284.
8. **B2/C1/D1** (Codex terra, spec+uygulama tek kartta; Yasin tüm kararları devretti): üçü de 2'şer commit ile bitti (spec + uygulama). Worktree/dallar aşağıda.
9. Kullanıcı Codex hesabında astra/sol olmadığını ve Antigravity'de Claude modeli kotasının ayrı olduğunu öğrendi; hafıza notu yazıldı.

## Şu anki durum: B2/C1/D1 hazır, DOĞRULANMADI, MERGE EDİLMEDİ
| Kart | Worktree | Dal | Son commit |
|---|---|---|---|
| B2 Windows süreç dayanıklılığı | `C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-B2` | `yasinbalcik/syzer-B2` | feat: harden shell and process lifecycle |
| C1 terminal UX (tamamlama, kota rehberliği, /resume arama, README) | `.../syzer-C1` | `yasinbalcik/syzer-C1` | feat: improve terminal completion quota guidance and resume ... |
| D1 Orca dayanıklılığı | `.../syzer-D1` | `yasinbalcik/syzer-D1` | feat: harden Orca worker and hook resilience |

Kapsamlar ve bilerek dışarıda bırakılanlar için her dalın `docs/superpowers/specs/2026-10-13-{b2,c1,d1}-*.md` ve `docs/syzer-iyilestirme/*-NOTLAR.md` dosyalarına bak. Bilerek dışarıda: orkestra aynı-dalga dosya çakışması denetimi (B2), shell (`run_command`) ile çalışma alanı dışına yazma koruması (B1/B2 dışı, Yasin'e not), küçük ekran paneli/dock/Shift+Enter (C1), asar yama motoru yeniden yazımı (D1).

## Yapılacaklar (sırayla)
1. Her dalda: `git -C <wt> diff --stat main..HEAD`, `npm test` (--no-update gerekmez), makbuz yerine KOD'a bak: yazma seti dışı dosya var mı, `ERR_` sözleşmesi/limits/atomic-json/B1 davranışları bozulmuş mu.
2. Her dal için **review** (Claude ailesi, Antigravity): `claude-opus-4-6-thinking` veya `claude-sonnet-4-6`, salt okunur, çıktı `docs/syzer-iyilestirme/<kart>-REVIEW.md`; "kanıtsız sezgi yazma, çalışan senaryo ver" şartı koy. Bulguları kendin triyajla (yanlış alarm olabilir, ciddiyeti yükseltmen gerekebilir).
3. Bulguları düzelttir: Codex dolu, bu yüzden Antigravity Claude (`claude-sonnet-4-6`) veya kendin küçükse. Her düzeltmeye önce başarısız test şartı.
4. Birleştir: B2, C1, D1 dallarını `main`'e (önce D1 ve B2, sonra C1 ya da çakışmaya göre); `package.json` test listesi çakışmasını birleştir; sonra `npm test` 3 kez (flake kontrolü). `STATE.md`'yi güncelle.
5. `syzer doctor` komutunu kısa çalıştır (yeni doctor kontrolleri), hata varsa not al.
6. Yasin'e son raporu Türkçe ver (yukarıdaki tarihçe + bu tur + test sayıları + riskler + "Yasin'in elle test etmesi gerekenler": terminalde Tab tamamlama, kota mesajları, /resume arama; web arayüzü `syzer web` 390px).

## Ek (Yasin'in son mesajı): ek iş gücü
Yasin: "cursor veya grok kullanabilirsin mesela". Codex doluyken worker olarak Orca `--agent cursor` (binary `cursor-agent`, ücretsiz katman; usage ekranında Cursor Models %0, Other %13 kullanılmıştı) veya `--agent grok` kullanabilirsin. Önce `cursor-agent status` / Orca usage ile limit dolu mu bak (kayıt dosyasında ikisi de önceden "limitte" yazıyordu; bugün Cursor serbestti, Grok "refresh" bekliyordu). Cursor için her zaman `cursor-agent` yaz (`agent` komutu Grok'a çözülür). Karşı-aile review için yine tercih sırası: Antigravity Claude (`claude-sonnet-4-6`/`opus-4-6-thinking`) > Cursor/Grok > Claude Sonnet.
Not: B2/C1/D1 Codex işleri 2'şer commit ile bitti (arka plan bekleyicisi doğruladı), review/doğrulama aşamasından devam edilecek.
