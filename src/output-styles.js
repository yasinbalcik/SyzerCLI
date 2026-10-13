'use strict';

// Çıktı stilleri: yerleşik default | concise | explanatory + kullanıcı/proje/plugin .md dosyaları
// (frontmatter: name, description). Seçili stil sistem istemi sonuna [STYLE]...[/STYLE] bloğu olarak eklenir;
// stil değişince eski blok çıkarılır (applyScaffold'daki [SCAFFOLD] bloğuyla çakışmaz).

const fs = require('fs');
const path = require('path');
const config = require('./config');

const OPEN = '[STYLE]';
const CLOSE = '[/STYLE]';
const NAME_RE = /^[\w.-]{1,40}$/;
const MAX_BODY = 4000;

const BUILTIN = [
  { name: 'default', description: 'Standard behaviour (no extra style instructions)', body: '', source: 'built-in' },
  {
    name: 'concise', description: 'Short answers, minimal prose', source: 'built-in',
    body: 'Respond tersely. Lead with the answer or the result. No preamble, no recap of what you did, no restating the question. '
      + 'Prefer one or two sentences or a short list; code and commands over explanation. Mention only what the user must know or act on.',
  },
  {
    name: 'explanatory', description: 'Explain reasoning and trade-offs while working', source: 'built-in',
    body: 'While working, briefly explain why you choose an approach, what the relevant parts of the codebase do, and notable trade-offs. '
      + 'After a change, summarise what changed and why in plain language, and point out patterns the user may want to reuse. '
      + 'Keep explanations focused; do not pad.',
  },
];

function readDir(dir, source, into) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { return; }
  const { parseFrontmatter } = require('./context');
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const { meta, body } = parseFrontmatter(src);
    const name = String(meta.name || f.slice(0, -3)).trim();
    if (!NAME_RE.test(name) || into.has(name)) continue;
    into.set(name, { name, description: meta.description || '', body: body.trim().slice(0, MAX_BODY), source });
  }
}

// → Map ad → { name, description, body, source }. Öncelik: proje > kullanıcı > plugin > yerleşik
function find(cwd = process.cwd()) {
  const m = new Map();
  readDir(path.join(cwd, '.syzer', 'output-styles'), 'project', m);
  readDir(path.join(config.DIR, 'output-styles'), 'user', m);
  try {
    const pl = require('./plugins');
    for (const r of pl.roots('output-styles')) readDir(r, `plugin:${path.basename(path.dirname(r))}`, m);
  } catch { /* plugin hatası stilleri bozmasın */ }
  for (const b of BUILTIN) if (!m.has(b.name)) m.set(b.name, b);
  return m;
}

const clean = (s) => String(s).split(CLOSE).join('').split(OPEN).join('');

function block(style) {
  if (!style || !style.body) return '';
  return `${OPEN}\nOutput style "${style.name}": ${clean(style.body)}\n${CLOSE}`;
}

// Mevcut içerikten [STYLE] bloğunu çıkarır
function strip(content) {
  const a = content.indexOf(`\n\n${OPEN}`);
  if (a < 0) return content;
  const b = content.indexOf(CLOSE, a);
  if (b < 0) return content.slice(0, a);
  return content.slice(0, a) + content.slice(b + CLOSE.length);
}

// Oturumun sistem istemini seçili stile göre günceller (her tur sonda; idempotent). Dönüş: uygulanan stil adı
function apply(session, name) {
  const m = session && session.messages && session.messages[0];
  if (!m || m.role !== 'system' || typeof m.content !== 'string') return null;
  const want = name || (session.cfg && session.cfg.outputStyle) || 'default';
  const has = m.content.includes(`\n\n${OPEN}`);
  if (want === 'default' && !has) return 'default';
  const style = find(session.cwd).get(want);
  const base = strip(m.content);
  const b = style ? block(style) : '';
  m.content = b ? `${base}\n\n${b}` : base;
  return style ? style.name : 'default';
}

module.exports = { BUILTIN, find, block, strip, apply, OPEN, CLOSE };
