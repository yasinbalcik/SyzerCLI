'use strict';

// Statusline: settings.statusLine = { command, timeoutMs }. Komut stdin'e JSON alır
// { model, cwd, sessionId, tokens, contextTokens, budget:{limits,used,active}, verify } ve ilk satırı döner.
// Zaman aşımı/hata → '' (sessizce yok sayılır). Kısa önbellek: aynı komut+yük TTL içinde yeniden çalıştırılmaz.

const { spawn } = require('child_process');

const DEFAULT_TIMEOUT = 1500;
const CACHE_MS = 3000;
const MAX_OUT = 4096;
const cache = new Map(); // anahtar → { at, value }

const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

// { command, timeoutMs } | null
function config(settings) {
  const sl = settings && settings.statusLine;
  const command = typeof sl === 'string' ? sl : sl && sl.command;
  if (typeof command !== 'string' || !command.trim()) return null;
  return { command: command.trim(), timeoutMs: clamp(sl && sl.timeoutMs, 100, 10000, DEFAULT_TIMEOUT) };
}

function payload(session) {
  let used = { tokens: 0, turns: 0, minutes: 0 };
  let limits = {};
  let active = false;
  try {
    const b = session.budget;
    if (b) { used = b.used(); limits = b.limits; active = b.active(); }
  } catch { /* önemsiz */ }
  let contextTokens = 0;
  try { contextTokens = require('./compact').estimate(session.messages); } catch { /* önemsiz */ }
  let verify = false;
  try { verify = !!require('./verify').settings(session).enabled; } catch { /* önemsiz */ }
  return {
    model: session.model, cwd: session.cwd, sessionId: session.sessionId,
    tokens: used.tokens, contextTokens,
    budget: { limits, used: { tokens: used.tokens, turns: used.turns, minutes: Math.round(used.minutes * 10) / 10 }, active },
    verify,
  };
}

// Kontrol karakterlerini ve SGR dışı kaçışları temizler, ilk boş olmayan satırı döndürür
function firstLine(text) {
  const line = String(text || '').replace(/\x1b\[[0-9;]*[^0-9;m]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    .split(/\r?\n/).map((l) => l.replace(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g, '').trim()).find(Boolean);
  return line ? line.slice(0, 300) : '';
}

function run(command, input, timeoutMs, spawnFn = spawn) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* önemsiz */ } finish(''); }, timeoutMs);
    try {
      child = spawnFn(command, { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { finish(''); return; }
    child.on('error', () => finish(''));
    child.stdout.on('data', (d) => { if (out.length < MAX_OUT) out += d; });
    child.on('close', (code) => finish(code === 0 ? firstLine(out) : ''));
    try { child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input)); } catch { /* önemsiz */ }
  });
}

// Ana işlev: ayarlı değilse ''. opts: { spawn, now } (test için)
async function render(session, opts = {}) {
  try {
    const conf = config(session && session.settings);
    if (!conf) return '';
    const input = payload(session);
    const now = (opts.now || Date.now)();
    const key = `${conf.command}\n${JSON.stringify(input)}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.value;
    const value = await run(conf.command, input, conf.timeoutMs, opts.spawn);
    cache.set(key, { at: now, value });
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    return value;
  } catch {
    return '';
  }
}

module.exports = { config, payload, firstLine, render, run, clearCache: () => cache.clear() };
