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

// Key havuzu: sağlayıcı başına hazır/toplam, soğumadaki sayısı, en kötü hata oranı. stats = keys-json.stats çıktısı.
function keyPoolRows(stats) {
  return stats.providers.filter((p) => p.keys.length).map((p) => {
    const cool = p.keys.filter((k) => k.cooldownSec > 0).length;
    const ready = p.keys.filter((k) => k.state === 'ready' && !k.cooldownSec).length;
    const worst = Math.max(0, ...p.keys.map((k) => k.failRate));
    const level = ready === 0 || cool || worst >= 0.5 ? 'warn' : 'ok';
    return { level, name: `${p.id} havuz`, detail: `${ready}/${p.keys.length} hazır, ${cool} soğumada, en kötü hata oranı %${Math.round(worst * 100)}` };
  });
}

// `syzer-orca doctor --json` çıktısı → satırlar. Şekil toleranslı: groups dizi ya da { ad: {...} } olabilir.
function orcaDoctorRows(d, { version, latest, cmpVer } = {}) {
  const rows = [];
  if (version) {
    const newer = latest && cmpVer && cmpVer(latest, version) > 0;
    rows.push({ level: newer ? 'warn' : 'ok', name: 'Orca eklenti sürümü', detail: `v${version}${latest ? ` (son sürüm v${latest}${newer ? ': "syzer orca update"' : ''})` : ''}` });
  }
  if (!d) return rows;
  if (d.error) { rows.push({ level: 'warn', name: 'Orca doctor', detail: d.error }); return rows; }
  const raw = d.groups || d.results || {};
  const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([k, v]) => (v && typeof v === 'object' ? { id: k, ...v } : { id: k, applied: v === true || v === 'applied' }));
  for (const g of list) {
    const name = String(g.id || g.name || g.group || '?');
    const st = String(g.status || '');
    const applied = g.applied === true || st === 'applied' || st === 'ok';
    const why = g.reason || g.why || (Array.isArray(g.reasons) ? g.reasons.join('; ') : g.reasons) || g.error || '';
    const anchorLost = /anchor.*(?:matched\s*0x|missing|not found)/i.test(String(why));
    rows.push({ level: applied ? 'ok' : 'warn', name: `Orca grup ${name}`, detail: applied ? 'uygulandı' : `atlandı${why ? `: ${why}` : ''}${anchorLost ? '; ilgili özellik devre dışı' : ''}` });
  }
  if (!list.length && d.exitCode === 2) rows.push({ level: 'warn', name: 'Orca doctor', detail: 'bazı gruplar atlandı' });
  return rows;
}

function orcaStatusRows(o, version) {
  if (!o || o.error || !o.found) return [];
  const base = `Orca ${o.orcaVersion || '?'}, eklenti v${version || '?'}`;
  if (!o.patched) return [{ level: 'warn', name: 'Orca yaması', detail: `${base}: Orca güncellemesinden sonra yama düşmüş veya uygulanmamış; Orca kapalıyken "syzer orca patch" çalıştırın` }];
  if (!o.upToDate) return [{ level: 'warn', name: 'Orca yaması', detail: `${base}: yama eski; Orca güncellemesi sonrası özellikler kaybolabilir. Orca kapalıyken "syzer orca patch" çalıştırın` }];
  return [{ level: 'ok', name: 'Orca yaması', detail: `${base}: güncel` }];
}

async function run(cfg, { online = false } = {}) {
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
  try { for (const r of keyPoolRows(require('./keys-json').stats())) rows.push(r); } catch (e) { add('warn', 'Key havuzu', e.message); }

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
        for (const r of orcaStatusRows(o, bridge.installedVersion())) rows.push(r);
        if (o.skippedGroups && o.skippedGroups.length) add('warn', 'Orca atlanan gruplar', o.skippedGroups.join(' | '));
      }
      if (o && !o.error) {
        let latest = null;
        if (online) { try { latest = (await bridge.latest()).version; } catch (e) { add('warn', 'Orca son sürüm', e.message); } }
        for (const r of orcaDoctorRows(bridge.doctorJson({ timeout: 5000 }), { version: bridge.installedVersion(), latest, cmpVer: require('./updater').cmpVer })) rows.push(r);
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

module.exports = { run, keyPoolRows, orcaDoctorRows, orcaStatusRows };
