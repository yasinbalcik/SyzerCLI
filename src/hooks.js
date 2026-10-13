'use strict';

const { spawn } = require('child_process');
const { CLAUDE_NAME } = require('./permissions');

function matches(matcher, name) {
  if (!matcher || matcher === '*') return true;
  const names = [name, CLAUDE_NAME[name]].filter(Boolean);
  try { const re = new RegExp(`^(?:${matcher})$`, 'i'); return names.some((n) => re.test(n)); }
  catch { return names.includes(matcher); }
}

function runCommand(command, input, cwd, timeoutSec) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`], { cwd }) // -Command yerel çıkış kodunu (2 = engelle) aktarmaz
      : spawn('sh', ['-c', command], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); stderr += '\n[hook timeout]'; }, timeoutSec * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    try { child.stdin.end(JSON.stringify(input)); } catch { /* hook stdin okumadı */ }
  });
}

// SYZER_HOOKS=off|0|false → tüm kancalar kapalı
function disabled() {
  return /^(off|0|false|no)$/i.test(String(process.env.SYZER_HOOKS || '').trim());
}

const EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'PreCompact', 'SubagentStop'];

function listFor(settings, event) {
  const l = settings && settings.hooks && settings.hooks[event];
  return Array.isArray(l) ? l : [];
}

// Araç dışı olaylar için matcher: verilen değere (örn. PreCompact: manual|auto, SubagentStop: ajan adı) karşı regex.
// Değer verilmediyse matcher yok sayılır.
function matchesValue(matcher, value) {
  if (!matcher || matcher === '*' || value === undefined || value === null) return true;
  try { return new RegExp(`^(?:${matcher})$`, 'i').test(String(value)); }
  catch { return String(value) === matcher; }
}

// Genel olay çalıştırıcı. stdout (çıkış 0) → bağlam; çıkış 2 → block + stderr mesajı.
// Dönüş: { block, message, context }. Kanca yoksa/kapalıysa sıfır maliyet.
async function fire(settings, event, payload, cwd, matchValue) {
  const none = { block: false, message: '', context: '' };
  if (disabled()) return none;
  const list = listFor(settings, event);
  if (!list.length) return none;
  const ctx = [];
  let block = false;
  let message = '';
  for (const h of list) {
    if (!matchesValue(h.matcher, matchValue)) continue;
    const r = await runCommand(h.command, { ...(payload || {}), hook_event_name: event, cwd }, cwd, h.timeout || 30);
    if (r.code === 2) {
      block = true;
      message = (r.stderr || r.stdout || 'blocked by hook').trim().slice(0, 1500);
      break;
    }
    const out = String(r.stdout || '').trim();
    if (r.code === 0 && out) ctx.push(out.slice(0, 4000));
  }
  return { block, message, context: ctx.join('\n') };
}

// PreToolUse: çıkış kodu 2 → engelle (stderr modele iletilir). Dönüş: { block, message }
async function pre(settings, name, args, cwd) {
  if (disabled()) return { block: false };
  for (const h of listFor(settings, 'PreToolUse')) {
    if (!matches(h.matcher, name)) continue;
    const r = await runCommand(h.command, { hook_event_name: 'PreToolUse', tool_name: CLAUDE_NAME[name] || name, tool_input: args, cwd }, cwd, h.timeout);
    if (r.code === 2) return { block: true, message: (r.stderr || r.stdout || 'blocked by hook').trim().slice(0, 500) };
  }
  return { block: false };
}

// PostToolUse: stdout/stderr modele geri bildirim olarak eklenir
async function post(settings, name, args, result, cwd) {
  const notes = [];
  if (disabled()) return '';
  for (const h of listFor(settings, 'PostToolUse')) {
    if (!matches(h.matcher, name)) continue;
    const r = await runCommand(h.command, {
      hook_event_name: 'PostToolUse', tool_name: CLAUDE_NAME[name] || name, tool_input: args,
      tool_response: { ok: result.ok, output: String(result.output).slice(0, 4000) }, cwd,
    }, cwd, h.timeout);
    const text = `${r.stdout}${r.stderr ? '\n' + r.stderr : ''}`.trim();
    if (text) notes.push(`[hook${r.code ? ` exit ${r.code}` : ''}] ${text.slice(0, 1500)}`);
  }
  return notes.join('\n');
}

module.exports = { pre, post, fire, disabled, EVENTS };
