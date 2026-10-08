'use strict';
// syzer export <id|last> [--out dosya.md]: kayıtlı bir oturumu Markdown'a çevirir
const fs = require('fs');
const sessions = require('./sessions');

const text = (c) => (typeof c === 'string' ? c : (c || []).map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n'));

function toMarkdown(s) {
  const out = [`# ${s.title || s.id}`, '', `- Oturum: \`${s.id}\``, `- Model: \`${s.model}\``, `- Dizin: \`${s.cwd}\``, `- Tarih: ${new Date(s.ts).toISOString()}`, ''];
  for (const m of s.messages || []) {
    if (m.role === 'system') continue;
    if (m.role === 'user') out.push('## Kullanıcı', '', text(m.content), '');
    else if (m.role === 'assistant') {
      const t = text(m.content);
      if (t) out.push('## Asistan', '', t, '');
      for (const c of m.tool_calls || []) out.push(`> araç: \`${c.function && c.function.name}\``, '');
    }
  }
  return out.join('\n');
}

function run(id, out) {
  let s = null;
  if (!id || id === 'last') {
    const all = sessions.list(process.cwd());
    s = all[0] || null;
  } else s = sessions.find(id);
  if (!s) { console.error('Oturum bulunamadı. Kullanım: syzer export <id|last> [--out dosya.md]'); process.exitCode = 1; return; }
  const md = toMarkdown(s);
  if (out) { fs.writeFileSync(out, md); console.log(`yazıldı: ${out}`); } else console.log(md);
}

module.exports = { run, toMarkdown };
