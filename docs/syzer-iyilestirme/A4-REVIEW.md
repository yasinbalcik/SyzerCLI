# A4 inceleme — A2 uygulaması

Kapsam: `git diff main...HEAD -- src test package.json`, hedef spec: `docs/superpowers/specs/2026-10-12-prompt-cikti-design.md`.

## Bulgular

### [major] `spawn_syzer` sonuçları ERR_ sözleşmesinden kaçıyor

- Kanıt: `src/orca-workers.js:70-71` parse/missing-prompt hataları sırasıyla `Invalid JSON arguments.` ve `prompt is required.` döndürüyor; `src/orca-workers.js:105-106,120` worker hataları `WORKER FAILED...` döndürüyor.
- Senaryo: `spawn_syzer` çağrısı bozuk JSON ile yapılır veya görünür worker iki denemede başarısız olur. Sonuç `ok:false` olsa da `output` `ERR_<CODE>:` ile başlamaz. Bu yol `src/agent.js:194` üzerinden doğrudan çalışıyor; dolayısıyla `prompts.failure/error` ve headless tüketicisi bu hataları standardize edemiyor.
- Etki: Spec 5.1/5.2'deki tüm araç/alt-ajan hatalarının makinece ayrıştırılabilir `ERR_` satırı olma şartı kırılıyor.

### [major] Orca worker rapor limiti merkezileştirilmemiş

- Kanıt: `src/orca-workers.js:114` raporu sabit `8000` karakterle kırpıyor; `src/limits.js` içindeki `LIMITS.subagentReport` import edilmiyor.
- Senaryo: Merkezi limit değeri güncellendiğinde normal `spawn` yeni değeri kullanırken `spawn_syzer` hâlâ 8000'de kalır; 8000 karakteri aşan worker raporları iki ayrı sözleşmeye göre kırpılır.
- Etki: Spec 5.3 ve çağrı noktası eşlemesindeki merkezi limit garantisi `spawn_syzer` için geçerli değil (mevcut değer bugün aynı olsa da bağlantı eksik).

### [major] Başarısız shell/MCP araç çıktısı tek ERR satırı değil

- Kanıt: `src/tools.js:491` MCP hatasında `ERR_TOOL_FAILED` satırına ham `r.text` yeni satırla ekleniyor; `src/tools.js:549` sıfır olmayan shell çıkışında aynı desen stdout/stderr ile tekrarlanıyor.
- Senaryo: MCP aracı `ok:false` ve çok satırlı metin döndürür veya `run_command` exit code 1 ile stderr üretir. `ok:false` sonucu `ERR_TOOL_FAILED: ...\n<ham çıktı>` olur; `prompts.error`ın tek satır/no-stack kuralı ve spec 5.2'nin standart hata çıktısı korunmaz.
- Etki: Headless/model tüketicileri hata kodundan sonra sınırsız ham metin görebilir; satır bazlı ayrıştırma ve hata biçimi kararlılığı bozulur.

### [minor] Eksik girdide prompt içinde `undefined` üretiliyor

- Kanıt: `src/prompts.js:22-38` `cwd` ve `platform` için varsayılan normalizasyon yok; doğrudan template-string ile yazılıyor.
- Senaryo: Saf API `P.leadSystem({})` çağrısında çıktı `Working directory: undefined` ve `Platform: undefined...` içeriyor.
- Etki: Spec 3.1'in “üretimde `undefined`/`[object Object]` görünmez” şartı ve boş/undefined girdi kenar durumu ihlal ediliyor. Üretim çağrıları bugün alanları doldursa da public prompt API'si güvenli değil.

### [minor] Türkçe alt-ajan sistem isteminde açıklama cümleleri İngilizce kalıyor

- Kanıt: `src/prompts.js:186-191` `subagentSystem` hiyerarşi cümlesini her dilde sabit İngilizce ekliyor (`You are a subagent...`); yalnızca rapor dili cümlesi çevriliyor.
- Senaryo: `language:'tr'` ile alt ajan başlatıldığında sistem isteminin rol/hiyerarşi kısmı İngilizce, rapor talimatı Türkçe oluyor.
- Etki: Spec 3.3'teki “Türkçe seçildiğinde açıklama cümleleri Türkçe” politikasından sessiz sapma; görev dili tutarlılığı azalıyor.

### [minor] Araç kırpma eki merkezi biçime taşınmamış

- Kanıt: `src/tools.js:21` ve `src/tools.js:197` `…(truncated N chars)` üretmeye devam ediyor; merkezi `prompts.clip` (`src/prompts.js:18`) `…(truncated)` üretiyor.
- Senaryo: 20000 karakteri aşan `run_command`/web çıktısı ile dependency veya prompt çıktısı aynı oturumda kırpılır; tüketici iki farklı sonlandırıcı görür.
- Etki: Spec 5.3'te belirtilen ortak `…(truncated)` eki ve golden beklentisi tüm araç yollarında sağlanmıyor.

## Test boşlukları

- `npm test` 251/251 başarılı; ancak `spawn_syzer` (`src/orca-workers.js`) için hata/limit sözleşmesini doğrulayan test yok.
- `src/tools.js:491,549` için MCP `ok:false` ve non-zero shell çıkışının `ERR_` biçimi test edilmiyor.
- `P.leadSystem({})`/eksik alanlar ve Türkçe `subagentSystem` çıktısının tamamı için negatif/kenar test yok.

## Sonuç

Blocker: 0 · Major: 3 · Minor: 3

