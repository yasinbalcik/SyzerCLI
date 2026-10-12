'use strict';

// Çok sayıda key'i sorgularken (679 key gibi) hepsini aynı anda göndermek sağlayıcıyı 429'a düşürür ve
// sonuçlar "Rate limit exceed" ile dolar. Bu modül sınırlı eşzamanlılık + 429'da geri çekilme sağlar.

// SYZER_POOL_CONCURRENCY ile ayarlanabilir (1-64)
const envN = Number(process.env.SYZER_POOL_CONCURRENCY);
const DEFAULT_CONCURRENCY = Number.isInteger(envN) && envN >= 1 && envN <= 64 ? envN : 16;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// items üzerinde fn'i en fazla `limit` eşzamanlı çalıştırır; sonuçları giriş sırasıyla döner. fn hata fırlatmamalı.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit | 0 || DEFAULT_CONCURRENCY, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const isRateLimited = (e) => !!e && (Number(e.status) === 429 || /rate.?limit/i.test(String(e.message || '')));

// fn() reddedilirse ve hata 429 ise 800ms, 1.6s, 3.2s ... bekleyip yeniden dener. Son hatayı yeniden fırlatır.
// opts: { tries = 4, base = 800, sleep, rand } (sleep/rand testte enjekte edilir)
async function retry429(fn, { tries = 4, base = 800, sleep = sleepMs, rand = Math.random } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isRateLimited(e) || i === tries - 1) throw e;
      await sleep(base * 2 ** i + Math.floor(rand() * 250));
    }
  }
  throw last;
}

// Sonuç nesnesi biçiminde ({ ok, status }) dönen fn için: status 429 ise aynı şekilde yeniden dener.
async function retryResult(fn, { tries = 4, base = 800, sleep = sleepMs, rand = Math.random } = {}) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await fn();
    if (r && r.ok === false && Number(r.status) === 429 && i < tries - 1) { await sleep(base * 2 ** i + Math.floor(rand() * 250)); continue; }
    return r;
  }
  return r;
}

module.exports = { mapLimit, retry429, retryResult, isRateLimited, DEFAULT_CONCURRENCY };
