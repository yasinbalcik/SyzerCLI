# SyzerCLI prompt katman mimarisi ve çıktı sözleşmesi

**Kart:** A1 (SPEC, kod değişikliği yok)  
**Kaynak:** `docs/syzer-iyilestirme/A0-ENVANTER.md`  
**Uygulama sahibi:** A2  
**Golden test sahibi:** A3  
**Kapsam:** Prompt üretimi ve araç çıktısı. `src/` ve `test/` bu kartta değişmez.

## 1. Amaç ve başarı ölçütleri

Amaç, dağınık sistem istemlerini ve dinamik istem eklerini tek bir saf API altında toplamak; modelin rol, görev modu ve dil sınırlarını her çağrı noktasında aynı sırayla görmesini sağlamaktır. Araç ve alt ajan sonuçları da tek bir iç sözleşmeye bağlanacaktır.

Başarı ölçütleri:

1. `src/prompts.js` içindeki üreticiler aynı girdiler için yan etkisiz ve deterministik metin üretir; dosya sistemi, saat, global oturum veya model çağrısı yapmaz.
2. Lead, explore, plan, general, özetleme, orkestra, todo ve hata metinleri tek modülden üretilebilir. Mevcut çağrı noktaları tablo 3.4'teki eşlemeyle kullanılır.
3. Araç icrası, alt ajan ve orkestra yolları `{ ok, output, ui? }` döndürür. `ok === false` sonuçlarının tamamı aynı hata biçimini kullanır.
4. `test/*.test.js` davranışı ve headless JSON alanları korunur; `content === result` geriye dönük eşitliği devam eder.
5. Ana sistem istemi karakter sayısı sabit bir fixture üzerinde önce/sonra ölçülür ve hedef sürüm eskisinden büyük değildir. Dinamik beceri/talimat metni yalnızca mevcutsa eklenir.
6. A3 golden testleri anahtar kelime, katman sırası, dil ve sınır değerlerini doğrular; `syzer -y --no-update` duman testi başarılı olur.

## 2. Mevcut durum (kısa)

A0 envanterine göre promptlar tek bir modülde değildir:

- Lead sistemi `src/context.js:206-239` (`buildContext`), alt ajan sistemi `src/context.js:188-196` ve `src/subagents.js:37` içinde kuruluyor.
- Dinamik todo ve bütçe metinleri `src/agent.js:165,229-230`; orkestra kuralları, bağımlılık raporu ve retry ekleri `src/orchestra.js:11,25-28,67,78-79`; özetleme `src/compact.js:119-123,140` içinde.
- Araç açıklamaları `src/tools.js:27-103`, araç sonuçları aynı dosyada yaklaşık `:501-600` aralığında; alt ajan sonuçları `src/subagents.js:112-118` içinde şekilleniyor.
- Orkestra raporları `MAX_DEP_CONTEXT=2500`, `MAX_REPORT=3500` (`src/orchestra.js:5-8`); alt ajan raporu `MAX_REPORT=8000` (`src/subagents.js:5`); araç çıktısı `MAX_OUT=20000` (`src/tools.js:14`); talimat dosyası sınırı `MAX_FILE=12000` (`src/context.js:8`).
- Headless çıktı `src/headless.js:44-63` içinde JSON olarak üretiliyor; `content` alanı eski uyumluluk için `result` kopyasıdır. Çıkış metni `src/headless.js:65-71` ve kodları `:6` ile sabittir.

Bu dağınıklık aynı kuralın farklı dillerde veya farklı hata biçimlerinde tekrarlanmasına ve limitlerin zamanla ayrışmasına yol açıyor.

## 3. Hedef mimari

### 3.1 `src/prompts.js` saf API'si

Yeni modül yalnızca sabitler, küçük normalleştiriciler ve saf fonksiyonlar içerir. Önerilen dışa aktarımlar:

```js
base({ cwd, platform, language })
role({ name, tools, language })
taskMode({ mode })                 // normal | plan | orchestra | summary
dynamic({ skills, instructionFiles, todo, dependencies, retry, budget })
leadSystem(input)                  // base + lead role + task/dynamic
subagentSystem({ ctx, agent, language })
todoReminder(items)
orchestraRules()
dependencyContext(results)
retryNotice({ why })
summarySystem()
summaryPrompt({ transcript, hint })
toolDescription(name)
error(code, detail, hint)
formatToolResult({ ok, output, ui })
```

Fonksiyonlar giriş nesnelerini kopyalamaz veya değiştirmez; boş dizi/`undefined` dinamik parçalar atlanır. Her bölüm `\n\n` ile birleştirilir ve üretimde `undefined`/`[object Object]` görünmez. `toolDescription` mevcut JSON şemasını değiştirmez, yalnızca açıklama metnini merkezi kaynaktan verir.

