'use strict';

const http = require('http');
const { Readable } = require('stream');
const config = require('./config');
const { KeyError, errorFrom } = require('./api');
const providers = require('./providers');
const { withRotation, mask } = require('./keys');
const { freeModels, fallbackChain } = require('./models');
const { fetchInfo } = require('./cmds');
const { C } = require('./ui');
const { t, setLang } = require('./i18n');

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 50 * 1024 * 1024) req.destroy(); });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const oaError = (res, status, message) => json(res, status, { error: { message, type: 'proxy_error', code: status } });

// Tek bir model için key rotasyonlu istek; başarılı Response döndürür
async function upstream(cfg, body, signal, log) {
  return withRotation(
    cfg,
    async (entry) => {
      const prov = providers.current();
      const r = await fetch(`${prov.base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${entry.key}`, 'Content-Type': 'application/json', ...prov.headers() },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await errorFrom(r);
      return r;
    },
    {
      signal,
      onSwitch: (key, status, msg) => log(C.yellow(`  ⚠ ${t('switching', key, status, msg)}`)),
      onRetry: (status, delay) => log(C.yellow(`  ⚠ ${t('retrying', status, delay)}`)),
    },
  );
}

function start({ port = 8787, host = '127.0.0.1', token = null } = {}) {
  const cfg = config.load();
  setLang(cfg.lang);
  const log = (s) => console.log(s);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (token) {
      const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
      if (given !== token) return oaError(res, 401, 'Invalid proxy token.');
    }

    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true, keys: cfg.keys.length, model: cfg.model });

      if (url.pathname === '/usage') {
        const rows = await Promise.all(cfg.keys.map(async (e, i) => {
          const r = await fetchInfo(e);
          return { index: i + 1, key: mask(e.key), active: i === cfg.active, free: r.ok ? r.data.free_model_daily_requests : null, error: r.ok ? null : r.error };
        }));
        return json(res, 200, { keys: rows });
      }

      if (url.pathname === '/v1/models' && req.method === 'GET') {
        const list = await freeModels('');
        return json(res, 200, {
          object: 'list',
          data: [{ id: 'default', object: 'model', owned_by: 'syzercli' }, ...list.map((m) => ({ id: m.id, object: 'model', owned_by: m.id.split('/')[0], context_length: m.ctx }))],
        });
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return oaError(res, 400, 'Invalid JSON body.'); }
        const requested = body.model;
        const useDefault = !requested || requested === 'default' || requested === 'auto';
        body.model = useDefault ? cfg.model : requested;
        // İstemci effort göndermediyse yapılandırmadaki effort uygulanır
        if (!body.reasoning && !body.reasoning_effort && cfg.effort && cfg.effort !== 'auto') body.reasoning = { effort: cfg.effort === 'off' ? 'none' : cfg.effort };

        const ctrl = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

        // Model tarafı hatasında (5xx) yedek modellere geç
        const models = [body.model];
        let chainLoaded = false;
        let result = null;
        let lastErr = null;
        for (let i = 0; i < models.length; i++) {
          try {
            result = await upstream(cfg, { ...body, model: models[i] }, ctrl.signal, log);
            body.model = models[i];
            break;
          } catch (err) {
            lastErr = err;
            if (err instanceof KeyError && err.status >= 500 && !chainLoaded) {
              chainLoaded = true;
              models.push(...(await fallbackChain(cfg, body.model)));
              log(C.yellow(`  ⚠ ${t('fallback_switch', models[i], models[i + 1] || '—')}`));
            } else if (!(err instanceof KeyError && err.status >= 500)) break;
          }
        }
        if (!result) {
          const status = lastErr instanceof KeyError ? lastErr.status || 502 : 502;
          log(`${C.red('✖')} ${req.method} ${url.pathname} ${status} ${lastErr.message}`);
          return oaError(res, status, lastErr.message);
        }

        const { result: up, index } = result;
        res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json', 'X-Proxy-Key': String(index + 1), 'X-Proxy-Model': body.model });
        if (body.stream && up.body) {
          Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
          res.on('close', () => ctrl.abort());
        } else {
          res.end(await up.text());
        }
        log(`${C.green('●')} ${req.method} ${url.pathname} ${C.cyan(body.model)} ${C.gray(`→ key #${index + 1} · ${up.status} · ${((Date.now() - started) / 1000).toFixed(1)}s${body.stream ? ' · stream' : ''}`)}`);
        return undefined;
      }

      return oaError(res, 404, `Not found: ${req.method} ${url.pathname}`);
    } catch (err) {
      if (err.name === 'AbortError') return undefined;
      log(`${C.red('✖')} ${err.message}`);
      return res.headersSent ? res.end() : oaError(res, 500, err.message);
    }
  });

  server.listen(port, host, () => {
    const base = `http://${host}:${port}/v1`;
    log(`${C.orange('◆')} ${C.bold('SyzerCLI proxy')} ${C.cyan(providers.current().name)}  ${C.gray(t('serve_started', base))}`);
    log(C.gray(`  ${cfg.keys.length} key · default model: ${cfg.model}${token ? ' · token required' : ''}`));
    log(C.gray(`  OPENAI_BASE_URL=${base}  OPENAI_API_KEY=${token || 'anything'}  model="default"`));
  });
  server.on('error', (e) => { console.error(`${C.red('✖')} ${e.message}`); process.exitCode = 1; });
  return server;
}

module.exports = { start };
