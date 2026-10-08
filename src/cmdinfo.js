'use strict';

// Komut bilgisi: yardım metinlerinden (i18n) komut tablosu çıkarır; /help görünümü ve "/" öneri menüsü bunu kullanır.
const { C, vlen, pad } = require('./ui');
const { t } = require('./i18n');

const GROUPS = [
  ['help_g_chat', ['clear', 'compact', 'resume', 'plan', 'go', 'undo', 'context', 'exit']],
  ['help_g_model', ['model', 'models', 'effort', 'fallback', 'provider', 'perm', 'lang', 'keys', 'usage', 'stats']],
  ['help_g_agents', ['agents', 'subagent', 'runs', 'run', 'tree']],
  ['help_g_project', ['init', 'diff', 'commit', 'review', 'checkpoints', 'restore', 'todos', 'tasks', 'rules', 'allow', 'deny', 'mcp', 'skills']],
  ['help_g_more', ['web']],
];
const ARGS_EXTRA = new Set(['allow', 'deny', 'rules', 'keys']);

// Yardım satırlarını { names, usage[], desc } girdilerine ayırır
function parseTable() {
  const entries = [];
  let tip = '';
  const keys = ['help', 'help2', 'help3', 'help4', 'help5', 'help6'];
  for (const key of keys) {
    const text = t(key);
    if (!text || text === key) continue;
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      if (!/^ {2}[/#]/.test(line)) { if (i > 0 && line.trim()) tip = line.trim(); return; }
      const m = /^ {2}(\S.*?) {2,}(\S.*)$/.exec(line);
      if (!m) return;
      const segs = m[1].split(/\s·\s/).map((x) => x.trim());
      for (const seg of segs) {
        const nm = /^\/([a-z][\w-]*)/.exec(seg);
        if (!nm) continue;
        entries.push({ name: nm[1], usage: seg, desc: m[2], args: /[[<]/.test(seg) || ARGS_EXTRA.has(nm[1]) });
      }
    });
  }
  return { entries, tip };
}

// "/" öneri menüsü: yazılan önekle başlayan komutlar
function suggest(text, { builtin = [], skills = [], commands = [] } = {}) {
  const q = String(text).toLowerCase();
  const { entries } = parseTable();
  const seen = new Set();
  const out = [];
  const add = (name, usage, desc, args) => {
    const full = '/' + name;
    if (seen.has(full) || !full.toLowerCase().startsWith(q)) return;
    seen.add(full);
    out.push({ name: full, usage, desc: desc || '', args });
  };
  entries.forEach((e) => add(e.name, e.usage, e.desc, e.args));
  builtin.forEach((n) => add(n, '/' + n, '', ARGS_EXTRA.has(n)));
  [...skills, ...commands].forEach((c) => add(c.name, '/' + c.name, c.description || '', true));
  return out;
}

// Gruplanmış, renkli /help çıktısı (aynı açıklamayı paylaşan komutlar tek satırda birleşir)
function helpLines({ skills = [], commands = [], cols = 80 } = {}) {
  const { entries, tip } = parseTable();
  const byName = new Map(entries.map((e) => [e.name, e]));
  const used = new Set();
  const merge = (list) => {
    const rows = [];
    for (const e of list) {
      const hit = rows.find((r) => r.desc === e.desc);
      if (hit) hit.usage += ' · ' + e.usage; else rows.push({ usage: e.usage, desc: e.desc });
    }
    return rows;
  };
  const groups = [];
  for (const [title, names] of GROUPS) {
    const list = names.map((n) => byName.get(n)).filter(Boolean);
    list.forEach((e) => used.add(e.name));
    if (list.length) groups.push([t(title), merge(list)]);
  }
  const rest = entries.filter((e) => !used.has(e.name) && e.name !== 'help');
  if (rest.length) groups.push([t('help_g_more'), merge(rest)]);
  const custom = [...skills, ...commands].slice(0, 12).map((c) => ({ usage: '/' + c.name, desc: c.description || '' }));
  if (custom.length) groups.push([t('skills_title'), custom]);
  const keyRows = String(t('help_keys')).split(String.fromCharCode(10)).map((l) => /^(.+?) {2,}(.+)$/.exec(l)).filter(Boolean).map((m) => ({ usage: m[1], desc: m[2] }));
  groups.push([t('help_g_keys'), keyRows]);
  const w = Math.min(34, Math.max(...groups.flatMap(([, rows]) => rows.map((r) => vlen(r.usage)))) + 2);
  const room = Math.max(20, cols - w - 6);
  const cut = (s) => { const a = [...String(s).replace(/\s+/g, ' ')]; return a.length > room ? a.slice(0, room - 1).join('') + '…' : a.join(''); };
  const out = ['', `  ${C.bold('SyzerCLI')} ${C.gray('· ' + t('help_title'))}`];
  for (const [title, rows] of groups) {
    out.push('', `  ${C.bold(title)}`);
    rows.forEach((r) => out.push(`  ${title === t('help_g_keys') ? C.cyan(pad(r.usage, w)) : C.orange(pad(r.usage, w))}${C.gray(cut(r.desc))}`));
  }
  if (tip) out.push('', `  ${C.gray(tip)}`);
  out.push('');
  return out;
}

module.exports = { parseTable, suggest, helpLines };