### 3.2 Dört katman ve birleşme sırası

Her sistem promptu tam olarak şu sırayı izler:

1. **Temel (base):** SyzerCLI kimliği, çalışma dizini, platform/kabuk, dosyayı okumadan düzenlememe ve kısa yanıt ilkesi.
2. **Rol (role):** `lead`, `explore`, `plan`, `general` veya `summary`; izin verilen araç kümesi ve rapor biçimi.
3. **Görev modu (task mode):** normal görev, `[PLAN MODE]` salt-okunur görev, orkestra görevi veya özetleme görevi.
4. **Dinamik (dynamic):** mevcut beceri listesi, talimat dosyaları, todo hatırlatması, bağımlılık raporları, retry/bütçe uyarıları. Kaynak yoksa katman hiç eklenmez.

Katman etiketi prompta kısa ve sabit bir başlık olarak girer (`[BASE]`, `[ROLE:lead]`, `[MODE:plan]`, `[DYNAMIC]`). Böylece golden test katman sırasını string'in tamamına bağımlı olmadan kontrol eder.

### 3.3 Model profili ve TR/EN dil politikası

Prompt üretimi model seçmez; mevcut routing seçimini kullanır. Girdi, seçilen rota için şu profili taşır: `{ role, model, effort, language }`. `model` yalnızca gözlem/telemetri içindir ve prompta yazılmaz. Rol profilleri:

| Profil | Talimat yoğunluğu | Rapor beklentisi |
|---|---|---|
| `lead` | tam araç ve sentez kuralları | kullanıcıya kısa, doğrulanabilir sonuç |
| `explore` | salt-okunur, dosya/satır kanıtı | bulgu + dosya yolları |
| `plan` | salt-okunur, numaralı plan | değişecek dosyalar + riskler |
| `general` | atanmış işi araçlarla bitirme | yapılanlar + sonuç |
| `summary` | yalnızca sadık sıkıştırma | hedefler, kararlar, dosyalar, açık işler, önemli komutlar |

Dil politikası: `cfg.lang`/`LANGS[getLang()]` ile seçilen dil varsayılandır; kullanıcı açıkça başka dilde yazarsa görev ve son rapor o dile uyar. Araç adları, JSON anahtarları, hata kodları, dosya yolları ve kod blokları değiştirilmez. Alt ajan raporu mevcut kuralı koruyarak görev diliyle yazılır (`src/subagents.js:37`). Varsayılan dil İngilizcedir; Türkçe seçildiğinde açıklama cümleleri Türkçe, sabit anahtar kelimeler İngilizce kalır.

### 3.4 Çağrı noktası eşleme tablosu

| Mevcut çağrı noktası | Yeni fonksiyon | Uygulama notu |
|---|---|---|
| `src/context.js:206-239` `buildContext` | `prompts.leadSystem` | `header` ve `system` aynı üreticinin ilgili görünümleri olur; beceri/talimat dinamik katmana taşınır. |
| `src/context.js:188-196` `subSystem` | `prompts.subagentSystem` | `ctx.header`, ajan rolü, alt ajan hiyerarşisi ve dosya talimatlarını tek sırada birleştirir. |
| `src/subagents.js:37` | `prompts.languageRule` veya `subagentSystem` seçeneği | Rapor dili sistem promptunun rol katmanından gelir; ikinci kez uzun metin eklenmez. |
| `src/agent.js:165` | `prompts.todoReminder` | Mevcut `[system reminder]` amacı ve `run_plan`/`todo_write` eylemleri korunur. |
| `src/agent.js:229-230`, `src/budget.js:105` | `prompts.budgetNotice` | Bütçe metni kullanıcı/alt ajan bağlamına göre üretilir; çıkış kodunu değiştirmez. |
| `src/orchestra.js:11` | `prompts.orchestraRules` | Atama kapsamı ve kısa rapor kuralı korunur. |
| `src/orchestra.js:25-28` | `prompts.dependencyContext` | Her rapor merkezi `limits.depContext` ile kırpılır. |
| `src/orchestra.js:78-79` | `prompts.retryNotice` | `why` parametresi dışında dinamik veri eklenmez. |
| `src/compact.js:119-123,140` | `prompts.summarySystem`, `prompts.summaryPrompt`, `prompts.summaryAck` | Özet etiketinin (`[Conversation summary]`) anlamı ve yaklaşık 600 kelime sınırı sabit kalır. |
| `src/tools.js:27-103` | `prompts.toolDescription` | `edit_file` ve `todo_write` metinleri aşağıdaki taslakla yenilenir; şema/parametre adları aynı kalır. |
| `src/tools.js` sonuç üreticileri, `src/subagents.js:112-118`, `src/orchestra.js:107-119` | `formatToolResult`, `error`, merkezi limitler | UI özeti isteğe bağlıdır; model çıktısı `output` olur. |
| `src/headless.js:44-71` | Değişmez tüketici | İç sözleşmeyi tüketir; JSON şekli ve `outBody` metni korunur. |

