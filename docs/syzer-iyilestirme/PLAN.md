# SyzerCLI + Orca + Web arayüzü iyileştirme: orkestra planı

Tarih: 2026-10-12 · Koordinatör: Claude Sonnet 5.5 · Durum: taslak, Yasin onayı bekliyor
Sıra (Yasin kararı): **A prompt/çıktı → E web arayüzü**, sonra B altyapı, C UX, D Orca.

## Varsayımlar (doğrulanmadı)
- Claude ve Codex kotası: `unknown` (agent-registry'deki Codex %23 değeri 2026-10-09 tarihli, güncel değil).
- Antigravity (`agy`) hazır varsayıldı; dispatch öncesi `scripts/agent-healthcheck.ps1` ile doğrulanacak.
- Sistem promptları `src/` içinde dağınık; "system prompt" aramasıyla bulunamadı. A0 bunu çözer.
- `src/web-ui.js` tek bir `String.raw` HTML şablonu (204 satır); tek dosya = tek yazar.

## Kurallar
- Her kart ayrı Orca worktree'de (`feat/syzer-<kart>`). Merge/push yalnız Yasin onayıyla.
- Spec kartları (A1, E1) Yasin onayı almadan uygulama kartı açılmaz.
- Ciddi kod A havuzunda (Claude/Codex); Antigravity yalnız keşif, dar test ve görsel QA.
- Review, yazanın karşı ailesinden: Claude yazdıysa Codex, Codex yazdıysa Claude. Alternatif: Antigravity Gemini 3.1 Pro.
- Kota `unknown` iken yeni dalga tek worker ile başlar; koordinatör sayıya dahil.
- Yazma setleri çakışmaz. Aynı dosyaya iki worker yazmaz.

## Alan A: prompt ve çıktı kalitesi

| Kart | İş | Model (zincir) | Yazma seti | Bitti sayılır |
| --- | --- | --- | --- | --- |
| A0 | Keşif: prompt parçaları, araç açıklamaları, çıktı biçimleme noktaları | Antigravity Gemini 3.1 Pro (Gündelik) | `docs/syzer-iyilestirme/A0-ENVANTER.md` | Her parça için `dosya:satır`; `git diff --stat` kod dosyasında boş |
| A1 | Spec: prompt katman mimarisi (temel / rol / model profili / görev modu), çıktı sözleşmesi | Koordinatör + Yasin onayı (Strateji: Opus/astra istenirse) | `docs/superpowers/specs/2026-10-12-prompt-cikti-design.md` | Yasin yazılı onay |
| A2 | Uygulama: `src/prompts.js` tek modül, çağrı noktaları bağlanır | Claude Sonnet 5.5 (alt: Codex gpt-6.1-sol) | `src/prompts.js`, `src/agent.js`, `src/context.js`, `src/tools.js` | `npm test` yeşil; `syzer -y "<örnek görev>"` headless duman testi geçer |
| A3 | Altın (golden) testler, spec'ten yazılır, uygulamadan değil. A2 ile paralel | Antigravity Gemini 3.1 Pro (dar kapsam) | `test/prompts-golden.test.js` | Dosya `package.json` test listesine eklenir; A2 sonrası geçer |
| A4 | Review | Karşı aile (A2 Claude ise Codex gpt-6.1-sol) | Yok (yalnız bulgu) | Blocker 0; bulgular `docs/syzer-iyilestirme/A4-REVIEW.md` |

## Alan E: web arayüzü

| Kart | İş | Model (zincir) | Yazma seti | Bitti sayılır |
| --- | --- | --- | --- | --- |
| E0 | Keşif: `web.js` API uçları, `web-ui.js` bileşen/durum haritası, mevcut ekran görüntüsü | Antigravity Gemini 3.1 Pro | `docs/syzer-iyilestirme/E0-ENVANTER.md` | Uçlar ve bileşenler listeli; kod diff'i boş |
| E1 | Tasarım spec: jetonlar, düzen, bileşenler, durumlar (boş/yükleniyor/hata/araç çıktısı/diff), TR/EN, koyu/açık tema. 2-3 yönlü görsel karşılaştırma | Koordinatör + Yasin onayı (Strateji) | `docs/superpowers/specs/2026-10-12-web-arayuz-design.md` | Yasin yazılı onay, seçilen yön |
| E2 | Uygulama | Claude Sonnet 5.5 (alt: Codex gpt-6.1-sol) | `src/web-ui.js`; API değişirse `src/web.js` ayrı alt kart | `syzer web` açılır, konsol hatası 0, `npm test` yeşil |
| E3 | Görsel QA (gerçek tarayıcı) | Antigravity | Yok (rapor + ekran görüntüsü yolları) | Matris: TR/EN × koyu/açık × 1440/1024/390 = 12 kombinasyon; taşma yok, kontrast ≥ 4.5:1, odak görünür |
| E4 | Review + erişilebilirlik | Karşı aile | Yok | Blocker 0 |

## Dalgalar
1. **W0 (Claude/Codex kotası harcamaz):** A0, E0 salt okunur keşif, Antigravity.
2. **W1:** A1 spec → Yasin onayı → A2 (tek worker) ∥ A3 (Antigravity, ayrık dosya). E1 spec koordinatörde, A2 ile paralel (kod yazmaz).
3. **W2:** A4 review → Yasin merge onayı.
4. **W3:** E1 onayı → E2 → E3 → E4 → Yasin merge onayı.
5. **W4 (sonra):** B, C, D aynı iskeletle (keşif → spec → uygulama → review). D (Orca `app.asar` yaması) yüksek risk: Strateji zinciri, Antigravity'ye inmez.

Kota değerleri verilirse A2 ∥ E2 paralel koşabilir (yazma setleri ayrık).

## Plan nerede çöker?
1. **Promptlar beklenenden dağınık/gömülü:** A0 sonucuna göre A1 kapsamı değişir, A2 dalgası bekler.
2. **Prompt kalitesi ölçülemez:** eval altyapısı yok. A için "bitti" yapısal (golden test + duman testi); kalite iyileşmesi Yasin'in gerçek kullanımıyla doğrulanır. Bunu A1'de açık yaz.
3. **`web-ui.js` tek şablon dizesi:** büyük yeniden yazım tek kartta kalmalı; bölünürse çakışır. Gerekirse E2'den önce dosyayı CSS/JS/HTML parçalarına ayıran küçük bir refactor kartı (E1.5).
4. **Syzer kendini günceller / Orca yaması:** worktree'deki sürüm ile kurulu sürüm kayabilir. Testler `--no-update` ile çalışır; `syzer doctor` kapıya eklenir.
5. **Antigravity ve Windows:** `agy -p` kararsız olursa A0/E0 koordinatöre düşer (bedeli: Claude kotası).

## Kapanış
STATE.md güncel, repo raporu, kod değiştiyse `graft build`. Commit mesajlarında Claude ortak yazar satırı yok (Yasin kuralı).

## Güncelleme 2026-10-12: kota ve yeniden dağıtım (Yasin kararı: Claude dışı)
Orca usage: Claude 5s %75 / hafta %91 dolu (worker yok, yalnız koordinatör), Codex %36, Antigravity %1, Syzer %1, Cursor Free %0-13.
- A1, E1 spec: Codex gpt-6-astra (koordinatör yalnız onay akışını yürütür).
- A2, E2 uygulama: Codex gpt-6.1-sol. Yedek: Cursor Agent.
- A3, E3: Antigravity. A4, E4 review: Antigravity Gemini 3.1 Pro (Codex yazdığı için karşı aile Claude kotasız olduğundan Google ailesi alternatif).
- A0, E0 Antigravity'de 2026-10-12 dispatch edildi (worktree: syzer-A0-envanter, syzer-E0-envanter; Antigravity varsayılan modeli Gemini 3.8 Flash çıktı).
- 2026-10-12: Codex hesabında gpt-6-astra ve gpt-6.1-sol desteklenmiyor (400 "not supported with a ChatGPT account"). Kullanılabilir: gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna. A1/E1 gpt-6-luna (high) ile koşuyor; A2/E2 modeli onay sonrası seçilecek (terra veya luna).
