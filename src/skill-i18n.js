'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJsonAtomic } = require('./atomic-json');

// Beceri/komut/ajan açıklamalarının yerel dile çevirisi. Çeviriler açıklamanın özetine göre diske önbelleklenir;
// yalnızca önbellekte olmayanlar tek bir model çağrısıyla toplu çevrilir.
const NAMES = { tr: 'Turkish' };
const hash = (text) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16);

function cacheFile(dir, lang) { return path.join(dir, `skill-i18n.${lang}.json`); }
function readCache(file, fsImpl = fs) { try { const v = JSON.parse(fsImpl.readFileSync(file, 'utf8')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }

function parseList(text, n) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { const v = JSON.parse(m[0]); return Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'string') ? v : null; } catch { return null; }
}

// translate(texts, lang, { dir, ask }) → texts ile aynı sırada çeviriler. ask(prompt) modelden düz metin döndürür.
// Model başarısız olursa ya da biçim bozuksa özgün metin döner (arayüz hiçbir zaman boş kalmaz).
async function translate(texts, lang, { dir, ask, fsImpl = fs, batch = 40 } = {}) {
  const list = texts.map((t) => String(t || ''));
  if (!NAMES[lang] || !list.some(Boolean)) return list;
  const file = cacheFile(dir, lang);
  const cache = readCache(file, fsImpl);
  const todo = [...new Set(list.filter((t) => t && !cache[hash(t)]))];
  let changed = false;
  for (let i = 0; i < todo.length && ask; i += batch) {
    const part = todo.slice(i, i + batch);
    const prompt = `Translate each string in this JSON array into natural ${NAMES[lang]} for a developer tool's UI. Keep product names, slash commands, file names, code identifiers and URLs unchanged. Reply with ONLY a JSON array of ${part.length} strings in the same order.\n\n${JSON.stringify(part)}`;
    let out = null;
    try { out = parseList(await ask(prompt), part.length); } catch { out = null; }
    if (!out) continue;
    part.forEach((t, k) => { if (out[k].trim()) { cache[hash(t)] = out[k].trim(); changed = true; } });
  }
  if (changed) { try { writeJsonAtomic(file, cache, { fsImpl }); } catch { /* önbellek yazılamadı: çeviri yine döner */ } }
  return list.map((t) => (t && cache[hash(t)]) || t);
}

module.exports = { translate, parseList, cacheFile, hash };
