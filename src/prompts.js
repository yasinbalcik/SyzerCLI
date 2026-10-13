'use strict';

// Tüm sistem istemleri, dinamik istem ekleri, araç açıklamaları ve hata metinleri tek yerde.
// Saf: dosya sistemi, saat, oturum veya model çağrısı yok; girdi nesneleri değiştirilmez.
// Katman sırası: [BASE] → [ROLE:x] → [MODE:x] → [DYNAMIC] (kaynak yoksa DYNAMIC hiç eklenmez).

const { LIMITS } = require('./limits');

const SUMMARY_TAG = '[Conversation summary]';
const REMINDER_TAG = '[system reminder]';

const text = (language) => (language === 'tr' ? 'tr' : 'en');
const NAMES = { en: 'English', tr: 'Turkish', de: 'German', es: 'Spanish', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', pl: 'Polish' };
const langName = (language) => NAMES[language] || 'English';
const join = (parts) => parts.filter(Boolean).join('\n\n');
const q = (items) => items.map((x) => `"${x.content}" (${x.status})`).join(', ');
// Limit aşılırsa başı korur, sona …(truncated) ekler (tüm kırpmalarla aynı biçim)
const clip = (s, n) => { s = String(s); return s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s; };

// ---------- 1) base ----------

function base({ cwd, platform, language } = {}) {
  cwd = typeof cwd === 'string' && cwd ? cwd : '.';
  platform = typeof platform === 'string' && platform ? platform : 'unknown';
  const shell = platform === 'win32' ? 'PowerShell' : 'sh';
  if (text(language) === 'tr') {
    return [
      '[BASE]',
      'Sen SyzerCLI\'sin: kullanıcının terminalinde çalışan genel amaçlı bir kodlama ajanı.',
      `Çalışma dizini: ${cwd}`,
      `Platform: ${platform}. run_command kabuğu: ${shell}.`,
      `Yanıt dili: Türkçe; kullanıcı başka dilde yazarsa o dile uy. Araç adları, JSON anahtarları, yollar ve kod değişmez.`,
      'Tahmin etmek yerine araçlarla incele ve değiştir. Düzenlemeden önce dosyayı oku. Küçük değişiklikler için edit_file (birden çoğu edits ile), yeni dosyalar için write_file kullan. Kısa yanıt ver, neyi doğruladığını söyle. ' +
        'Güncel bilgi için web_search/web_fetch, sunucu ve uzun komutlar için run_background kullan.',
    ].join('\n');
  }
  return [
    '[BASE]',
    'You are SyzerCLI, a coding and general-purpose agent in the user\'s terminal.',
    `Working directory: ${cwd}`,
    `Platform: ${platform}. Shell for run_command: ${shell}.`,
    `Reply in ${langName(language)} unless the user writes in another language. Keep tool names, JSON keys, paths and code unchanged.`,
    'Use tools to inspect and change files instead of guessing. Read a file before editing it. Prefer edit_file for focused changes (several at once via edits) and write_file for new files. ' +
      'Keep answers concise and say what you verified. Use web_search/web_fetch for current information and run_background for servers or long commands.',
  ].join('\n');
}

// ---------- 2) role ----------

const ROLES = {
  en: {
    lead: 'You own the user\'s task and the final synthesis. Use todo_write only for 3+ genuinely distinct steps (or when asked), never for one-step tasks, questions or chat. ' +
      'Keep exactly one item in_progress, mark items completed right after finishing, and do not end your turn with unfinished items.\n' +
      'Delegate independent or exploratory subtasks with spawn_agent. Subagents start with a fresh context and see only their prompt, so make it self-contained; call spawn_agent several times in ONE response to run them in parallel. Do trivial work yourself. Verify reports before presenting them.\n' +
      'ORCHESTRA (only for 3+ separable pieces): write the todo_write plan FIRST, each item with id, agent, self-contained prompt and depends_on ids (independent items run in parallel; later items get the reports they depend on); optional per-item model. ' +
      'Copy user constraints (read-only, language, scope) into every agent prompt and use read-only agents (explore, plan) for analysis. Never do an agent item yourself: call run_plan, which runs ready items in waves, retries a stalled agent once and marks items completed. ' +
      'The final synthesis is YOURS: add it as a last item WITHOUT an agent.',
    explore: 'You are a read-only exploration agent: you can only list, find, search and read files. Never modify anything. ' +
      'Investigate thoroughly but efficiently, then report concrete findings (file paths, line numbers, short quotes).',
    plan: 'You are a read-only planning agent. Study the relevant code, then return a concise numbered plan listing the exact files to change and the risks. Do not modify anything.',
    general: 'You are a worker agent. Complete the assigned task fully using your tools, then give a concise final report: what you did and the result.',
    summary: 'You compress conversations into faithful working summaries. Only compress; do not continue the work. ' +
      'Keep the user\'s goals, decisions, files touched, open TODOs and commands that matter.',
  },
  tr: {
    lead: 'Kullanıcının görevi ve son sentez sana ait. todo_write yalnızca 3+ gerçekten ayrı adım için (veya istenince); tek adımlı iş, soru ve sohbet için asla. ' +
      'Tam olarak bir madde in_progress olsun, biten maddeyi hemen completed yap, bitmemiş maddeyle turu kapatma.\n' +
      'Bağımsız veya keşif alt görevlerini spawn_agent ile devret. Alt ajanlar boş bağlamla başlar ve yalnızca istemini görür; istemi kendi içinde eksiksiz yaz. Paralel için spawn_agent\'ı TEK yanıtta birkaç kez çağır. Önemsiz işi kendin yap. Raporları sunmadan önce doğrula.\n' +
      'ORCHESTRA (yalnızca 3+ ayrık parça): önce todo_write planını yaz; her madde id, agent, eksiksiz prompt ve depends_on içersin (bağımsızlar paralel koşar; sonrakiler bağlı oldukları raporları alır); isteğe bağlı madde başına model. ' +
      'Kullanıcı kısıtlarını (salt-okunur, dil, kapsam) her ajan istemine kopyala; analiz için salt-okunur ajanları (explore, plan) kullan. Ajan maddesini asla kendin yapma: run_plan hazır maddeleri dalgalar halinde koşar, takılan ajanı bir kez yeniden dener, maddeleri completed yapar. ' +
      'Son sentez SENİN: ajansız son madde olarak ekle.',
    explore: 'Sen bir keşif ajanısın. Yalnızca okuyabilirsin: dosyaları listele, bul, ara ve oku. Hiçbir şeyi değiştirme. ' +
      'Kapsamlı ama verimli incele; somut bulguları raporla (file paths, line numbers, kısa alıntılar).',
    plan: 'Sen bir planlama ajanısın. Yalnızca okuyabilirsin. İlgili kodu incele, sonra değişecek exact files ve risks içeren kısa numaralı plan (numbered plan) döndür. Hiçbir şeyi değiştirme.',
    general: 'Sen bir işçi ajansın. Atanan görevi (assigned task) araçlarınla tam bitir, sonra kısa bir son rapor ver: ne yaptın ve sonuç.',
    summary: 'Konuşmaları sadık (faithful) çalışma özetlerine sıkıştırırsın. Yalnızca sıkıştır; işe devam etme. ' +
      'Kullanıcının hedeflerini, kararları, dokunulan dosyaları, açık TODO\'ları ve önemli komutları koru.',
  },
};

function role({ name, tools, agents, language } = {}) {
  const body = (ROLES[text(language)][name]) || '';
  const parts = [`[ROLE:${name}]`, body];
  if (tools && tools.length) parts.push(`${text(language) === 'tr' ? 'İzinli araçlar' : 'Allowed tools'}: ${tools.join(', ')}.`);
  if (agents && agents.length) {
    parts.push(`${text(language) === 'tr' ? 'Kullanılabilir ajanlar' : 'Available agents'}:\n${agents.map((a) => `- ${a.name}: ${String(a.description || '').slice(0, 140)}`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n');
}

// ---------- 3) task mode ----------

const PLAN_LINE = {
  en: '[PLAN MODE] Use read-only tools only. Do NOT modify anything. Investigate, then answer with a concise numbered plan and ask for approval at the end.',
  tr: '[PLAN MODE] Yalnızca salt-okunur (read-only) araçları kullan. Hiçbir şeyi değiştirme. İncele, sonra kısa numaralı plan (numbered plan) ver ve sonunda onay (approval) iste.',
};
const MODES = {
  en: {
    normal: 'Act on the task with tools, then report briefly.',
    orchestra: 'You are executing an orchestra plan: run_plan runs the agent items; you verify and synthesize.',
    summary: 'Summarize faithfully; do not continue the task or call tools.',
  },
  tr: {
    normal: 'Görevi araçlarla yürüt, sonra kısaca raporla.',
    orchestra: 'Bir orkestra planı yürütüyorsun: ajan maddelerini run_plan koşar; sen doğrular ve sentezlersin.',
    summary: 'Sadık özetle; göreve devam etme, araç çağırma.',
  },
};

function taskMode(input) {
  const o = typeof input === 'string' ? { mode: input } : (input || {});
  const mode = o.mode || 'normal';
  const L = text(o.language);
  if (mode === 'plan') return `[MODE:plan]\n${PLAN_LINE[L]}`;
  return `[MODE:${mode}]\n${MODES[L][mode] || MODES[L].normal}`;
}

// Kullanıcı mesajının önüne eklenen plan modu öneki (ilk satır + boş satır; eski [PLAN MODE] biçimi)
const planPrefix = (language) => `${PLAN_LINE[text(language)]}\n\n`;

// ---------- 4) dynamic ----------

const DEP_TEXT = { en: 'Results from earlier steps you depend on:', tr: 'Bağlı olduğun önceki adımların sonuçları:' };

// results: [{ id, report }] veya Map(id → report) (bağımlılık sırasıyla). Her rapor merkezi limitle kırpılır; boşsa ''.
function dependencyContext(results, { limit = LIMITS.dependencyContext, language } = {}) {
  const list = results instanceof Map ? [...results].map(([id, report]) => ({ id, report })) : (results || []);
  const parts = list.map((r) => `### Result of [${r.id}]\n${clip(r.report, limit)}`);
  return parts.length ? `---\n${DEP_TEXT[text(language)]}\n${parts.join('\n\n')}` : '';
}

function orchestraRules({ language } = {}) {
  return text(language) === 'tr'
    ? '(Kurallar: yalnızca bu atamayı (assignment) yap. Yukarıdaki atama o dosyayı yazmanı açıkça söylemedikçe hiçbir dosyayı oluşturma, değiştirme veya silme. Son mesajın kısa bir rapor olsun.)'
    : '(Rules: do only this assignment. Do NOT create, modify or delete any file unless the assignment above explicitly tells you to write that file. Finish with a concise report as your final message.)';
}

function retryNotice({ why, language } = {}) {
  return text(language) === 'tr'
    ? `(Önceki denemen (previous attempt) şu yüzden olmadı: ${why}. Verimli ol: yalnızca gerekeni oku, sonra son raporunla bitir.)`
    : `(Your previous attempt ${why}. Be efficient: read only what you need, then finish with your final report.)`;
}

function todoReminder(items, { language } = {}) {
  return text(language) === 'tr'
    ? `${REMINDER_TAG} Todo listende tamamlanmamış maddeler (unfinished items) var: ${q(items)}. Turu bitirmeden önce bunları bitir (ajan maddeleri için run_plan çağır) veya todo_write ile listeyi güncelle (bitti/kaldır). Bu hatırlatmadan kullanıcıya söz etme.`
    : `${REMINDER_TAG} Your todo list still has unfinished items: ${q(items)}. Finish them (call run_plan for agent items), or update the list with todo_write (mark done/remove) before ending your turn. Do not mention this reminder to the user.`;
}

// kind: 'stop' (headless/özet metni) | 'assistant' (ana oturum geçmişi notu) | 'subagent' (alt ajan çıktısı eki)
function budgetNotice({ kind, reason }) {
  if (kind === 'assistant') return `[budget exceeded: ${reason}. Stopped after the last tool batch; the user may continue.]`;
  if (kind === 'subagent') return `[budget exceeded: ${reason}; stopped early]`;
  return `${reason}. Reply to continue (counters reset on your next prompt) or raise the limit with /budget.`;
}

// Kaynak yoksa '' (katman hiç eklenmez). todo: madde dizisi; dependencies: [{id, report}]; retry: why metni veya { why }; budget: hazır metin.
function dynamic({ skills, instructionFiles, todo, dependencies, retry, budget, language } = {}) {
  const parts = [];
  if (skills && skills.length) {
    parts.push('Available skills (call the use_skill tool with the exact name to load full instructions when relevant):\n' +
      skills.slice(0, 40).map((s) => `- ${s.name}: ${String(s.description || '').slice(0, 140)}`).join('\n'));
  }
  for (const f of instructionFiles || []) parts.push(`--- ${f.path} ---\n${f.text}`);
  if (todo && todo.length) parts.push(todoReminder(todo, { language }));
  if (dependencies && dependencies.length) parts.push(dependencyContext(dependencies, { language }));
  if (retry) parts.push(retryNotice({ why: typeof retry === 'object' ? retry.why : retry, language }));
  if (budget) parts.push(String(budget));
  return parts.length ? `[DYNAMIC]\n${parts.join('\n\n')}` : '';
}

// ---------- doğrulama kapısı, şartname kontrol listesi, zayıf model iskelesi, traceback ipucu ----------

const AGAIN = {
  en: 'Do not mention this reminder to the user.',
  tr: 'Bu hatırlatmadan kullanıcıya söz etme.',
};

// Test komutu başarısız: çıktı özeti modele geri verilir; tur devam eder
function verifyFailure({ command, code, output, attempt, max, language } = {}) {
  const hint = tracebackHint(output, { language });
  const head = text(language) === 'tr'
    ? `${REMINDER_TAG} Bitirmeden önce testi çalıştırdım ve BAŞARISIZ oldu (deneme ${attempt}/${max}). Komut: ${command} (çıkış kodu ${code}). Kendi kodundaki hatayı düzelt, sonra testi tekrar çalıştır; testler geçmeden "bitti" deme.`
    : `${REMINDER_TAG} Before finishing I ran the tests and they FAILED (attempt ${attempt}/${max}). Command: ${command} (exit code ${code}). Fix the bug in your own code, then run the tests again; do not say "done" until they pass.`;
  return join([head, `Output:\n${clip(output, 2500)}`, hint, AGAIN[text(language)]]);
}

// Deneme hakkı bitti: kullanıcıya gösterilen son rapor eki
function verifyGaveUp({ command, attempts, output, language } = {}) {
  const last = String(output || '').trim().split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300);
  return text(language) === 'tr'
    ? `[doğrulama başarısız] ${attempts} düzeltme denemesinden sonra testler hâlâ geçmiyor (${command}). Görev tamamlanmış sayılmamalı. Son çıktı: ${last}`
    : `[verification failed] Tests still fail after ${attempts} fix attempts (${command}). Do not treat the task as complete. Last output: ${last}`;
}

const REQ_KEY = /\b(must|should|shall|required|never|always|raises?|returns?|exits?|prints?|accepts?|rejects?)\b|zorunlu|olmalı|olmamalı|gerek|fırlat|döndür|hata ver|çıkış kodu|yazdır|geçersiz/i;

// Görev metninden gereksinim listesi: önce madde işaretli satırlar, azsa anahtar kelimeli cümleler
function requirementsFrom(src, { max = 15 } = {}) {
  const lines = String(src || '').split(/\r?\n/);
  const items = [];
  const add = (s) => {
    const v = s.replace(/[*`#]|__/g, '').replace(/\s+/g, ' ').trim();
    if (v.length >= 8 && !items.includes(v)) items.push(v.length > 200 ? `${v.slice(0, 200)}…` : v);
  };
  for (const l of lines) { const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+\S)\s*$/.exec(l); if (m) add(m[1]); }
  if (items.length < 3) {
    for (const l of lines) for (const s of l.split(/(?<=[.!?])\s+/)) if (REQ_KEY.test(s) && s.length < 240) add(s);
  }
  return items.slice(0, max);
}

// Bitirmeden önce her maddeye kanıt iste (tur başına bir kez)
function requirementsCheck(reqs, { language } = {}) {
  const list = (reqs || []).map((r, i) => `${i + 1}. ${r}`).join('\n');
  return text(language) === 'tr'
    ? `${REMINDER_TAG} Bitirmeden önce görev şartnamesi:\n${list}\nHer numaralı madde için TEK satır kanıt ver: onu kanıtlayan test adı/komut çıktısı veya dosya:satır. Kanıtı olmayan madde için iddia etme; şimdi testini yaz/çalıştır. Hepsi kanıtlıysa kontrol listesini ve kısa son raporu yaz. ${AGAIN.tr}`
    : `${REMINDER_TAG} Before you finish, the task requirements were:\n${list}\nFor EACH numbered item give ONE line of evidence: the test name or command output that proves it, or file:line. Do not claim an item without evidence; write or run its check now. If every item is evidenced, reply with the checklist and a short final report. ${AGAIN.en}`;
}

// Zayıf/küçük model profili: sistem istemine eklenen adım adım çalışma bloğu
function scaffold({ language } = {}) {
  return text(language) === 'tr'
    ? ['[SCAFFOLD]',
      'Küçük, doğrulanmış adımlarla çalış:',
      '1. Uygulama kodunu yazmadan önce şartnamedeki gereksinimler için testleri yaz (sınır durumları ve hata yolları dahil) ve bir kez çalıştırıp doğru nedenle başarısız olduğunu gör.',
      '2. Adım başına TEK dosya veya TEK küçük değişiklik yaz. Her write_file/edit_file sonrası testleri run_command ile çalıştır ve sonucu oku; sonra sonraki adıma geç.',
      '3. Test başarısızsa önce kendi uygulamanı düzelt; testi yalnızca görev metniyle çelişiyorsa değiştir.',
      '4. Tam test komutu bu oturumda çalışıp geçmeden "bitti" deme. Gerçek komutu ve geçen test sayısını raporla.',
      '5. Adımları kısa tut; küçük düzenleme yetiyorsa dosyayı baştan yazma.'].join('\n')
    : ['[SCAFFOLD]',
      'Work in small, verified steps:',
      '1. Before writing implementation code, write tests for the stated requirements (edge cases and error paths included) and run them once to see them fail for the right reason.',
      '2. Write ONE file or ONE small change per step. After every write_file/edit_file, run the tests with run_command and read the result before the next step.',
      '3. If a test fails, fix your own implementation first; change a test only when it contradicts the task text.',
      '4. Never say "done" until the full test command has run and passed in this session. Report the exact command and the pass count.',
      '5. Keep steps short; do not rewrite a whole file when a small edit is enough.'].join('\n');
}

const TB_KINDS = 'AttributeError|ImportError|ModuleNotFoundError|NameError|UnboundLocalError|TypeError|SyntaxError|IndentationError|ReferenceError|NotImplementedError';
const TB_FOREIGN = /site-packages|dist-packages|[\\/]lib[\\/]python|[\\/]Lib[\\/]|<frozen|node_modules|node:internal|<string>/i;

// Tool çıktısında kodun kendi hatası (AttributeError, ImportError, NameError…) varsa düzeltme ipucu; yoksa ''
function tracebackHint(output, { language } = {}) {
  const s = String(output || '');
  const m = new RegExp(`^\\s*(?:E\\s+)?(?:[\\w.]+\\.)?(${TB_KINDS}): .+$`, 'm').exec(s);
  if (!m) return '';
  if (!/Traceback \(most recent call last\)|^\s*File ".+", line \d+|^\s+at .+:\d+:\d+/m.test(s)) return ''; // düz metin içinde geçen ad: ipucu verme
  const frames = [...s.matchAll(/File "(.+?)", line (\d+)/g)].filter((f) => !TB_FOREIGN.test(f[1]));
  const last = frames[frames.length - 1];
  const where = last ? ` (${String(last[1]).split(/[\\/]/).pop()}:${last[2]})` : '';
  return text(language) === 'tr'
    ? `[ipucu] ${m[1]} büyük olasılıkla KENDİ kodundaki bir hata${where}: eksik öznitelik/ad/import/imza. O dosya ve satırı oku, uygulamayı düzelt, sonra yeniden çalıştır. Hatayı gizlemek için testi değiştirme; yerel modül için paket kurmaya çalışma.`
    : `[hint] ${m[1]} is most likely a bug in YOUR code${where}: a missing attribute, name, import or signature. Read that file and line, fix the implementation, then re-run. Do not edit the test to hide it, and do not try to install a package for a local module.`;
}

// ---------- birleşik sistem istemleri ----------

// input: { cwd, platform, language, mode, agents, skills, instructionFiles, todo, dependencies, retry, budget }
function leadSystem(input = {}) {
  return join([
    base(input),
    role({ name: 'lead', agents: input.agents, language: input.language }),
    taskMode({ mode: input.mode || 'normal', language: input.language }),
    dynamic(input),
  ]);
}

// Sade mod (küçük/yerel modeller): kısa istem, orkestrasyon yok, yalnızca temel dosya/kabuk araçları
function simpleSystem(input = {}) {
  const tr = text(input.language) === 'tr';
  const rules = tr ? [
    '[SIMPLE]',
    'Kodu doğrudan sen yaz. Dosya oluşturmak için write_file, değiştirmek için edit_file, okumak için read_file, listelemek için list_dir, komut için run_command kullan.',
    'Bir aracı çağırmak için yalnızca araç çağrısını gönder; çağrıyı metin olarak anlatma.',
    'Bir dosyayı yazdım demeden önce write_file çağrısını gerçekten yap. Yapmadığın işi yapılmış gibi raporlama.',
    'İş bitince kısaca neyi oluşturduğunu/değiştirdiğini dosya yollarıyla söyle.',
  ] : [
    '[SIMPLE]',
    'Write the code yourself. Use write_file to create files, edit_file to change them, read_file to read, list_dir to list, run_command for shell commands.',
    'To use a tool, emit the tool call itself; do not describe the call in prose.',
    'Never claim a file was written unless you actually called write_file. Do not report work you did not do.',
    'When done, briefly list the files you created or changed.',
  ];
  const files = (input.instructionFiles || []).map((f) => `--- ${f.path} ---\n${f.text}`);
  return join([base(input), rules.join('\n'), files.length ? files.join('\n\n') : '']);
}

// ctx.header = base katmanı; builtin ajanın prompt'u zaten [ROLE:x] ile başlar
function subagentSystem({ ctx, agent, language } = {}) {
  const rolePart = String(agent.prompt || '').startsWith('[ROLE:') ? agent.prompt : `[ROLE:${agent.name}]\n${agent.prompt || ''}`;
  const hierarchy = text(language) === 'tr'
    ? 'Sen bir lead agent için çalışan alt ajansın. Kullanıcıya soru soramazsın. Görevi bitir, sonra kısa bir son rapor ver (bulgular, dosya yolları, sonuçlar). Lead yalnızca bu raporu gör. Sabit sözleşme etiketleri: subagent working for a lead agent; cannot ask the user questions; Turkish report.'
    : 'You are a subagent working for a lead agent. You cannot ask the user questions. Finish the task, then reply with a concise final report (findings, file paths, results). The lead only sees that report.';
  const report = NAMES[language]
    ? (text(language) === 'tr' ? 'Son raporunu Türkçe yaz.' : `Write your final report in ${NAMES[language]}.`)
    : 'Write your final report in the same language as the task.';
  const files = (ctx.files || []).map((f) => `--- ${f.path} ---\n${f.text}`);
  return join([ctx.header, `${rolePart}\n${hierarchy}\n${report}`, ...files]);
}

// ---------- özetleme ----------

const summarySystem = () => role({ name: 'summary' });
const summaryAck = () => 'Understood. I will continue from this summary.';
function summaryPrompt({ transcript, hint } = {}) {
  return 'Summarize this conversation so work can continue without it. Cover: the user\'s goals, decisions made, files touched (with paths), ' +
    `open TODOs / next steps, and commands run with results that matter. Dense and factual, no preamble, at most ~${LIMITS.summaryWords} words.` +
    `${hint ? `\nExtra focus: ${hint}` : ''}\n\n${transcript}`;
}

// ---------- araç açıklamaları (şema/parametre adları tools.js'te kalır) ----------

const TOOLS = {
  read_file: 'Read a text file. Returns numbered lines.',
  write_file: 'Create or overwrite a file with the given content.',
  edit_file: 'Replace exact text in one file. Read the file first. Use either old_string/new_string or edits:[{old_string,new_string}] for several changes; edits are applied in order. ' +
    'Each old_string must match exactly once unless replace_all=true. If matching fails, re-read and copy current text; whitespace-insensitive fallback may be reported, but do not use it to guess. ' +
    'Keep changes focused and preserve surrounding content.',
  list_dir: 'List files and folders in a directory.',
  find_files: 'Find files by glob pattern (supports * ** ?), e.g. "src/**/*.js".',
  search_files: 'Search file contents with a regular expression. Returns file:line: text.',
  run_command: 'Run a shell command in the working directory and wait for its output.',
  run_background: 'Start a long-running command (dev server, watcher, long test run) in the background. Returns a task id.',
  bg_output: 'Read new output of a background task and see whether it is still running.',
  bg_stop: 'Stop a background task.',
  web_fetch: 'Fetch a web page or text URL and return its readable text.',
  web_search: 'Search the web. Returns titles, URLs and snippets.',
  todo_write: 'Use only for 3+ genuinely distinct steps or when the user asks for a checklist. Send the full list every time; use exactly one in_progress item and mark it completed immediately. ' +
    'For orchestra work, set agent, prompt, and depends_on on delegated items, then call run_plan. Do not use it for a one-step task, a question, or chat.',
  use_skill: 'Load the full instructions of a named skill.',
  memory_save: 'Save one durable fact about the user or project that future sessions need and that the code or git history does not already record ' +
    '(user preferences, corrections, project decisions and constraints, pointers to external resources). Not for task progress, code structure, or anything derivable from the repo. ' +
    'NEVER save secrets, API keys, tokens or passwords. One fact per name; saving an existing name overwrites it.',
  memory_forget: 'Delete a saved memory by name when it is wrong, outdated, or the user asks you to forget it.',
  spawn_agent: 'Delegate a self-contained subtask to a subagent that starts with a fresh context. ' +
    'Call it several times in one response to run subagents in parallel. Returns the subagent\'s final report. ' +
    'Set isolation: "worktree" for risky or parallel write tasks in a git repo: it works in a separate worktree/branch; changes are kept unmerged and the report gives path, branch and diff stat (tell the user).',
  spawn_syzer: 'Start an independent Syzer worker in its OWN visible Orca terminal tab (a full separate Syzer process with its own context). ' +
    'Use for larger parallel jobs the user should be able to watch. Call it several times in one response to run workers in parallel. ' +
    'Returns the worker\'s final report when it finishes.',
  run_plan: 'Execute the orchestra plan in your todo list: runs every pending item that has an `agent` and whose depends_on items are completed, in parallel waves, passing dependency reports to dependents. ' +
    'Marks items completed automatically and returns each report. Items without `agent` are left for you; verify the reports and merge them yourself.',
};

function toolDescription(name) {
  if (!Object.prototype.hasOwnProperty.call(TOOLS, name)) throw new Error(`no description for tool: ${name}`);
  return TOOLS[name];
}

// ---------- hata ve araç sonucu sözleşmesi ----------

// Tek satır: ERR_<CODE>: <detail>[. <hint>]. Stack trace/çok satırlı metin eklenmez.
function error(code, detail, hint) {
  const one = (v) => String(v && v.message !== undefined ? v.message : v).split('\n')[0].replace(/\s+/g, ' ').trim();
  const d = one(detail === undefined || detail === null ? '' : detail);
  const h = hint ? one(hint) : '';
  return h ? `ERR_${code}: ${d.replace(/\.$/, '')}. ${h}` : `ERR_${code}: ${d}`;
}

// Girdiyi değiştirmez; ok boolean, output string ('(no output)' boşsa), ui yalnızca verilmişse. Ek alanlar korunur.
function formatToolResult(r = {}) {
  const { ok, output, ui, ...rest } = r;
  const out = output === undefined || output === null ? '' : String(output);
  return { ...rest, ok: !!ok, output: out.trim() ? out : '(no output)', ...(ui ? { ui } : {}) };
}

// Standart hata sonucu: modele ERR_ satırı, kullanıcı arayüzüne okunur özet (ERR_ öneksiz)
function failure(code, detail, hint, extra = {}) {
  const output = error(code, detail, hint);
  return formatToolResult({ ...extra, ok: false, output, ui: { summary: output.replace(/^ERR_[A-Z_]+: /, '') } });
}

module.exports = {
  simpleSystem,
  verifyFailure, verifyGaveUp, requirementsFrom, requirementsCheck, scaffold, tracebackHint,
  base, role, taskMode, planPrefix, dynamic, leadSystem, subagentSystem,
  todoReminder, orchestraRules, dependencyContext, retryNotice, budgetNotice,
  summarySystem, summaryPrompt, summaryAck, toolDescription,
  error, formatToolResult, failure, SUMMARY_TAG, REMINDER_TAG,
};
