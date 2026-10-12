'use strict';

// Headless / CI sözleşmesi: çıkış kodları, istem kaynağı önceliği, JSON sonuç, bloklamayan izin çözümü.
// Saf yardımcılar; bin/syzer.js printMode bunları kullanır. Etkileşimli (REPL) davranışa dokunmaz.

const EXIT = { OK: 0, ERROR: 1, USAGE: 2, BUDGET: 3, DENIED: 4, INTERRUPTED: 130 };

// Öncelik: zaman aşımı/kesinti > kullanım hatası > genel hata > bütçe > izin reddi > başarı
function exitCodeFor({ error, usageError, budgetExceeded, denied, interrupted, timedOut } = {}) {
  if (interrupted) return EXIT.INTERRUPTED;
  if (timedOut) return EXIT.ERROR;
  if (usageError) return EXIT.USAGE;
  if (error) return EXIT.ERROR;
  if (budgetExceeded) return EXIT.BUDGET;
  if (denied) return EXIT.DENIED;
  return EXIT.OK;
}

// İstem kaynağı: --prompt-file > --prompt > konumsal argümanlar > stdin.
// `-` konumsal argümanı ya da (istem yoksa) TTY olmayan stdin → stdin okunur.
// --prompt-file ile stdin yalnızca açık `-` verilirse okunur (CI'da asılmayı önler).
function resolvePromptSource({ promptFile, prompt, positional = [], stdinIsTTY = true } = {}) {
  const pos = positional.filter((x) => x !== '-');
  const dash = positional.includes('-');
  if (promptFile) return { source: 'file', readStdin: dash && !stdinIsTTY, args: pos.join(' ') };
  if (prompt) return { source: 'flag', readStdin: !stdinIsTTY, args: [prompt, ...pos].join(' ') };
  if (pos.length) return { source: 'args', readStdin: !stdinIsTTY, args: pos.join(' ') };
  if (dash || !stdinIsTTY) return { source: 'stdin', readStdin: !stdinIsTTY, args: '' };
  return { source: 'none', readStdin: false, args: '' };
}

// Dosya/flag/arg metni ile stdin metnini birleştirir
const joinPrompt = (base, stdinText) => [String(base || '').trim(), String(stdinText || '').trim()].filter(Boolean).join('\n\n');

// TTY olmayan çalıştırmada onay sorusu bloklamaz: -y → izin, değilse ret
const headlessConfirm = (yes) => async () => (yes ? 'yes' : 'no');

// Araç sonucu metni bir izin reddi mi? (i18n: readonly_block / denied)
function isDenial(text, strings) {
  const s = String(text || '').trim();
  return !!s && (strings || []).some((x) => x && s === x);
}

function buildResult({ content, error, budgetExceeded, exitCode, sessionId, tokens, toolTurns, ms, changed, model, key, timedOut }) {
  const o = {
    ok: exitCode === 0,
    exitCode,
    result: content || '',
    ...(error ? { error } : {}),
    ...(budgetExceeded ? { budgetExceeded } : {}),
    ...(timedOut ? { timedOut: true } : {}),
    session: { id: sessionId || null },
    usage: { tokens: tokens || 0, toolTurns: toolTurns || 0, seconds: Math.round((ms || 0) / 100) / 10 },
  };
  if (Array.isArray(changed)) o.files = { changed };
  // eski alanlar (geriye dönük uyum)
  o.content = o.result;
  if (model) o.model = model;
  if (typeof tokens === 'number') o.tokens = tokens;
  if (typeof key === 'number') o.key = key;
  if (typeof ms === 'number') o.ms = ms;
  return o;
}

// --out dosyası sözleşmesi (orca-workers): hata `ERROR: ...` ile başlar
function outBody({ content, error, budgetExceeded }) {
  if (error) return `ERROR: ${error}`;
  const bx = budgetExceeded ? `BUDGET EXCEEDED: ${budgetExceeded}` : '';
  const body = bx ? `${bx}${content ? `\n\n${content}` : ''}` : content;
  return body || '(no output)';
}

// --timeout-minutes: geçersiz → undefined, boş/yok → null (kapalı), pozitif sayı → ms
function parseTimeoutMs(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) return undefined;
  return Math.round(Number(s) * 60000);
}

// Bu çalıştırmada değişen dosyalar (checkpoint deposu, yalnızca okuma). Kullanılamazsa null.
function changedFiles(store, ids) {
  try {
    const set = new Set();
    for (const id of ids) {
      if (!id) continue;
      for (const turn of store.list(id)) for (const f of turn.files || []) set.add(f.path);
    }
    return [...set];
  } catch { return null; }
}

const EXIT_HELP = `exit codes (headless: --prompt / --prompt-file / piped stdin): 0 ok  1 error / TIMEOUT  2 usage or config  3 budget exceeded  4 tool denied (no -y)  130 interrupted
prompt source: --prompt-file > --prompt > args > stdin ("-" or piped); --json prints one JSON object; --quiet = only result on stdout; --timeout-minutes N`;

module.exports = { EXIT, exitCodeFor, resolvePromptSource, joinPrompt, headlessConfirm, isDenial, buildResult, outBody, parseTimeoutMs, changedFiles, EXIT_HELP };