## 4. Prompt içerik iyileştirmeleri

Metinler İngilizce tutulur; dil katmanı cümleleri gerektiğinde Türkçeye çevirir. Aşağıdaki taslaklar A2'nin doğrudan temel alacağı metinlerdir.

### 4.1 Lead system prompt taslağı

```text
[BASE]
You are SyzerCLI, a terminal coding agent. Work inside {cwd} using {shell}.
Inspect before changing: read a file before editing it. Use edit_file for focused existing-file changes and write_file for new files.
Keep replies concise and state what you verified.
Reply in {language} unless the user writes in another language. Keep tool names, JSON keys, paths, and code unchanged.

[ROLE:lead]
You own the user's task and the final synthesis. Use tools instead of guessing.
Use todo_write only for 3+ distinct steps; keep one item in_progress and complete items immediately.
Delegate only independent work with a self-contained prompt; verify reports before presenting them.

[MODE:{mode}]
Follow the active mode's tool and reporting rules. In plan mode use read-only tools and end with a numbered plan.

[DYNAMIC]
Apply the following project instructions, skills, and current-task reminders when present:
{dynamic}
```

Gerekçe: A0'daki kimlik, cwd/platform, dil, okuma önkoşulu, todo ve orkestra kuralları korunuyor; uzun açıklamalar yalnızca ilgili dinamik bölüm varsa ekleniyor. Bu, tekrarları ve token artışını sınırlar.

### 4.2 `edit_file` açıklaması

```text
Replace exact text in one file. Read the file first. Use either old_string/new_string or edits:[{old_string,new_string}] for several changes; edits are applied in order. Each old_string must match exactly once unless replace_all=true. If matching fails, re-read and copy current text; whitespace-insensitive fallback may be reported, but do not use it to guess. Keep changes focused and preserve surrounding content.
```

Gerekçe: A0'daki tekil eşleşme, `edits` dizisi ve esnek boşluk eşleşmesi kurallarını eylem sırasıyla görünür kılar; yanlış dosyaya geniş değişiklik yapma riskini azaltır.

### 4.3 `todo_write` açıklaması

```text
Use only for 3+ genuinely distinct steps or when the user asks for a checklist. Send the full list every time; use exactly one in_progress item and mark it completed immediately. For orchestra work, set agent, prompt, and depends_on on delegated items, then call run_plan. Do not use it for a one-step task, a question, or chat.
```

Gerekçe: Mevcut açıklamanın amacını korur, normal kullanım ile orkestrayı ayırır ve A0'ın belirttiği yüksek token maliyetini kısaltır.

### 4.4 Standart hata metinleri

`prompts.error(code, detail, hint)` tek satır üretir; biçim `ERR_<CODE>: <detail>. <hint>` olur. `hint` yoksa ikinci cümle atlanır. Önerilen kodlar:

| Kod | Taslak | Kullanım |
|---|---|---|
| `INVALID_JSON` | `ERR_INVALID_JSON: tool arguments are not valid JSON. Retry with an object.` | `src/subagents.js` parse hatası |
| `MISSING_PROMPT` | `ERR_MISSING_PROMPT: prompt is required. Provide a complete task.` | spawn çağrısı |
| `UNKNOWN_AGENT` | `ERR_UNKNOWN_AGENT: agent "{name}" is not available. Choose one of: {list}.` | ajan adı doğrulama |
| `EDIT_NOT_FOUND` | `ERR_EDIT_NOT_FOUND: old_string was not found. Re-read the file and copy the exact current text.` | `edit_file` |
| `EDIT_AMBIGUOUS` | `ERR_EDIT_AMBIGUOUS: old_string matches {n} times. Add context or set replace_all=true.` | `edit_file` |
| `NO_AGENT_ITEM` | `ERR_NO_AGENT_ITEM: no todo item has an agent. Add agent and prompt, then call run_plan.` | `run_plan` |
| `TOOL_FAILED` | `ERR_TOOL_FAILED: {detail}` | beklenmeyen araç/alt ajan hatası |

Kodlar makine tarafından ayrıştırılabilir; ayrıntı kullanıcı dilinde olabilir. Stack trace, anahtar veya dosya içeriği hata çıktısına eklenmez.

