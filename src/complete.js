'use strict';

const uniqueSorted = (items) => {
  const seen = new Set();
  const values = [];
  for (const item of items || []) {
    if (typeof item !== 'string' || !item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    values.push(item);
  }
  return values.sort((a, b) => {
    const aa = a.toLowerCase(); const bb = b.toLowerCase();
    return aa < bb ? -1 : aa > bb ? 1 : (a < b ? -1 : a > b ? 1 : 0);
  });
};

function tokenRange(line, cursor) {
  const at = Math.max(0, Math.min(Number.isFinite(cursor) ? Math.trunc(cursor) : line.length, line.length));
  let start = at;
  while (start > 0 && !/\s/.test(line[start - 1])) start--;
  return { start, end: at };
}

function candidates(items, prefix) {
  const p = prefix.toLowerCase();
  return uniqueSorted(items).filter((item) => item.toLowerCase().startsWith(p));
}

// Saf tamamlama: çağıran anlık aday listesini verir; bu modül dosya sistemi veya terminal okumaz.
function complete(input, cursor, context = {}) {
  const line = String(input || '');
  const range = tokenRange(line, cursor);
  const token = line.slice(range.start, range.end);

  if (token.startsWith('@')) {
    const files = (context.files || []).map((file) => `@${String(file).replace(/^@/, '')}`);
    return { candidates: candidates(files, token), range };
  }

  const before = line.slice(0, range.start);
  const words = before.trim().split(/\s+/).filter(Boolean);
  if (!words.length && token.startsWith('/')) return { candidates: candidates(context.commands, token), range };
  if (words.length !== 1 || !words[0].startsWith('/')) return { candidates: [], range };

  const choices = {
    '/model': context.models,
    '/lang': context.languages,
    '/perm': context.permissions,
    '/provider': context.providers,
    '/effort': context.efforts,
  }[words[0].toLowerCase()];
  return { candidates: choices ? candidates(choices, token) : [], range };
}

module.exports = { complete, tokenRange };
