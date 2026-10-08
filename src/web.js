'use strict';

// Yerel web arayüzü: `syzer web` veya sohbette /web. Yalnızca 127.0.0.1, rastgele token + çerez ile korunur
// (ajan komut çalıştırabildiği için). Tek kullanıcı, tek oturum.
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const config = require('./config');
const providers = require('./providers');
const { LANGS, setLang } = require('./i18n');
const { createSession, resetSession } = require('./session');
const { runTurn } = require('./agent');
const { mask, usable, addKeys } = require('./keys');
const { freeModels } = require('./models');
const { killAll } = require('./tools');
const cmds = require('./cmds');
const sessions = require('./sessions');
const { loadBody } = require('./context');
const git = require('./git');
const { html } = require('./web-ui');

// ---- çalışma alanları (klasörler): ~/.syzercli/workspaces.json ----
const WS_FILE = path.join(config.DIR, 'workspaces.json');
const wsLoad = () => { try { return JSON.parse(fs.readFileSync(WS_FILE, 'utf8')); } catch { return []; } };
const wsSave = (list) => { try { fs.mkdirSync(config.DIR, { recursive: true }); fs.writeFileSync(WS_FILE, JSON.stringify(list)); } catch { /* önemsiz */ } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function wsInfo(p) {
  let branch = null; let dirty = 0;
  if (git.isRepo(p)) { branch = git.git(p, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim() || null; dirty = git.status(p).split(String.fromCharCode(10)).filter(Boolean).length; }
  return { path: p, name: path.basename(p) || p, branch, dirty, sessions: sessions.list(p).length };
}

const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let d = '';
  req.on('data', (c) => { d += c; if (d.length > 20 * 1024 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* elle açılır */ }
}

function keyRows(cfg) {
  return cfg.keys.map((e, i) => ({
    index: i + 1, key: mask(e.key), active: i === cfg.active,
    state: e.disabled ? 'off' : e.blockedUntil > Date.now() ? 'wait' : 'ready',
    reason: e.reason || null, until: e.blockedUntil > Date.now() ? e.blockedUntil : null,
  }));
}

function start(cfg, { port = 8788, host = '127.0.0.1', open = true, cwd = process.cwd(), quiet = false } = {}) {
  const token = crypto.randomBytes(18).toString('hex');
  let busy = false;
  let ctrl = null;
  let emit = () => {};
  const pending = new Map(); // onay id → resolve

  const out = {
    waiting(on, label) { emit({ type: 'waiting', on: !!on, label: label || null }); },
    thinking(txt) { emit({ type: 'thinking', text: txt }); },
    text(txt) { emit({ type: 'text', text: txt }); },
    endText() { emit({ type: 'endText' }); },
    tool(name, summary) { emit({ type: 'tool', name, summary }); },
    toolResult(ok, text, ui) { emit({ type: 'toolResult', ok, summary: ui ? ui.summary : String(text).split('\n')[0].slice(0, 160), body: ui && ui.body ? String(ui.body).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 4000) : null }); },
    warn(msg) { emit({ type: 'warn', text: msg }); },
    notice(msg) { emit({ type: 'notice', text: msg }); },
    agentStart() {}, agentUpdate() {}, agentEnd() {}, pause() {}, refresh() {},
  };
  const confirm = (kind, summary, preview) => new Promise((resolve) => {
    const id = crypto.randomBytes(6).toString('hex');
    pending.set(id, resolve);
    emit({ type: 'confirm', id, kind, summary, preview: preview ? String(preview).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 4000) : null });
  });

  const mk = (dir) => createSession(cfg, { cwd: dir, canAsk: true, confirm, out });
  let s = mk(cwd);
  { const l = wsLoad(); if (!l.includes(cwd)) { l.unshift(cwd); wsSave(l); } }

  const state = () => ({
    version: pkg.version, provider: cfg.provider, providers: providers.list().map((p) => ({ id: p.id, name: p.name })),
    model: s.model, effort: s.effort, perm: s.perm, lang: cfg.lang, langs: LANGS, cwd: s.cwd, busy,
    keys: keyRows(cfg), ready: cfg.keys.filter(usable).length, messages: s.messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content)).map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
  });

  const authed = (req) => (req.headers.cookie || '').split(/;\s*/).includes(`syz=${token}`);
  const hostOk = (req) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host || '');

  const server = http.createServer(async (req, res) => {
    try {
      if (!hostOk(req)) return send(res, 403, { error: 'forbidden host' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/') {
        if (url.searchParams.get('t') === token) {
          res.writeHead(302, { 'Set-Cookie': `syz=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
          return res.end();
        }
        if (!authed(req)) return send(res, 401, 'Open the full URL printed by "syzer web" (it contains the access token).', 'text/plain');
        return send(res, 200, html, 'text/html');
      }
      if (req.method === 'GET' && url.pathname === '/icon.png') {
        const f = path.join(__dirname, '..', 'assets', 'syzer-icon.png');
        if (!fs.existsSync(f)) return send(res, 404, '', 'text/plain');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
        return res.end(fs.readFileSync(f));
      }
      if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'POST' && req.headers.origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.origin)) return send(res, 403, { error: 'bad origin' });

      if (url.pathname === '/api/state') return send(res, 200, state());
      if (url.pathname === '/api/usage') return send(res, 200, await require('./usage-summary').summary().finally(() => providers.setCurrent(cfg.provider)));
      if (url.pathname === '/api/skills') {
        return send(res, 200, {
          skills: s.ctx.skills.map((k) => ({ name: k.name, description: k.description || '' })),
          commands: s.ctx.commands.map((k) => ({ name: k.name, description: k.description || '' })),
          agents: require('./context').findAgents(s.cwd).map((a) => ({ name: a.name, description: a.description || '', builtin: !!a.builtin })),
        });
      }
      if (url.pathname === '/api/workspaces') return send(res, 200, { current: s.cwd, list: wsLoad().filter(isDir).map(wsInfo) });
      if (url.pathname === '/api/sessions') return send(res, 200, sessions.list(s.cwd).map((x) => ({ id: x.id, title: x.title, ts: x.ts, count: x.messages.length - 1, current: x.id === s.sessionId })));
      if (url.pathname === '/api/models') return send(res, 200, (await freeModels(url.searchParams.get('q') || '').catch(() => [])).slice(0, 200).map((m) => ({ id: m.id, ctx: m.ctx || null, tools: !!m.tools })));

      const body = req.method === 'POST' ? await readBody(req) : {};

      if (url.pathname === '/api/chat') {
        if (busy) return send(res, 409, { error: 'busy' });
        let text = String(body.text || '').trim();
        if (!text) return send(res, 400, { error: 'empty' });
        // /beceri ve /komut açılımı (CLI'daki gibi)
        const sm = text.match(/^\/([\w:.-]+)\s*([\s\S]*)$/);
        if (sm) {
          const command = s.ctx.commands.find((k) => k.name === sm[1]);
          const skill = s.ctx.skills.find((k) => k.name === sm[1]);
          if (command) text = loadBody(command.file, sm[2]);
          else if (skill) text = `Use the skill "${skill.name}" (call use_skill first).${sm[2] ? `${String.fromCharCode(10).repeat(2)}Task: ${sm[2]}` : ''}`;
        }
        busy = true;
        ctrl = new AbortController();
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
        emit = (ev) => { if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`); };
        res.on('close', () => { if (busy && ctrl) ctrl.abort(); });
        try {
          const r = await runTurn(s, text, ctrl.signal);
          sessions.save(s);
          emit({ type: 'done', tokens: r.tokens, ms: r.ms, model: r.model, key: r.keyIndex + 1 });
        } catch (e) {
          emit({ type: ctrl.signal.aborted ? 'aborted' : 'error', text: e.message });
        } finally {
          busy = false; ctrl = null; emit = () => {};
          for (const [, r] of pending) r('no');
          pending.clear();
          res.end();
        }
        return;
      }
      if (url.pathname === '/api/confirm') {
        const r = pending.get(body.id);
        if (r) { pending.delete(body.id); r(['yes', 'no', 'always', 'rule'].includes(body.answer) ? body.answer : 'no'); }
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/workspace') {
        if (busy) return send(res, 409, { error: 'busy' });
        const p = body.path ? path.resolve(String(body.path)) : null;
        if (body.action === 'add' || body.action === 'select') {
          if (!p || !isDir(p)) return send(res, 400, { error: 'not a directory' });
          const l = wsLoad(); if (!l.includes(p)) { l.push(p); wsSave(l); }
          if (body.action === 'select' && p !== s.cwd) { killAll(s); s = mk(p); }
        } else if (body.action === 'remove' && p && p !== s.cwd) wsSave(wsLoad().filter((x) => x !== p));
        return send(res, 200, state());
      }
      if (url.pathname === '/api/session/resume') {
        if (busy) return send(res, 409, { error: 'busy' });
        const saved = sessions.list(s.cwd).find((x) => x.id === body.id);
        if (saved) { s.messages = [s.messages[0], ...saved.messages.slice(1)]; s.sessionId = saved.id; }
        return send(res, 200, state());
      }
      if (url.pathname === '/api/abort') { if (ctrl) ctrl.abort(); return send(res, 200, { ok: true }); }
      if (url.pathname === '/api/clear') { if (!busy) { resetSession(s); s.sessionId = require('./sessions').newId(); } return send(res, 200, state()); }

      if (url.pathname === '/api/settings') {
        if (busy) return send(res, 409, { error: 'busy' });
        if (body.provider && body.provider !== cfg.provider && providers.PROVIDERS[body.provider]) {
          config.switchProvider(cfg, body.provider);
          s.model = cfg.model; s.effort = cfg.effort;
        }
        if (body.model) { cfg.model = body.model; s.model = body.model; }
        if (body.effort && cmds.EFFORTS.includes(body.effort)) { cfg.effort = body.effort; s.effort = body.effort; }
        if (body.perm && ['ask', 'auto', 'readonly'].includes(body.perm)) { cfg.permissions = body.perm; s.perm = body.perm; }
        if (body.lang && LANGS[body.lang]) { cfg.lang = body.lang; setLang(body.lang); }
        if (body.activeKey) { const n = parseInt(body.activeKey, 10) - 1; if (cfg.keys[n]) cfg.active = n; }
        config.save(cfg);
        return send(res, 200, state());
      }
      if (url.pathname === '/api/keys/add') {
        const r = await addKeys(cfg, String(body.text || ''), { check: true });
        config.save(cfg);
        return send(res, 200, { added: r.added.length, exists: r.exists.length, invalid: r.invalid.length + r.badFormat.length, found: r.found, state: state() });
      }
      if (url.pathname === '/api/keys/remove') {
        const n = parseInt(body.index, 10) - 1;
        if (cfg.keys[n]) { cfg.keys.splice(n, 1); if (cfg.active >= cfg.keys.length) cfg.active = 0; config.save(cfg); }
        return send(res, 200, state());
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e.message }); else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    let tries = 0;
    const listen = (p) => server.listen(p, host);
    server.on('error', (e) => { if (e.code === 'EADDRINUSE' && tries++ < 20) listen(port + tries); else reject(e); });
    server.on('listening', () => {
      const url = `http://127.0.0.1:${server.address().port}/?t=${token}`;
      if (!quiet) console.log(`Syzer web UI: ${url}\n(Ctrl+C to stop)`);
      if (open) openBrowser(url);
      resolve({ url, close: () => { killAll(s); server.close(); } });
    });
    listen(port);
  });
}

module.exports = { start };