## 5. Çıktı sözleşmesi

### 5.1 İç araç sonucu

Her araç yürütücüsü ve `spawn`/`runPlan` aşağıdaki şekli döndürür:

```js
{
  ok: true | false,
  output: string,                 // modelin göreceği tek metin; boşsa "(no output)"
  ui?: { summary: string, body?: string } // kullanıcı arayüzü için, modele gönderilmez
}
```

Başarıda `output` doğrulanmış sonucu; hatada `output` standart `ERR_<CODE>:` satırını taşır. `ui` yoksa tüketici `output`tan özet çıkarır. Mevcut `model`, `routedRole`, `stopped` gibi tanısal alanlar geçiş süresince ek alan olarak kalabilir; temel üç alanın anlamını değiştiremez.

### 5.2 Hata ve headless uyumluluğu

`src/agent.js` tool mesajına yalnızca `r.output` yazar; `ui` hiçbir zaman modele sızmaz. `src/headless.js:44-63` mevcut JSON'u korur: `ok`, `exitCode`, `result`, isteğe bağlı `error`/`budgetExceeded`/`timedOut`, `session`, `usage`, `files`; eski `content=result` ve diğer eski alanlar aynen tutulur. `outBody` için `ERROR: ...`, `BUDGET EXCEEDED: ...` ve `(no output)` metinleri değişmez. Yeni iç hata kodu, headless `exitCode` eşlemesini tek başına değiştirmez.

### 5.3 Merkezi boyut limitleri

`src/limits.js` içinde tek bir `Object.freeze` yapı önerilir; bütün tüketiciler bu değerleri import eder:

```js
const LIMITS = Object.freeze({
  instructionFile: 12000,
  mentionFile: 30000,
  toolOutput: 20000,
  subagentReport: 8000,
  orchestraReport: 3500,
  dependencyContext: 2500,
  transcript: 60000,
  summaryWords: 600,
});
```

Bu değerler A0'daki mevcut sınırların taşınmış halidir; ilk uygulamada değer değiştirilmez. `src/context.js:8`, `src/tools.js:14`, `src/subagents.js:5`, `src/orchestra.js:5-8` ve `src/compact.js` içindeki sabitler bu kaynaktan okunur. Kırpma eki her yerde `…(truncated)` biçiminde kalır. Limit aşımı `ok:false` sayılmaz; sonuç başarıysa kırpılmış başarı olarak döner.

## 6. Geriye uyumluluk

- Mevcut `test/*.test.js` testlerinin import ve beklenen alanları korunur. `runPlan`, `spawn`, araç yürütücüleri ve UI hook'ları `{ ok, output, ui? }` ile çalışmaya devam eder.
- Headless tek JSON nesnesi, çıkış kodları (`0,1,2,3,4,130`), prompt kaynak önceliği ve `--quiet/--json` davranışı değişmez.
- Prompt üreticisi eski sabit metni gereksiz yere iki kez eklemez. Kabul ölçümü: aynı cwd, aynı beceri/talimat listesi ve aynı dil ile `buildContext(cwd).system.length` ve yeni `leadSystem(input).length` kaydedilir; yeni değer eski değeri aşamaz. Dinamik veri olmayan bir çağrı, dinamik başlıklar dışında ek paragraf üretmez.
- A2 yeni modülü kademeli bağlayabilir; her çağrı noktası geçişinde eski ve yeni metin bir kez loglanarak karşılaştırılır, kalıcı log bırakılmaz.

## 7. Test stratejisi

### 7.1 A3 golden test listesi

Her test saf fonksiyonu gerçek model çağrısı olmadan çağırır. Tam metin yerine aşağıdaki anahtar kelime ve yapılar doğrulanır:

