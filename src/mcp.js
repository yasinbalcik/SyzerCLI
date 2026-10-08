'use strict';

const { spawn } = require('child_process');
const pkg = require('../package.json');

const PROTOCOL = '2024-11-05';

// stdio üzerinden satır satır JSON-RPC konuşan minimal MCP istemcisi
class McpClient {
  constructor(name, spec, cwd) {
    this.name = name;
    this.spec = spec;
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.tools = [];
    this.stderr = '';
  }

  start() {
    const { command, args = [], env = {} } = this.spec;
    if (!command) throw new Error('only stdio servers (command) are supported');
    const opts = { cwd: this.cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] };
    if (process.platform === 'win32') {
      // npx.cmd gibi komutlar kabuk ister; shell + args dizisi tırnaklamadığı için komutu kendimiz kuruyoruz
      const q = (s) => (/[\s"&|<>^]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
      this.child = spawn([command, ...args].map(q).join(' '), { ...opts, shell: true });
    } else {
      this.child = spawn(command, args, opts);
    }
    this.child.stdout.on('data', (d) => this._data(d));
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    this.child.on('error', (e) => this._fail(e));
    this.child.on('close', (code) => this._fail(new Error(`server exited (${code})${this.stderr ? ': ' + this.stderr.trim().split('\n').pop() : ''}`)));
  }

  _fail(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.dead = err;
  }

  _data(d) {
    this.buf += d.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
        else p.resolve(msg.result);
      } else if (msg.id !== undefined && msg.method) {
        // sunucudan gelen istek (ör. ping): boş sonuçla cevapla
        this._send({ jsonrpc: '2.0', id: msg.id, result: {} });
      }
    }
  }

  _send(obj) { if (!this.dead) this.child.stdin.write(JSON.stringify(obj) + '\n'); }

  request(method, params, timeoutMs = 20000) {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) { this._send({ jsonrpc: '2.0', method, params }); }

  async init() {
    this.start();
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'syzercli', version: pkg.version } }, 30000);
    this.notify('notifications/initialized');
    let cursor;
    do {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      this.tools.push(...(r.tools || []));
      cursor = r.nextCursor;
    } while (cursor);
  }

  async callTool(name, args) {
    const r = await this.request('tools/call', { name, arguments: args || {} }, 120000);
    const text = (r.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
    return { ok: !r.isError, text: text || '(empty)' };
  }

  close() { try { this.child.stdin.end(); this.child.kill(); } catch { /* kapalı */ } }
}

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

// Tüm MCP sunucularını başlatır; araçları model için fonksiyon tanımlarına çevirir.
class McpManager {
  constructor() { this.clients = []; this.defs = []; this.errors = []; this.skipped = []; this.map = new Map(); }

  async load(servers, cwd) {
    await Promise.all(Object.entries(servers || {}).map(async ([name, spec]) => {
      if (!spec || !spec.command) { this.skipped.push({ name, reason: `${(spec && (spec.type || 'url')) || 'invalid'} transport is not supported (stdio only)` }); return; }
      const client = new McpClient(name, spec, cwd);
      try { await client.init(); }
      catch (e) { this.errors.push({ name, message: e.message }); client.close(); return; }
      this.clients.push(client);
      for (const tool of client.tools) {
        const full = `mcp__${safe(name)}__${safe(tool.name)}`.slice(0, 64);
        this.map.set(full, { client, tool: tool.name });
        this.defs.push({
          type: 'function',
          function: {
            name: full,
            description: `[${name}] ${tool.description || tool.name}`.slice(0, 1000),
            parameters: tool.inputSchema && tool.inputSchema.type ? tool.inputSchema : { type: 'object', properties: {} },
          },
        });
      }
    }));
    return this;
  }

  async call(fullName, args) {
    const e = this.map.get(fullName);
    if (!e) return { ok: false, text: `Unknown MCP tool: ${fullName}` };
    try { return await e.client.callTool(e.tool, args); }
    catch (err) { return { ok: false, text: err.message }; }
  }

  close() { this.clients.forEach((c) => c.close()); }
}

module.exports = { McpClient, McpManager, PROTOCOL };
