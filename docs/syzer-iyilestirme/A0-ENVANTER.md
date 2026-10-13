# A0 Keşif Envanteri: Prompt Parçaları, Araç Açıklamaları ve Çıktı Biçimleme Noktaları

**Tarih:** 2026-10-12  
**Kart:** A0 (Alan A: prompt ve çıktı kalitesi)  
**Rol:** A0 (L2 Worker)  
**Üst Şef:** Koordinatör (Claude Sonnet 5.5 / Orca)  
**Çalışma Alanı:** `syzer-A0-envanter` (`feat/syzer-A0` / `yasinbalcik/syzer-A0-envanter`)  
**Hedef:** Kod tabanındaki tüm prompt parçalarını, araç açıklamalarını ve çıktı biçimleme noktalarını `dosya:satır` kesinliğiyle çıkarmak; kod dosyalarında 0 değişiklik (`git diff --stat` boş) bırakmak.

---

## 1. Yönetici Özeti ve Mimari Durum

SyzerCLI kod tabanında promptlar ve çıktı biçimleri tek bir modülde toplanmamış; **12 farklı kaynak dosyasına** dağılmış durumdadır.
- **Sistem İstemleri:** `src/context.js` içinde ana şablon, `src/subagents.js` ve `src/orchestra.js` içinde alt ajan kuralları, `src/compact.js` içinde özetleme istemleri şeklinde parçalıdır.
- **Dinamik İstem Enjeksiyonları:** Tur ortasında `src/agent.js` (tamamlanmamış todo hatırlatması), bütçe aşımında `src/agent.js` ve `src/budget.js`, orkestrada `src/orchestra.js` (stalled retry istemi ve kural enjeksiyonu), plan modunda `src/repl.js` (`[PLAN MODE]`) gibi noktalardan dinamik olarak geçmişe eklenmektedir.
- **Araç Açıklamaları (Tool Descriptions):** `src/tools.js` içinde `DEFS`, `SPAWN_DEF`, `WORKER_DEF`, `RUN_PLAN_DEF` altında JSON şeması olarak tanımlanmıştır. Ayrıca `src/mcp-server.js` içinde harici MCP istemcilerine sunulan araçlar bulunmaktadır.
- **Çıktı Biçimleme (Formatting):** Araç dönüşleri (`src/tools.js`), diff formatlayıcı (`src/diff.js`), Markdown render (`src/ui.js` `MdStream`), ajan ağacı/panel/raporu (`src/agent-tree.js`), terminal dock ve başlık (`src/header.js`, `src/dock.js`, `src/repl.js`), headless JSON/metin sözleşmesi (`src/headless.js`) ve web arayüzü olayları (`src/web.js`, `src/web-ui.js`) üzerinden yönetilmektedir.

Aşağıdaki dökümde her bileşen `dosya:satır` referansıyla ayrıntılandırılmıştır.

---

## 2. Prompt Parçaları Envanteri (System & User Prompts, Enjeksiyonlar)

