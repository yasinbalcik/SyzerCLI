'use strict';

const providers = require('./providers');

class KeyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = Number(status) || 500;
  }
}

// Hata gövdeleri sağlayıcıya göre değişir: {error:{message}} (OpenRouter, bazı NVIDIA hataları) veya {title, detail} (NVIDIA)
async function errorFrom(res) {
  let msg = res.statusText || `HTTP ${res.status}`;
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      msg = (j.error && (j.error.message || j.error)) || j.detail || j.message || j.title || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch { if (text.trim()) msg = text.trim().slice(0, 200); }
  } catch { /* gövde okunamadı */ }
  return new KeyError(res.status, msg);
}

// Tek bir key ile stream isteği. İçerik/araç çağrısı gelmeden önceki hatalar KeyError olarak fırlar.
async function chatStream({ key, model, messages, tools, effort, signal, onText, onThinking, provider = providers.current() }) {
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (effort && effort !== 'auto') Object.assign(body, provider.reasoning(effort));
  if (tools && tools.length) body.tools = tools;

  let res;
  try {
    res = await fetch(`${provider.base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...provider.headers() },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
    throw new KeyError(503, `network: ${(e.cause && (e.cause.code || e.cause.message)) || e.message}`); // geçici ağ hatası → yeniden dene / yedek model
  }
  if (!res.ok) throw await errorFrom(res);

  const decoder = new TextDecoder();
  const calls = [];
  let buf = '';
  let content = '';
  let usage = null;
  let started = false;

  const handle = (data) => {
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) {
      const e = new KeyError(j.error.code || 500, j.error.message || 'stream error');
      if (started) { e.status = 0; }
      throw e;
    }
    if (j.usage) usage = j.usage;
    const d = j.choices?.[0]?.delta;
    if (!d) return;
    const thought = d.reasoning || d.reasoning_content; // OpenRouter: reasoning · NVIDIA: reasoning_content
    if (thought && !started) onThinking && onThinking(thought);
    if (d.content) { started = true; content += d.content; onText && onText(d.content); }
    for (const tc of d.tool_calls || []) {
      started = true;
      const c = (calls[tc.index ?? 0] ||= { id: '', name: '', arguments: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.arguments += tc.function.arguments;
    }
  };

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue; // ": OPENROUTER PROCESSING" yorumları vb.
      const data = line.slice(5).trim();
      if (data === '[DONE]') return finish();
      handle(data);
    }
  }
  return finish();

  function finish() {
    const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
    return { content, toolCalls, usage };
  }
}

async function getJson(path, key, timeoutMs = 15000, provider = providers.current()) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const res = await fetch(`${provider.base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

// Key canlı doğrulaması. Geçersizse KeyError fırlatır; doğrulanamayan geçici durumlarda { ok: true, note } döner.
async function validateKey(provider, key) {
  if (provider.hasUsageApi) { await getJson('/key', key, 15000, provider); return { ok: true }; }
  // NVIDIA: /models anahtarı denetlemez, bu yüzden 1 token'lık gerçek bir çağrı yapılır
  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.validateModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.ok) return { ok: true };
  const err = await errorFrom(res);
  if (res.status === 401 || res.status === 403) throw err;
  return { ok: true, note: `${res.status} ${err.message}`.slice(0, 80) }; // 429/5xx/404: anahtar reddedilmedi
}

module.exports = { KeyError, errorFrom, chatStream, getJson, validateKey };
