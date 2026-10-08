'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { chatStream, KeyError } = require('../src/api');

// Yerel sahte sağlayıcı: handler(req, res) her istek için çağrılır
async function withServer(handler, fn) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const provider = { base: `http://127.0.0.1:${server.address().port}`, headers: () => ({}), reasoning: () => ({}) };
  try {
    return await fn(provider);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
}

const call = (provider, extra = {}) => chatStream({ key: 'k', model: 'm', messages: [], provider, ...extra });
const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const sseHead = { 'Content-Type': 'text/event-stream' };

test('hiç veri gelmezse 504 KeyError fırlatır', async () => {
  await withServer(() => { /* sessiz */ }, async (provider) => {
    const t0 = Date.now();
    await assert.rejects(call(provider, { stallMs: 150 }), (e) => {
      assert.ok(e instanceof KeyError);
      assert.strictEqual(e.status, 504);
      assert.match(e.message, /stalled/);
      return true;
    });
    assert.ok(Date.now() - t0 < 1500);
  });
});

test('içerik başladıktan sonra susarsa status 0 KeyError fırlatır', async () => {
  await withServer((req, res) => {
    res.writeHead(200, sseHead);
    res.write(sse('merhaba'));
  }, async (provider) => {
    await assert.rejects(call(provider, { stallMs: 150 }), (e) => {
      assert.ok(e instanceof KeyError);
      assert.strictEqual(e.status, 0);
      assert.match(e.message, /stalled/);
      return true;
    });
  });
});

test('keep-alive yorumları zamanlayıcıyı sıfırlar', async () => {
  await withServer((req, res) => {
    res.writeHead(200, sseHead);
    const iv = setInterval(() => res.write(': PROCESSING\n\n'), 50);
    setTimeout(() => {
      clearInterval(iv);
      res.write(sse('tamam'));
      res.end('data: [DONE]\n\n');
    }, 900);
    res.on('close', () => clearInterval(iv));
  }, async (provider) => {
    const r = await call(provider, { stallMs: 400 });
    assert.strictEqual(r.content, 'tamam');
  });
});

test('kullanıcı iptali AbortError olarak kalır', async () => {
  await withServer(() => { /* sessiz */ }, async (provider) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(call(provider, { stallMs: 5000, signal: ac.signal }), (e) => {
      assert.strictEqual(e.name, 'AbortError');
      assert.ok(!(e instanceof KeyError));
      return true;
    });
  });
});

test('SYZER_STALL_MS ortam değişkeni sınırı belirler', async () => {
  const old = process.env.SYZER_STALL_MS;
  process.env.SYZER_STALL_MS = '120';
  try {
    await withServer(() => { /* sessiz */ }, async (provider) => {
      await assert.rejects(call(provider), (e) => e instanceof KeyError && e.status === 504 && /stalled/.test(e.message));
    });
  } finally {
    if (old === undefined) delete process.env.SYZER_STALL_MS; else process.env.SYZER_STALL_MS = old;
  }
});

test('hata durumu + takılan gövde gerçek status kodunu korur', async () => {
  await withServer((req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.write('{"error":'); // gövde hiç bitmez
  }, async (provider) => {
    const t0 = Date.now();
    await assert.rejects(call(provider, { stallMs: 200 }), (e) => e instanceof KeyError && e.status === 429);
    assert.ok(Date.now() - t0 < 3000);
  });
});

test('çok büyük SYZER_STALL_MS varsayılana düşer (sahte takılma yok)', async () => {
  const old = process.env.SYZER_STALL_MS;
  process.env.SYZER_STALL_MS = '99999999999';
  try {
    await withServer((req, res) => {
      setTimeout(() => { res.writeHead(200, sseHead); res.write(sse('ok')); res.end('data: [DONE]\n\n'); }, 100);
    }, async (provider) => {
      assert.strictEqual((await call(provider)).content, 'ok');
    });
  } finally {
    if (old === undefined) delete process.env.SYZER_STALL_MS; else process.env.SYZER_STALL_MS = old;
  }
});

for (const bad of ['abc', '0', '-5']) {
  test(`geçersiz SYZER_STALL_MS (${bad}) varsayılana düşer`, async () => {
    const old = process.env.SYZER_STALL_MS;
    process.env.SYZER_STALL_MS = bad;
    try {
      await withServer((req, res) => {
        setTimeout(() => { res.writeHead(200, sseHead); res.write(sse('ok')); res.end('data: [DONE]\n\n'); }, 200);
      }, async (provider) => {
        assert.strictEqual((await call(provider)).content, 'ok');
      });
    } finally {
      if (old === undefined) delete process.env.SYZER_STALL_MS; else process.env.SYZER_STALL_MS = old;
    }
  });
}

test('gövde sırasında kullanıcı iptali AbortError olur', async () => {
  await withServer((req, res) => {
    res.writeHead(200, sseHead);
    res.write(sse('x'));
  }, async (provider) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(call(provider, { stallMs: 5000, signal: ac.signal }), (e) => e.name === 'AbortError' && !(e instanceof KeyError));
  });
});

test('önceden iptal edilmiş sinyal AbortError verir', async () => {
  await withServer(() => { /* sessiz */ }, async (provider) => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(call(provider, { stallMs: 5000, signal: ac.signal }), (e) => e.name === 'AbortError' && !(e instanceof KeyError));
  });
});
