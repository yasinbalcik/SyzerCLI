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
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd })
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

// PreToolUse: çıkış kodu 2 → engelle (stderr modele iletilir). Dönüş: { block, message }
async function pre(settings, name, args, cwd) {
  for (const h of (settings && settings.hooks.PreToolUse) || []) {
    if (!matches(h.matcher, name)) continue;
    const r = await runCommand(h.command, { hook_event_name: 'PreToolUse', tool_name: CLAUDE_NAME[name] || name, tool_input: args, cwd }, cwd, h.timeout);
    if (r.code === 2) return { block: true, message: (r.stderr || r.stdout || 'blocked by hook').trim().slice(0, 500) };
  }
  return { block: false };
}

// PostToolUse: stdout/stderr modele geri bildirim olarak eklenir
async function post(settings, name, args, result, cwd) {
  const notes = [];
  for (const h of (settings && settings.hooks.PostToolUse) || []) {
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

module.exports = { pre, post };
