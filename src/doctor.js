'use strict';
// syzer doctor: kurulum ve ortam sağlık denetimi (ağ + key biçimi + Orca yaması). Hiçbir şeyi değiştirmez.
const fs = require('fs');
const os = require('os');
const config = require('./config');
const providers = require('./providers');

const mark = { ok: '✔', warn: '!', fail: '✖' };

async function reach(url) {
  try { const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6000) }); return r.status < 500 ? { ok: true, detail: `HTTP ${r.status}` } : { ok: false, detail: `HTTP ${r.status}` }; } catch (e) { return { ok: false, detail: e.message }; }
}

async function run(cfg) {
  const rows = [];
  const add = (level, name, detail) => rows.push({ level, name, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 18 ? 'ok' : 'fail', 'Node.js', `v${process.versions.node}${major >= 18 ? '' : ' (18+ gerekli)'}`);
  add('ok', 'Platform', `${process.platform} ${os.release()} ${process.arch}`);
  add(fs.existsSync(config.DIR) ? 'ok' : 'warn', 'Veri klasörü', config.DIR);

  for (const p of Object.keys(providers.PROVIDERS)) {
    const { keys } = config.loadKeys(p);
    const valid = keys.filter((k) => providers.keyRegex(providers.PROVIDERS[p]).test(typeof k === 'string' ? k : k.key || ''));
    add(valid.length ? 'ok' : (p === (cfg && cfg.provider) ? 'fail' : 'warn'), `${p} key`, `${keys.length} kayıtlı, ${valid.length} biçimi geçerli`);
  }
  add('ok', 'Etkin sağlayıcı', String(cfg && cfg.provider));

  const net = await Promise.all([['OpenRouter', 'https://openrouter.ai/api/v1/models'], ['NVIDIA', 'https://integrate.api.nvidia.com/v1/models'], ['GitHub', 'https://api.github.com']].map(async ([n, u]) => [n, await reach(u)]));
  for (const [n, r] of net) add(r.ok ? 'ok' : 'warn', `Ağ: ${n}`, r.detail);

  if (process.platform === 'win32') {
    try {
      const bridge = require('./orca-bridge');
      const o = bridge.status();
      if (!o) add('warn', 'Orca eklentisi', 'kurulu değil ("syzer orca install --shortcut"), isteğe bağlı');
      else if (o.error) add('fail', 'Orca eklentisi', o.error);
      else if (!o.found) add('warn', 'Orca', 'bulunamadı (isteğe bağlı)');
      else {
        add(o.upToDate ? 'ok' : 'warn', 'Orca yaması', `Orca ${o.orcaVersion}, eklenti v${bridge.installedVersion()}: ${o.patched ? (o.upToDate ? 'güncel' : 'eski sürüm, Orca kapalıyken "syzer orca patch" ya da masaüstü kısayolu') : 'uygulanmamış ("syzer orca install --shortcut")'}`);
        if (o.skippedGroups && o.skippedGroups.length) add('warn', 'Orca atlanan gruplar', o.skippedGroups.join(' | '));
      }
    } catch (e) { add('warn', 'Orca', e.message); }
  }

  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${mark[r.level]} ${r.name.padEnd(w)}  ${r.detail}`);
  const bad = rows.filter((r) => r.level === 'fail').length;
  console.log(bad ? `\n${bad} sorun bulundu.` : '\nSorun yok.');
  if (bad) process.exitCode = 1;
  return rows;
}

module.exports = { run };