### 2.1. Ana Sistem İstemi (Lead / Main Agent System Prompt)
- **Konum:** [`src/context.js:206-239`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/context.js#L206-L239)
- **Fonksiyon:** `buildContext(cwd)`
- **Bileşenler:**
  - **Kimlik ve Ortam (`src/context.js:207-216`):**
    - `You are SyzerCLI, a capable coding and general-purpose agent running in the user's terminal.`
    - Çalışma dizini (`Working directory: ${cwd}`), platform (`PowerShell` veya `sh`), yanıt dili (`Reply in ${LANGS[getLang()] || 'English'} unless the user writes in another language.`).
    - Dosya düzenleme kuralı (`Read a file before editing it. Prefer edit_file for small changes... write_file for new files`).
    - Todo ve orkestrasyon kuralı (`Use todo_write only for substantial work with 3+ genuinely distinct steps... Keep exactly one item in_progress...`).
  - **Beceri Enjeksiyonu (`src/context.js:219-224`):**
    - `Available skills (call the use_skill tool with the exact name to load full instructions when relevant): ...` (ilk 40 becerinin ad ve açıklaması).
  - **Alt Ajan ve Orkestra Rehberi (`src/context.js:225-237`):**
    - `Subagents: for independent or exploratory subtasks, delegate with the spawn_agent tool...`
    - `ORCHESTRA: for a big job you are the orchestrator. Write the plan with todo_write, giving each item an id, an agent, a self-contained prompt and depends_on ids...`
    - `Subagents only see their own prompt: copy the user constraints... into every agent prompt, and use read-only agents (explore, plan) for analysis items.`
    - `Plan FIRST: write the todo_write plan before reading files yourself...`
    - `The final synthesis/report is YOURS: add it as a last item WITHOUT an agent...`
    - Mevcut ajanların listesi (`- ${a.name}: ${a.description}`).
  - **Talimat Dosyaları Enjeksiyonu (`src/context.js:238`):**
    - `SYZER.md`, `OPENROUTER.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md` dosyalarından okunan metinler (`--- ${f.path} ---\n${f.text}`). Maksimum 12.000 karakter sınırı (`MAX_FILE = 12000`, `src/context.js:9, 39`).

### 2.2. Yerleşik Alt Ajan İstemleri (Builtin Subagent Prompts)
- **Konum:** [`src/context.js:131-149`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/context.js#L131-L149)
- **Dizi:** `BUILTIN_AGENTS`
- **İstemler:**
  1. **`explore` (`src/context.js:135-137`):**
     - *Prompt:* `You are an exploration agent. You can only read: list, find, search and read files. Never modify anything. Investigate thoroughly but efficiently, then report concrete findings (file paths, line numbers, short quotes).`
     - *Araçlar:* Salt-okunur (`READ_TOOLS`).
  2. **`plan` (`src/context.js:141-143`):**
     - *Prompt:* `You are a planning agent. You can only read. Study the relevant code, then return a concise numbered implementation plan listing the exact files to change and the risks. Do not modify anything.`
     - *Araçlar:* Salt-okunur (`READ_TOOLS`).
  3. **`general` (`src/context.js:147-148`):**
     - *Prompt:* `You are a worker agent. Complete the assigned task fully using your tools, then report what you did.`
     - *Araçlar:* Tam araç seti (`ALL_TOOLS`).

### 2.3. Alt Ajan Sistem İstemi Birleştiricisi (Subagent System Prompt Assembler)
- **Konum:** [`src/context.js:188-196`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/context.js#L188-L196) (`subSystem`) ve [`src/subagents.js:37`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/subagents.js#L37)
- **Yapı:**
  - `ctx.header` (ana ajanın çalışma dizini, platform ve temel davranış talimatı)
  - `agent.prompt` (alt ajanın kendi sistem istemi)
  - Hiyerarşi kuralı: `You are a subagent working for a lead agent. You cannot ask the user questions. Finish the task, then reply with a concise final report (findings, file paths, results). The lead only sees that report.`
  - Dosya talimatları (`...ctx.files.map(...)`)
  - Dil kuralı (`src/subagents.js:37`): `Write your final report in ${require('./i18n').LANGS[cfg.lang] || 'the same language as the task'}.`

### 2.4. Orkestra Kural ve Bağlam Enjeksiyonları (Orchestra Prompt Injections)
- **Konum:** [`src/orchestra.js:11, 25-28, 67, 78-79`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/orchestra.js#L11)
- **Parçalar:**
  1. **Genel Kurallar (`src/orchestra.js:11`):**
     - `RULES = '\n\n(Rules: do only this assignment. Do NOT create, modify or delete any file unless the assignment above explicitly tells you to write that file. Finish with a concise report as your final message.)'`
  2. **Bağımlılık Çıktısı Enjeksiyonu (`src/orchestra.js:25-28`):**
     - `### Result of [${d}]\n${trunc(reports.get(d), MAX_DEP_CONTEXT)}`
     - Başlık: `\n\n---\nResults from earlier steps you depend on:\n${parts.join('\n\n')}`
     - Maksimum bağımlılık bağlamı: `MAX_DEP_CONTEXT = 2500` karakter.
  3. **Yeniden Deneme İstemi (`src/orchestra.js:78-79`):**
     - Adım limitine çarpan veya boş dönen ajanın 2. denemesinde prompta eklenen direktif:
     - `\n\n(Your previous attempt ${why}. Be efficient: read only what you need, then finish with your final report.)`

### 2.5. Dinamik Tur İçi Hatırlatmalar ve Bütçe Mesajları
- **Konum:** [`src/agent.js:165, 229-230`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/agent.js#L165)
- **Parçalar:**
  1. **Todo Tamamlama Hatırlatması (`src/agent.js:165`):**
     - `[system reminder] Your todo list still has unfinished items: ${open.map((x) => `"${x.content}" (${x.status})`).join(', ')}. Finish them (call run_plan for agent items), or update the list with todo_write (mark done/remove) before ending your turn. Do not mention this reminder to the user.`
  2. **Bütçe Aşımı Durdurma İstemleri (`src/agent.js:229-230`):**
     - Ana oturum mesajı: `[budget exceeded: ${budgetStop}. Stopped after the last tool batch; the user may continue.]`
     - Alt ajan metin sonu: `${finalText || ''}\n[budget exceeded: ${budgetStop}; stopped early]`
  3. **Bütçe Durdurma Nedeni Metni (`src/budget.js:105`):**
     - `stopMessage = (reason) => `${reason}. Reply to continue (counters reset for the next turn).``

### 2.6. Plan Modu Öneki (Plan Mode Prefix)
- **Konum:** [`src/repl.js:36, 386`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/repl.js#L36)
- **Metin:**
  - `PLAN_PREFIX = '[PLAN MODE] Use read-only tools only. Do NOT modify anything. Investigate, then answer with a concise numbered plan and ask for approval at the end.\n\n';`

### 2.7. Bağlam Sıkıştırma (Compaction) İstemleri
- **Konum:** [`src/compact.js:88, 119-123, 139-140, 204`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/compact.js#L88)
- **Parçalar:**
  1. **Özet Etiketi (`src/compact.js:88`):** `SUMMARY_TAG = '[Conversation summary]'`
  2. **Sıkıştırma Sistem İstemi (`src/compact.js:119`):** `SUMMARY_SYSTEM = 'You compress conversations into faithful working summaries.'`
  3. **Özetleme Kullanıcı İstemi (`src/compact.js:120-123`):**
     - `summaryPrompt = (transcript, hint) => 'Summarize this conversation so work can continue without it. Cover: the user\'s goals, decisions made, files touched (with paths), open TODOs / next steps, and commands run with results that matter. Dense and factual, no preamble, at most ~600 words.' + (hint ? `\nExtra focus: ${hint}` : '') + `\n\n${transcript}``
  4. **Özet Onay Asistan Yanıtı (`src/compact.js:140`):** `{ role: 'assistant', content: 'Understood. I will continue from this summary.' }`
  5. **Tek Seferlik Hızlı Soru Sistem İstemi (`src/compact.js:204`):** `quickAsk(..., system = 'You are a concise assistant.')`

### 2.8. Slash Komutları Tarafından Üretilen İstemler
- **Konum:** [`src/cmds2.js:93-97, 114`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/cmds2.js#L93-L97), [`src/repl.js:524, 537, 572, 588`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/repl.js#L524)
- **Parçalar:**
  1. **`/commit` İstemi (`src/cmds2.js:95-97`):**
     - *Prompt:* `Write a git commit message for these changes. Imperative mood, subject line max 72 chars, optional short body after a blank line. Reply with ONLY the message.\n\nStatus:\n${status}\n\nDiff:\n${diff.slice(0, 20000)}`
     - *Sistem:* `You write precise git commit messages.`
  2. **`/review` İstemi (`src/cmds2.js:114`):**
     - *Prompt:* `Review this diff for bugs, risky changes, missing edge cases and style problems. Be specific (file and line) and concise; end with a short verdict.\n\n\`\`\`diff\n${d.slice(0, 40000)}\n\`\`\``
  3. **`/init` İstemi (`src/repl.js:572`):**
     - *Prompt:* `Analyze this project using your tools (structure, package/config files, README, scripts, conventions). Then create SYZER.md in the project root: a concise guide for AI agents covering what the project is, how to build/test/run it, the code layout, and conventions to follow. Keep it under 60 lines.`
  4. **`/go` İstemi (`src/repl.js:537`):**
     - *Prompt:* `The plan is approved. Execute it now.`
  5. **`/continue` İstemi (`src/repl.js:524`):**
     - *Prompt:* `Continue the previous task where you left off.`
  6. **`/<skill>` İstemi (`src/repl.js:588`):**
     - *Prompt:* `Use the skill "${skill.name}" (call use_skill first).${arg ? `\n\nTask: ${arg}` : ''}`

### 2.9. Giriş Genişletme ve Enjeksiyonlar (Mentions & Multimodal)
- **Konum:** [`src/repl.js:132-147, 150-161`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/repl.js#L132-L147)
- **Parçalar:**
  1. **`@dosya` Etiketleri (`src/repl.js:143`):** `<file path="${rel}">\n${body.length > 30000 ? body.slice(0, 30000) + '\n…(truncated)' : body}\n</file>`
  2. **Görsel Enjeksiyonu (`src/repl.js:157`):** `{ type: 'image_url', image_url: { url: 'data:${mime};base64,...' } }`

### 2.10. Harici İşçi (Orca Worker) İstemleri
- **Konum:** [`src/orca-workers.js:44, 51, 74`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/orca-workers.js#L44)
- **İşleyiş:** `spawn_syzer` çağrıldığında parametre olarak gelen `prompt` metni `~/.syzercli/workers/<id>/prompt.txt` dosyasına yazılır ve yeni terminal sekmesinde `--prompt-file` bayrağıyla bağımsız süreç başlatılır.

---

## 3. Araç Açıklamaları (Tool Definitions & Descriptions)

`src/tools.js` içinde `fn(name, description, properties, required)` yardımcısıyla tanımlanan araçlar ve parametre açıklamaları:

| Araç Adı | Tanım (Description) | Parametreler & Açıklamaları | Konum |
| :--- | :--- | :--- | :--- |
| **`read_file`** | `Read a text file. Returns numbered lines.` | `path` (string, zorunlu)<br>`offset`: `1-based start line` (integer)<br>`limit`: `max lines` (integer) | [`src/tools.js:27-29`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L27-L29) |
| **`write_file`** | `Create or overwrite a file with the given content.` | `path` (string, zorunlu)<br>`content` (string, zorunlu) | [`src/tools.js:30-32`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L30-L32) |
| **`edit_file`** | `Replace exact strings in a file. Either pass old_string/new_string, or pass "edits" (an array of {old_string,new_string}) to apply several changes at once. Each old_string must match exactly once unless replace_all is true.` | `path` (string, zorunlu)<br>`old_string` (string)<br>`new_string` (string)<br>`replace_all` (boolean)<br>`edits` (array of objects) | [`src/tools.js:33-36`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L33-L36) |
| **`list_dir`** | `List files and folders in a directory.` | `path`: `default: .` (string) | [`src/tools.js:37`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L37) |
| **`find_files`** | `Find files by glob pattern (supports * ** ?), e.g. "src/**/*.js".` | `pattern` (string, zorunlu) | [`src/tools.js:38`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L38) |
| **`search_files`** | `Search file contents with a regular expression. Returns file:line: text.` | `pattern` (string, zorunlu)<br>`path`: `directory, default .`<br>`glob`: `optional file filter, e.g. *.js` | [`src/tools.js:39-41`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L39-L41) |
| **`run_command`** | `Run a shell command in the working directory and wait for its output.` | `command` (string, zorunlu)<br>`timeout_seconds`: `default 60` (integer) | [`src/tools.js:42-44`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L42-L44) |
| **`run_background`** | `Start a long-running command (dev server, watcher, long test run) in the background. Returns a task id.` | `command` (string, zorunlu) | [`src/tools.js:45`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L45) |
| **`bg_output`** | `Read new output of a background task and see whether it is still running.` | `id` (integer, zorunlu) | [`src/tools.js:46`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L46) |
| **`bg_stop`** | `Stop a background task.` | `id` (integer, zorunlu) | [`src/tools.js:47`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L47) |
| **`web_fetch`** | `Fetch a web page or text URL and return its readable text.` | `url` (string, zorunlu)<br>`max_chars`: `default 12000` (integer) | [`src/tools.js:48-50`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L48-L50) |
| **`web_search`** | `Search the web. Returns titles, URLs and snippets.` | `query` (string, zorunlu) | [`src/tools.js:51`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L51) |
| **`todo_write`** | `Track a visible checklist ONLY for work with 3+ genuinely distinct steps, or when the user asks for a list. Do not use for single-step tasks, questions or chat. Send the FULL list each time; exactly one item in_progress until all are completed (then the list clears). Mark items completed immediately after finishing them. ORCHESTRA: give an item agent (+ prompt, optional model, depends_on ids) to assign it to a subagent; then call run_plan to execute all ready agent items in parallel waves. Items without agent are yours.` | `todos`: array of objects (`id`, `content`, `status`: enum ['pending', 'in_progress', 'completed'], `agent`, `prompt`, `model`, `depends_on`) | [`src/tools.js:52-69`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L52-L69) |
| **`use_skill`** | `Load the full instructions of a named skill.` | `name` (string, zorunlu) | [`src/tools.js:70`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L70) |
| **`spawn_agent`** | `Delegate a self-contained subtask to a subagent that starts with a fresh context. Call it several times in one response to run subagents in parallel. Returns the subagent's final report.` | `agent`: `agent name (default: general)`<br>`description`: `short 3-6 word label`<br>`prompt`: `complete, self-contained task... the subagent sees nothing else` (zorunlu) | [`src/tools.js:73-83`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L73-L83) |
| **`spawn_syzer`** | `Start an independent Syzer worker in its OWN visible Orca terminal tab (a full separate Syzer process with its own context)... Returns the worker's final report when it finishes.` | `title`: `short 2-5 word tab title`<br>`prompt`: `complete task instructions` (zorunlu)<br>`agent`: `optional agent profile name` | [`src/tools.js:85-96`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L85-L96) |
| **`run_plan`** | `Execute the orchestra plan in your todo list: runs every pending item that has an agent and whose depends_on items are completed, in parallel waves, passing dependency reports to dependents. Marks items completed automatically and returns each report. Items without agent are left for you; verify the reports and merge them yourself.` | `read_only`: `true: subagents get read-only tools (set it whenever the user said not to modify files; it is also auto-detected from their request)` | [`src/tools.js:98-103`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/tools.js#L98-L103) |

### 3.1. MCP Sunucusunun Sunduğu Araçlar (`src/mcp-server.js`)
- **`ask` (`src/mcp-server.js:15-26`):** `Ask a question to the default model of the active provider... Plain chat, no file access.`
- **`agent` (`src/mcp-server.js:28-41`):** `Run an autonomous agent with file and shell tools in a working directory and return its final report. Read-only unless allow_changes is true.`
- **`usage` (`src/mcp-server.js:43-46`):** `Show remaining free requests and credit for every saved key of the active provider.`

---

## 4. Çıktı Biçimleme ve Sunum Noktaları (Output Formatting Points)

### 4.1. Araç İcra Çıktıları (Tool Execution Outputs - Modele Dönen Metinler)
Modellerin araç çağrısı sonrasında gördüğü geri dönüş metinleri:

- **`read_file` (`src/tools.js:501`):**
  - Çıktı: `clip(slice.map((l, i) => `${start + i}\t${l}`).join('\n'))` (1-tab ile numaralandırılmış satırlar).
- **`write_file` (`src/tools.js:516`):**
  - Çıktı: `Wrote ${change.p}`
- **`edit_file` (`src/tools.js:516`):**
  - Çıktı: `Edited ${change.p} (${change.n} replacement(s)${change.fuzzy ? ', whitespace-insensitive match' : ''})`
- **`list_dir` (`src/tools.js:522`):**
  - Çıktı: `entries.map((e) => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') || '(empty)'`
- **`find_files` (`src/tools.js:528`):**
  - Çıktı: `hits.join('\n') || '(no matches)'`
- **`search_files` (`src/tools.js:540, 543`):**
  - Çıktı: `${f.rel}:${i + 1}: ${ls[i].trim().slice(0, 200)}` veya `(no matches)`
- **`run_command` (`src/tools.js:550`):**
  - Çıktı: `clip(`${out.trim()}\n[exit ${code}]`)`
- **`run_background` (`src/tools.js:554`):**
  - Çıktı: `Started background task #${e.id}: ${a.command}`
- **`bg_output` (`src/tools.js:562`):**
  - Çıktı: `clip(`[${status}]\n${fresh.trim() || '(no new output)'}`)`
- **`bg_stop` (`src/tools.js:568`):**
  - Çıktı: `Stopped #${a.id}`
- **`web_fetch` (`src/tools.js:199`):**
  - Çıktı: `HTTP ${res.status} ${url}\n\n${out}`
- **`web_search` (`src/tools.js:219`):**
  - Çıktı: `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
- **`todo_write` (`src/tools.js:590, 595`):**
  - Tüm bitti: `All ${done} tasks completed. Todo list cleared.`
  - Güncellendi: `Todo list updated: ${done}/${list.length} done, ${state}.`
- **`use_skill` (`src/tools.js:600`):**
  - Çıktı: `clip(`Skill file: ${s.file}\n\n${loadBody(s.file)}`)`
- **`spawn_agent` (`src/subagents.js:112, 118`):**
  - Başarılı: `report.length > MAX_REPORT ? report.slice(0, MAX_REPORT) + '\n…(truncated)' : report`
  - Hata: `Subagent failed: ${err.message}`
- **`spawn_syzer` (`src/orca-workers.js:106, 114, 120`):**
  - Başarılı: `report.length > 8000 ? `${report.slice(0, 8000)}\n…(truncated)` : report`
  - Hata: `WORKER FAILED after ${MAX_ATTEMPTS} attempts: ${lastErr}\nDo NOT silently do this work yourself. Tell the user this worker failed and why.`
- **`run_plan` (`src/orchestra.js:107-119`):**
  - Çıktı blokları: `### [${item.id}] ${item.content} (${item.agent}${item.model ? ' · ' + item.model : ''}) — ${ok ? 'done' : 'FAILED'}\n${trunc(String(output), MAX_REPORT)}`
  - Kuyruk direktifleri: `Failed: ...`, `Blocked: ...`, `Left for you: ...`, `All items completed; the list was cleared. Verify the reports for consistency, then write the final answer.`

### 4.2. UI Özetleri ve Gösterim Formatları (Kullanıcıya Gösterilen Satırlar)
- **Araç Etiketleri (`src/repl.js:35`):**
  - `LABEL = { read_file: 'Read', write_file: 'Write', edit_file: 'Update', list_dir: 'List', find_files: 'Find', search_files: 'Search', run_command: 'Run', use_skill: 'Skill', spawn_agent: 'Agent', run_plan: 'Plan' }`
- **Araç Satır Başlığı (`src/repl.js:96`):**
  - `${C.cyan('●')} ${C.bold(LABEL[name] || name)}${C.gray(`(${trunc(summary.replace(/\s+/g, ' '), 90)})`)}`
- **Araç Sonuç İşareti (`src/repl.js:99`):**
  - Başarılı: `  ${C.gray('⎿')} ${C.gray(ui.summary)}`
  - Başarısız: `  ${C.red('⎿')} ${C.red(ui.summary)}`
- **Diff Çizimi (`src/diff.js:68-106`):**
  - Satır numarası + işaret (`+` / `-`), yeşil/kırmızı zemin (`\x1b[48;5;22m` / `\x1b[48;5;52m`), `diffPreview` (`src/ui.js:156-164`).
- **Todo Çizimi (`src/tools.js:395-406` `renderTodos`):**
  - Tamamlandı: `    ${C.green('☑')} ${C.dim(x.content)}${tag(x)}`
  - Devam ediyor: `    ${C.cyan('▶')} ${C.bold(x.content)}${tag(x)}`
  - Hatalı: `    ${C.red('✗')} ${x.content}${tag(x)} ${C.red(String(x.error).slice(0, 60))}`
  - Beklemede: `    ${C.gray('☐')} ${x.content}${tag(x)}`
  - Katlanmış özet: `    ${C.green('☑')} ${C.dim(`${done.length} completed`)}`
- **Tur Sonu İstatistik Şeridi (`src/repl.js:393-406`):**
  - `  ╌ ctx ${pct}% · ${model} · ${tokens} tok · ${secs}s · key #${n}/${total} (${remaining}/${limit} ↓)`
- **Ajan Kartları ve Ağaç Görünümü (`src/agent-tree.js:125-142, 279-328`):**
  - Durum işaretleri (`MARK`): `queued …`, `running ●`, `done ✓`, `failed ✖`, `stopped ⚠`, `aborted ◌`.
  - 6 satırlık yuvarlak kenarlı kart kutusu (`card`).
  - Terminal panel modu (`renderPanel`) ve bitiş özeti (`renderReport`).
- **Markdown Canlı Çıktısı (`src/ui.js:105-154` `MdStream`):**
  - Paragraf başı turuncu işaret: `${C.orange('◆')} `
  - Başlıklar (`#`): `${C.bold(C.cyan(inline(text)))}`
  - Kod blokları (```): `  \x1b[48;5;236m body \x1b[0m`
  - Alıntılar (`>`): `${C.gray('▎ ')}${C.italic(inline(text))}`
  - Madde imleri (`*` / `-`): `${C.cyan('•')} ${inline(text)}`
- **Mascot Header & Frame (`src/header.js:17-73`):**
  - Zip maskotu (3D ASCII), model/dizin/sağlayıcı satırları, durum çubuğu ve izin rozeti (`⏵⏵ ask before changes · /help for commands`).

### 4.3. Headless ve CI Çıkış Formatı (Headless / JSON Contract)
- **Konum:** [`src/headless.js:44-71, 93-94`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/headless.js#L44-L71), [`bin/syzer.js:126-170`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/bin/syzer.js#L126-L170)
- **Format:**
  - Tek JSON Nesnesi (`buildResult`, `src/headless.js:44-63`):
    ```json
    {
      "ok": true,
      "exitCode": 0,
      "result": "...",
      "session": { "id": "..." },
      "usage": { "tokens": 0, "toolTurns": 0, "seconds": 0.0 },
      "files": { "changed": ["..."] },
      "content": "...",
      "model": "...",
      "key": 1
    }
    ```
  - Dosya Çıkışı (`outBody`, `src/headless.js:65-71`):
    - Hata varsa: `ERROR: ${error}`
    - Bütçe aşıldıysa: `BUDGET EXCEEDED: ${budgetExceeded}\n\n${content}`
    - Normal: `${content}` veya `(no output)`
  - Çıkış Kodları (`EXIT`, `src/headless.js:6`):
    - `0: OK`, `1: ERROR / TIMEOUT`, `2: USAGE`, `3: BUDGET`, `4: DENIED`, `130: INTERRUPTED`.

### 4.4. Oturum Dışa Aktarma Formatı (Markdown Export)
- **Konum:** [`src/export.js:8-20`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/export.js#L8-L20)
- **Format:**
  - `# ${s.title || s.id}`
  - `- Oturum: ${s.id}`, `- Model: ${s.model}`, `- Dizin: ${s.cwd}`, `- Tarih: ${iso}`
  - `## Kullanıcı\n\n${userText}`
  - `## Asistan\n\n${assistantText}\n> araç: ${toolName}`

### 4.5. Web Arayüzü Olay ve Çıktı Formatı
- **Konum:** [`src/web.js:64-82`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/web.js#L64-L82), [`src/web-ui.js:47-59`](file:///C:/Users/ROOT/orca/workspaces/SyzerCLI/syzer-A0-envanter/src/web-ui.js#L47-L59)
- **SSE Olay Tipleri:** `waiting`, `thinking`, `text`, `endText`, `tool`, `toolResult`, `warn`, `notice`, `agentStart`, `agentUpdate`, `agentDone`, `confirm`.
- **UI Render Blokları:** `.msg.user .body`, `.msg.assistant`, `.tool b`, `.tool .res`, `.agent`, `.confirm`, `.think`.

---

## 5. İyileştirme Fırsatları ve A1/A2 Mimarisine Öneriler

A0 keşfi sonucunda tespit edilen yapısal kırılganlıklar ve mimari öneriler:

1. **Dağınık İstemlerin Tek Modülde Konsolidasyonu (`src/prompts.js`):**
   - Şu anda `src/context.js`, `src/agent.js`, `src/orchestra.js`, `src/compact.js`, `src/subagents.js`, `src/cmds2.js` ve `src/repl.js` içinde string literal veya şablon dizesi olarak yer alan tüm istemler, merkezi bir `src/prompts.js` modülüne taşınmalıdır.
   - Bu modül; `systemLead()`, `systemSubagent(agent)`, `orchestraRules()`, `depContext(results)`, `todoNag(items)`, `summaryPrompt(transcript)`, `commitPrompt(diff)`, `reviewPrompt(diff)` gibi parametreli, saf fonksiyonlar sunmalıdır.

2. **Prompt Katman Mimarisi (A1 Spec İçin):**
   - **Katman 1 (Temel / Persona):** CLI ajanı kimliği, çalışma dizini, platform kuralları, dil politikası.
   - **Katman 2 (Rol / Yetki):** Lead, explore, plan, general gibi rollerin sınırları ve araç izinleri.
   - **Katman 3 (Görev Modu):** Plan modu (`[PLAN MODE]`), orkestra modu, tekil görev modu.
   - **Katman 4 (Dinamik Enjeksiyonlar):** Beceriler, talimat dosyaları, todo hatırlatmaları, önceki aşama raporları.

3. **Araç Açıklamalarının Zenginleştirilmesi:**
   - `edit_file` açıklaması modellerin girinti bozmalarını önlemek için `whitespace-insensitive` eşleşmeyi açıkça belirtmektedir ancak `edits` dizisinin sıralı uygulandığı ve tek seferde çoklu düzenleme yapılması gerektiği daha vurgulu anlatılabilir.
   - `todo_write` açıklaması oldukça ayrıntılıdır ancak token maliyeti yüksektir; orkestra kuralları ile normal kullanım kuralları ayrıştırılabilir.

4. **Çıktı Biçimleme ve Hata Yakalama Standardı:**
   - Araç dönüşlerinde hata mesajları bazen düz string, bazen JSON hatası olarak dönmektedir. Standart bir `{ ok: boolean, output: string, ui?: { summary, body } }` sözleşmesi kesinleştirilmelidir.
   - Alt ajanların ve orkestra dalgalarının raporlama boyutu sınırları (`MAX_REPORT = 3500`, `MAX_DEP_CONTEXT = 2500`, `MAX_OUT = 20000`) merkezi bir konfigürasyondan okunmalıdır.

5. **A3 Altın (Golden) Testleri Hazırlığı:**
   - `src/prompts.js` dışa aktarımı tamamlandığında, `test/prompts-golden.test.js` altında her prompt üreticisinin beklenen anahtar kelimeleri, yapısal blokları ve dil değişkenlerini doğru ürettiği test edilmelidir.

---

## 6. Doğrulama ve Kabul Kriteri Kanıtı

- **Yazma Seti:** Yalnızca `docs/syzer-iyilestirme/A0-ENVANTER.md`.
- **Kod Değişikliği Denetimi:** `git status` ve `git diff --stat` ile hiçbir `.js` veya kod dosyasına dokunulmadığı kanıtlanmıştır.
- **Her Parça İçin Dosya ve Satır Numarası:** Belgede listelenen tüm referanslar `dosya:satır` biçiminde doğrulanmıştır.
