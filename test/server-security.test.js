'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.SYZER_HOME = fsTempHome();
const { start, hostAllowed } = require('../src/server');

function fsTempHome() { const fs = require('fs'); return fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-server-')); }
function request(server, headers = {}, method = 'GET', requestPath = '/health') {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}
function listening(server) { return new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve)); }

test('server: loopback host allowlist and originless health', async () => {
  const server = start({ port: 0 }); await listening(server);
  try {
    const ok = await request(server);
    assert.equal(ok.status, 200); assert.equal(ok.headers['access-control-allow-origin'], undefined);
    assert.equal((await request(server, { host: `localhost:${server.address().port}` })).status, 200);
    assert.equal((await request(server, { host: `[::1]:${server.address().port}` })).status, 200);
    assert.equal(hostAllowed(`127.0.0.1:${server.address().port}`, server.address().port), true);
    assert.equal(hostAllowed(`[::1`, server.address().port), false);
    const bad = await request(server, { host: 'attacker.example:1234' });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test('server: exact CORS origins only, OPTIONS headers are limited', async () => {
  const server = start({ port: 0, corsOrigins: ['https://app.example'] }); await listening(server);
  try {
    const denied = await request(server, { origin: 'https://evil.example' }); assert.equal(denied.status, 403);
    const allowed = await request(server, { origin: 'https://app.example' });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example');
    const options = await request(server, { origin: 'https://app.example' }, 'OPTIONS');
    assert.equal(options.status, 204); assert.equal(options.headers['access-control-allow-headers'], 'Authorization, Content-Type, X-API-Key');
  } finally { server.close(); }
});

test('server: non-loopback bind without token is rejected', () => {
  assert.throws(() => start({ host: '0.0.0.0', port: 0 }), /token is required/i);
});

test('server: configured token is required without exposing its value in startup output', async () => {
  const server = start({ port: 0, token: 'secret-token' }); await listening(server);
  try {
    assert.equal((await request(server)).status, 401);
    assert.equal((await request(server, { authorization: 'Bearer secret-token' })).status, 200);
  } finally { server.close(); }
});