| Fonksiyon | Golden beklentisi |
|---|---|
| `base` / `leadSystem` | `[BASE]`, `Working directory`/cwd, `Reply in`, `Read a file before editing`; katman sırası `BASE < ROLE < MODE < DYNAMIC`; eksik dinamikte `undefined` yok |
| `role({name:'explore'})` | salt-okunur/read-only, `file paths`, `line numbers`, değişiklik yasağı |
| `role({name:'plan'})` | read-only, numbered plan, exact files, risks |
| `role({name:'general'})` | assigned task, tools, concise final report |
| `taskMode('plan')` | `[MODE:plan]`, yalnızca okuma, onay/numaralı plan; `taskMode('normal')` bunları içermez |
| `subagentSystem` | lead hiyerarşisi, kullanıcıya soru sormama, görev diliyle rapor; dosya talimatlarının sırası |
| `todoReminder` | `[system reminder]`, unfinished items, `run_plan`, `todo_write`, kullanıcıya hatırlatmadan söz etmeme |
| `orchestraRules` / `dependencyContext` / `retryNotice` | assignment scope, `### Result of [id]`, `previous attempt`, kırpma limitleri |
| `summarySystem` / `summaryPrompt` / `summaryAck` | faithful summary, goals/decisions/files/TODOs/commands, `~600 words`, `[Conversation summary]`, sabit onay cümlesi |
| `toolDescription('edit_file')` | read first, exact once, `edits` order, `replace_all`, re-read on mismatch |
| `toolDescription('todo_write')` | 3+ steps, full list, one `in_progress`, `agent`/`depends_on`, `run_plan` |
| `error` | tüm kodlar `ERR_` ile başlar, tek satır, ayrıntı ve varsa hint; stack trace yok |
| `formatToolResult` | başarı/hata için `ok` boolean ve string `output`; `ui` opsiyonel; input nesnesi değişmez |
| `LIMITS` | A0 değerleri aynen; `Object.freeze`; her limit pozitif sayı |
| dil politikası | `language:'tr'` cümleleri Türkçe, JSON anahtarları ve araç adları İngilizce; `language:'en'` mevcut İngilizce; kullanıcı dilinin önceliği |

A3 ayrıca mevcut headless golden'ını çalıştırarak `content === result`, `usage` alanları ve `outBody` öneklerini doğrular.

### 7.2 Duman testi

Repo kökünde:

```text
syzer -y --no-update
```

Komut, en az bir araç çağrısı içeren kısa bir görevle çalıştırılır; süreç hata vermeden tamamlanır, stdout/stderr içinde stack trace bulunmaz ve headless/etkileşimli sonuç beklenen sözleşmeye uyar. A2 uygulamasında önce mevcut test komutu, sonra bu duman testi çalıştırılır; A1 bu testleri eklemez.

## 8. Riskler ve geri alma

| Risk | Etki | Önlem / geri alma |
|---|---|---|
| Prompt birleştirme sırası değişir | Model davranışı veya golden testleri sapar | Katman başlıkları ve tablo 3.4; sorun çıkarsa ilgili çağrı noktasını eski stringe döndür, `prompts.js` kalsın. |
| Yeni metin uzar | Token maliyeti ve gecikme artar | Karakter ölçümünü CI/golden fixture ile karşılaştır; sınır aşarsa dinamik bölümü veya açıklamayı kısalt. |
| Hata öneki UI'ı bozar | Kullanıcıya görünen satırlar değişir | `ui.summary` mevcut i18n metninden üret; `output` yalnızca modele; sorun halinde eski mesajı adaptör içinde koru. |
| Merkezi limit yanlış uygulanır | Rapor/araç çıktısı eksilir | A0 değerleriyle başla, limit testi ve `…(truncated)` eki; tek commit'i geri al. |
| Headless alanı yanlışlıkla kaldırılır | CI entegrasyonları kırılır | `buildResult` ve `outBody` değişmeden bırak; başarısız smoke'ta yalnızca çıktı adaptörünü geri al. |

Geri alma yolu: A2'nin tek uygulama commit'ini geri almak (`git revert <commit>`) eski çağrı noktası metinlerini ve mevcut çıktı üreticilerini geri getirir; dokümantasyon commit'i tutulabilir.

## 9. Yasin'e sorulacak açık kararlar (önerilerle)

1. **İç sonuç nesnesinde standart `errorCode` alanı da bulunsun mu?** Öneri: ilk sürümde hayır; `ERR_<CODE>:` öneki yeterli, temel `{ok,output,ui?}` sözleşmesi küçük kalır.
2. **Merkezi limitler `src/limits.js` içinde mi olsun?** Öneri: evet; A0'daki dört dosyadaki sabitleri tek import noktasına taşır, değerleri değiştirmez.
3. **Lead prompt varsayılan dili İngilizce mi kalsın?** Öneri: evet; `cfg.lang` ve kullanıcı dili Türkçeyi seçtiğinde yalnızca doğal dil cümleleri çevrilsin.
4. **Ana prompt karakter ölçümü hangi fixture ile sabitlensin?** Öneri: boş skill/talimatlı, sabit cwd ve `en` fixture; ayrıca tipik TR fixture raporlansın, kabul eşiği boş fixture'a göre belirlensin.
5. **Yeni araç açıklamaları birebir golden metin olarak mı kilitlensin?** Öneri: hayır; A3 anahtar kelime ve yapı kontrolü yapsın, böylece hata düzeltmeleri gereksiz kırılma yaratmasın.
