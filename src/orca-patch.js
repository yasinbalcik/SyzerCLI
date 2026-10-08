'use strict';

// Orca entegrasyonu: Orca'nın kendi dosyalarına (app.asar) küçük, geri alınabilir yamalar uygular.
//   Usage paneli/durum çubuğu (Kimi yuvası → Syzer), ajan menüsü (Autohand yuvası → Syzer),
//   oturum geçmişi etiketi ve "devam et" komutu.
// Bağımlılıksız. Idempotent: kendi işaretini (marker) okuyarak yalnızca gerektiğinde çalışır; Orca açıkken dokunmaz.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const config = require('./config');

const PATCH_VERSION = 5;
const HOME = path.join(config.DIR, 'orca');
const LOG = path.join(HOME, 'patch.log');
const TASKS = ['SyzerOrcaPatch'];
const RUN_KEY = ['HKCU','Software','Microsoft','Windows','CurrentVersion','Run'].join(String.fromCharCode(92));

const ICON = `data:image/png;base64,${(() => { try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'syzer-icon.png')).toString('base64'); } catch { return ''; } })()}`;
const icon = (size) => `(0,J.jsx)(\`img\`,{src:\`${ICON}\`,width:${size},height:${size},alt:\`Syzer\`,style:{borderRadius:4}})`;

// Syzer'ı çalıştıracak komut (Orca ana süreci bunu çağırır): exe ise exe, değilse node + syzer.js
function selfCmd() {
  if (process.env.SYZER_LAUNCHER) return `"${process.execPath}"`;
  return `"${process.execPath}" "${path.join(__dirname, '..', 'bin', 'syzer.js')}"`;
}

function mainFetch(cmd) {
  return 'return(async()=>{const cp=process.getBuiltinModule?process.getBuiltinModule(`child_process`):require(`child_process`);' +
    'const base={provider:`kimi`,weekly:null,updatedAt:Date.now()};' +
    `return await new Promise(r=>cp.execFile(process.env.SYZER_BIN||${JSON.stringify(cmd)},[\`usage\`,\`--summary\`,\`--json\`],{timeout:20000,shell:true,windowsHide:true,maxBuffer:1<<20},(err,out)=>{` +
    'if(err)return r({...base,session:null,error:`syzer: `+String(err.message).split(String.fromCharCode(10))[0],status:`error`});' +
    'try{const j=JSON.parse(out);const ps=(j.providers||[]).filter(p=>p.percent_used!=null);' +
    'if(!ps.length)return r({...base,session:null,error:`No quota info (${j.keys_ready}/${j.keys_total} keys ready)`,status:`unavailable`});' +
    'const reset=ps.map(p=>p.resets_at?Date.parse(p.resets_at):null).filter(Boolean).sort()[0]||Date.now()+864e5;' +
    'const mk=(name,u,badge,detail,ra)=>({name,usedPercent:u,windowMinutes:1440,resetsAt:ra,resetDescription:badge,badge,detail});' +
    'const left=p=>p.limit!=null?`${Math.max(0,p.limit-(p.used||0))} left`:`quota n/a`;' +
    'const lim=ps.filter(p=>p.limit!=null);const tl=lim.length?`${lim.reduce((a,p)=>a+Math.max(0,p.limit-(p.used||0)),0)} left`:`quota n/a`;' +
    'const total=mk(`Total`,Math.round(ps.reduce((a,p)=>a+p.percent_used,0)/ps.length),`${j.keys_ready}/${j.keys_total} keys`,tl,reset);' +
    'const buckets=[...ps.map(p=>mk(p.name,p.percent_used,`${p.keys_ready}/${p.keys_total} keys`,left(p),p.resets_at?Date.parse(p.resets_at):reset)),total];' +
    'r({...base,session:total,buckets,error:null,status:`ok`})}' +
    'catch(e){r({...base,session:null,error:`syzer: bad JSON`,status:`error`})}}))})();';
}

const SB = /^out\/renderer\/assets\/StatusBar-.*\.js$/;
const markerOf = (cmd) => `/*syzer-orca:${PATCH_VERSION}:${crypto.createHash('sha1').update(cmd).digest('hex').slice(0, 8)}*/`;

function edits(cmd) {
  const marker = markerOf(cmd);
  return [
    { glob: /^out\/renderer\/assets\/agent-catalog-.*\.js$/, from: 'cmd:`hermes`,faviconDomain:`nousresearch.com`', to: 'cmd:`hermes`,iconUrl:`' + ICON + '`' },
    { glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: 'hermes:`Hermes`', to: 'hermes:`Syzer`' },
    { glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: 'e===`hermes`?`hermes`', to: 'e===`hermes`?`syzer`' },
    { glob: /^out\/renderer\/assets\/ai-vault-session-resume-preparation-.*\.js$/, from: 'e===`hermes`?`hermes`', to: 'e===`hermes`?`syzer`' },
    { file: 'out/main/index.js', from: 'agentType:`hermes`,toolName:o.toolName', to: 'agentType:i&&i.orca_agent_type===`autohand`?`autohand`:`hermes`,toolName:o.toolName' },
    { glob: /^out\/renderer\/assets\/agent-catalog-.*\.js$/, from: '{id:`autohand`,label:a(`auto.lib.agent.catalog.1f8a19e9ad`,`Autohand Code`),cmd:`autohand`,faviconDomain:`autohand.ai`,homepageUrl:`https://github.com/autohandai/code-cli`}', to: '{id:`autohand`,label:`Syzer`,cmd:`syzer`,iconUrl:`' + ICON + '`,searchAliases:[`syzercli`,`openrouter`,`nvidia`],homepageUrl:`https://github.com/yasinbalcik/SyzerCLI`}' },
    { glob: /^out\/renderer\/assets\/store-.*\.js$/, from: 'autohand:{detectCmd:`autohand`,', to: 'autohand:{detectCmd:`syzer`,' },
    { glob: /^out\/main\/chunks\/tui-agent-config-.*\.js$/, from: 'autohand:{detectCmd:`autohand`,', to: 'autohand:{detectCmd:`syzer`,' },
    { glob: /^out\/main\/chunks\/tui-agent-display-names-.*\.js$/, from: 'autohand:`Autohand Code`', to: 'autohand:`Syzer`' },
    { glob: SB, from: '(0,J.jsx)(`div`,{className:`font-medium ${n}`,children:t}),(0,J.jsx)(`div`,{className:`h-[6px]', to: '(0,J.jsxs)(`div`,{className:`flex justify-between font-medium ${n}`,children:[t,e.badge?(0,J.jsx)(`span`,{className:`font-normal opacity-70`,children:e.badge}):null]}),(0,J.jsx)(`div`,{className:`h-[6px]' },
    { glob: SB, from: 'd&&(0,J.jsx)(`span`,{children:d})]})]})}function At(', to: 'e.detail&&(0,J.jsx)(`span`,{children:e.detail}),d&&(0,J.jsx)(`span`,{children:d})]})]})}function At(' },
    { glob: SB, from: 'e===`kimi`?(0,J.jsx)(G,{agent:`kimi`,size:13})', to: `e===\`kimi\`?${icon(13)}` },
    { glob: SB, from: '(0,J.jsx)(G,{agent:`kimi`,size:14})', to: icon(14) },
    { file: 'out/main/index.js', from: 'fetchKimiWithResolvedHome(){', to: `fetchKimiWithResolvedHome(){${marker}${mainFetch(cmd)}` },
    { glob: SB, from: 'e===`kimi`?`Kimi`:', to: 'e===`kimi`?`Syzer`:' },
    { glob: SB, from: '`Kimi Usage`', to: '`Syzer Usage`' },
    { glob: SB, from: 'case`kimi`:return`K`', to: 'case`kimi`:return`S`' },
    { glob: /^out\/renderer\/assets\/status-bar-agent-gating-.*\.js$/, from: '`gemini`,`kimi`,`antigravity`,`grok`,`zcode`]);function D', to: '`gemini`,`antigravity`,`grok`,`zcode`]);function D' },
    { glob: SB, from: 'e===`zcode`?t.zcodePlanApiKeyConfigured===!0:!1:!1}', to: 'e===`zcode`?t.zcodePlanApiKeyConfigured===!0:e===`kimi`||!1:!1}' },
  ];
}

// ---------- asar (bağımlılıksız) ----------
const align4 = (n) => (n + 3) & ~3;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function integrity(buf) {
  const BS = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += BS) blocks.push(sha(buf.subarray(i, i + BS)));
  return { algorithm: 'SHA256', hash: sha(buf), blockSize: BS, blocks: blocks.length ? blocks : [sha(Buffer.alloc(0))] };
}

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const h = Buffer.alloc(16);
  fs.readSync(fd, h, 0, 16, 0);
  const headerSize = h.readUInt32LE(4);
  const jsonLen = h.readUInt32LE(12);
  if (h.readUInt32LE(0) !== 4 || h.readUInt32LE(8) !== 4 + align4(jsonLen) || headerSize !== 4 + h.readUInt32LE(8)) { fs.closeSync(fd); throw new Error('unexpected asar header layout'); }
  const jb = Buffer.alloc(jsonLen);
  fs.readSync(fd, jb, 0, jsonLen, 16);
  const header = JSON.parse(jb.toString('utf8'));
  const dataStart = 8 + headerSize;
  const size = fs.fstatSync(fd).size;
  const files = [];
  (function rec(node, p) { for (const [k, v] of Object.entries(node.files || {})) { const q = p ? `${p}/${k}` : k; if (v.files) rec(v, q); else files.push(q); } })(header, '');
  const node = (p) => p.split('/').reduce((n, k) => n.files[k], header);
  return {
    header, files, node, dataStart, dataLen: size - dataStart,
    read(p) { const e = node(p); const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, dataStart + Number(e.offset)); return b; },
    copyData() { const b = Buffer.alloc(size - dataStart); fs.readSync(fd, b, 0, b.length, dataStart); return b; },
    close() { fs.closeSync(fd); },
  };
}

function writeAsar(out, header, dataBuf, extra) {
  let dataLen = dataBuf.length;
  const parts = [dataBuf];
  for (const { entry, buf } of extra) { entry.offset = String(dataLen); parts.push(buf); dataLen += buf.length; }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const head = Buffer.alloc(16 + align4(json.length));
  head.writeUInt32LE(4, 0); head.writeUInt32LE(8 + align4(json.length), 4); head.writeUInt32LE(4 + align4(json.length), 8); head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  fs.writeFileSync(out, Buffer.concat([head, ...parts]));
}

// ---------- Orca bulma / durum ----------
const log = (m) => { try { fs.mkdirSync(HOME, { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); if (fs.statSync(LOG).size > 200000) fs.writeFileSync(LOG, ''); } catch { /* önemsiz */ } };

function locate() {
  const cands = [process.env.ORCA_DIR, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'orca'), 'C:\\Program Files\\Orca'].filter(Boolean);
  for (const d of cands) if (fs.existsSync(path.join(d, 'resources', 'app.asar'))) return d;
  return null;
}
const orcaRunning = () => { if (process.env.SYZER_ORCA_SKIP_RUNNING_CHECK) return false; try { return /orca\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Orca.exe', '/NH'], { encoding: 'utf8' })); } catch { return false; } };
const markerRe = /\/\*syzer-orca:(\d+):([0-9a-f]{8})\*\//;

function paths(dir) {
  const asarFile = path.join(dir, 'resources', 'app.asar');
  return { asarFile, backup: `${asarFile}.syzer-orig`, meta: `${asarFile}.syzer-orig.json`, unpacked: `${asarFile}.unpacked` };
}

// Mevcut asar: işaret + (sürüm) bilgisini oku
function inspect(dir) {
  const P = paths(dir);
  const a = openAsar(P.asarFile);
  try {
    const main = a.read('out/main/index.js').toString('utf8');
    const m = main.match(markerRe);
    const pkg = JSON.parse(a.read('package.json').toString('utf8'));
    return { marker: m ? { v: Number(m[1]), h: m[2] } : null, orcaVersion: pkg.version };
  } finally { a.close(); }
}

function status() {
  const dir = locate();
  if (!dir) return { found: false };
  try {
    const cmd = selfCmd();
    const i = inspect(dir);
    const want = markerOf(cmd).match(markerRe);
    const applied = !!i.marker && i.marker.v === Number(want[1]) && i.marker.h === want[2];
    return { found: true, dir, orcaVersion: i.orcaVersion, patched: !!i.marker, upToDate: applied, running: orcaRunning() };
  } catch (e) { return { found: true, dir, error: e.message }; }
}

// ---------- yamayı uygula ----------
function buildPatched(dir, srcAsar, unpackedSrc, cmd) {
  const a = openAsar(srcAsar);
  try {
    const edited = new Map();
    const read = (f) => edited.get(f) ?? (a.node(f).unpacked ? fs.readFileSync(unpackedSrc(f), 'utf8') : a.read(f).toString('utf8'));
    for (const ed of edits(cmd)) {
      let targets = a.files.filter((f) => (ed.file ? f === ed.file : ed.glob.test(f)));
      if (ed.glob && targets.length > 1) targets = targets.filter((f) => read(f).includes(ed.from));
      if (targets.length !== 1) throw new Error(`anchor file not found/ambiguous: ${ed.file || ed.glob} (${targets.length})`);
      const f = targets[0];
      const cur = read(f);
      const n = cur.split(ed.from).length - 1;
      if (n !== 1) throw new Error(`anchor "${ed.from.slice(0, 60)}…" matched ${n}× in ${f}`);
      edited.set(f, cur.replace(ed.from, () => ed.to));
    }
    const header = JSON.parse(JSON.stringify(a.header));
    const nodeOf = (p) => p.split('/').reduce((n, k) => n.files[k], header);
    const extra = [];
    const unpacked = [];
    for (const [f, text] of edited) {
      const buf = Buffer.from(text, 'utf8');
      const e = nodeOf(f);
      if (e.integrity) e.integrity = integrity(buf);
      e.size = buf.length;
      if (e.unpacked) unpacked.push({ f, buf }); else extra.push({ entry: e, buf, f });
    }
    return { header, data: a.copyData(), extra, unpacked };
  } finally { a.close(); }
}

// opts: { dryRun, quiet }. Dönüş: { status: 'applied'|'up-to-date'|'running'|'not-found'|'incompatible'|'error', detail }
function patch(opts = {}) {
  const dir = locate();
  if (!dir) return { status: 'not-found' };
  const cmd = selfCmd();
  const P = paths(dir);
  try {
    const st = inspect(dir);
    const want = markerOf(cmd).match(markerRe);
    const applied = st.marker && st.marker.v === Number(want[1]) && st.marker.h === want[2];
    if (applied && !opts.dryRun) {
      // unpacked dosyalar da yamalı mı? (yarım kalmış işlem kontrolü)
      const probe = edits(cmd).filter((e) => e.glob && /main\\\/chunks/.test(String(e.glob)));
      let ok = true;
      for (const e of probe) {
        const dirp = path.join(P.unpacked, 'out', 'main', 'chunks');
        const hit = fs.existsSync(dirp) ? fs.readdirSync(dirp).find((n) => e.glob.test(`out/main/chunks/${n}`)) : null;
        if (hit && !fs.readFileSync(path.join(dirp, hit), 'utf8').includes(e.to)) ok = false;
      }
      if (ok) return { status: 'up-to-date' };
    }
    if (!opts.dryRun && orcaRunning()) return { status: 'running' };

    // Kaynak = yamasız orijinal
    let srcAsar = P.asarFile;
    const plain = (f) => path.join(P.unpacked, ...f.split('/'));
    const orig = (f) => (fs.existsSync(`${plain(f)}.syzer-orig`) ? `${plain(f)}.syzer-orig` : plain(f));
    let unpackedSrc = plain;
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(P.meta, 'utf8')); } catch { /* yok */ }
    const legacy = !st.marker && fs.existsSync(P.backup) && !meta; // eski araçla (patch-orca.js) yamalanmış
    if (st.marker || legacy) {
      if (legacy) {
        const b = openAsar(P.backup);
        let bv; try { bv = JSON.parse(b.read('package.json').toString('utf8')).version; } finally { b.close(); }
        if (bv !== st.orcaVersion) return { status: 'incompatible', detail: 'old backup is from another Orca version' };
        meta = { orcaVersion: bv, at: Date.now() };
        if (!opts.dryRun) fs.writeFileSync(P.meta, JSON.stringify(meta));
      }
      if (!fs.existsSync(P.backup) || !meta || meta.orcaVersion !== st.orcaVersion) return { status: 'incompatible', detail: 'patched asar without a matching backup; reinstall Orca or run "syzer orca restore"' };
      srcAsar = P.backup;
      unpackedSrc = orig;
    } else if (!opts.dryRun) {
      // yamasız (yeni/güncellenmiş Orca): bu, yeni orijinaldir → yedeği tazele
      fs.copyFileSync(P.asarFile, P.backup);
      fs.writeFileSync(P.meta, JSON.stringify({ orcaVersion: st.orcaVersion, at: Date.now() }));
    }
    const wasPatched = !!(st.marker || legacy);

    const built = buildPatched(dir, srcAsar, unpackedSrc, cmd);
    if (opts.dryRun) return { status: 'dry-run-ok', detail: `${built.extra.length + built.unpacked.length} files would be patched (Orca ${st.orcaVersion})` };

    // unpacked dosyalar: orijinali .syzer-orig olarak sakla, yamalıyı yaz
    for (const { f, buf } of built.unpacked) {
      const dst = path.join(P.unpacked, ...f.split('/'));
      if (!wasPatched) fs.copyFileSync(dst, `${dst}.syzer-orig`);
      fs.writeFileSync(dst, buf);
    }
    const tmp = `${P.asarFile}.syzer-new`;
    writeAsar(tmp, built.header, built.data, built.extra);
    const chk = openAsar(tmp);
    try {
      for (const { f, buf } of built.extra) if (!chk.read(f).equals(buf)) throw new Error(`verify failed: ${f}`);
    } finally { chk.close(); }
    fs.renameSync(tmp, P.asarFile);
    return { status: 'applied', detail: `Orca ${st.orcaVersion}` };
  } catch (e) {
    try { fs.rmSync(`${P.asarFile}.syzer-new`, { force: true }); } catch { /* önemsiz */ }
    return { status: /anchor/.test(e.message) ? 'incompatible' : 'error', detail: e.message };
  }
}

function restore() {
  const dir = locate();
  if (!dir) return { status: 'not-found' };
  if (orcaRunning()) return { status: 'running' };
  const P = paths(dir);
  if (!fs.existsSync(P.backup)) return { status: 'error', detail: 'no backup' };
  fs.copyFileSync(P.backup, P.asarFile);
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  for (const f of walk(P.unpacked).filter((x) => x.endsWith('.syzer-orig'))) fs.copyFileSync(f, f.slice(0, -'.syzer-orig'.length));
  return { status: 'restored' };
}

// ---------- otomatik bakım: Zamanlanmış Görev + (isteğe bağlı) başlatıcı kısayolu ----------
function install({ shortcut = false } = {}) {
  if (process.platform !== 'win32') return { status: 'error', detail: 'automatic maintenance is Windows-only for now' };
  fs.mkdirSync(HOME, { recursive: true });
  const exe = process.env.SYZER_LAUNCHER ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname, '..', 'bin', 'syzer.js')}"`;
  const q = (s) => s.replace(/"/g, '""');
  const vbs = path.join(HOME, 'patch.vbs');
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${q(exe)} orca patch --quiet", 0, True\r\n`);
  const create = (name, schedule) => spawnSync('schtasks', ['/Create', '/F', '/TN', name, '/TR', `wscript.exe //B "${vbs}"`, ...schedule], { encoding: 'utf8' });
  const r1 = create(TASKS[0], ['/SC', 'MINUTE', '/MO', '10']);
  // oturum açılışında da çalışsın (yönetici izni gerektirmeyen Run anahtarı)
  const r2 = spawnSync('reg', ['add', RUN_KEY, '/v', 'SyzerOrcaPatch', '/t', 'REG_SZ', '/d', `wscript.exe //B "${vbs}"`, '/f'], { encoding: 'utf8' });
  if (r1.status !== 0) return { status: 'error', detail: (r1.stderr || r1.stdout || '').trim() };
  let lnk = null;
  if (shortcut) {
    const dir = locate();
    if (dir) {
      const start = path.join(HOME, 'orca-start.vbs');
      fs.writeFileSync(start, `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "${q(exe)} orca patch --quiet", 0, True\r\nsh.Run """${path.join(dir, 'Orca.exe')}""", 1, False\r\n`);
      lnk = path.join(os.homedir(), 'Desktop', 'Orca (Syzer).lnk');
      const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='wscript.exe';$s.Arguments='//B "${start}"';$s.IconLocation='${path.join(dir, 'Orca.exe')},0';$s.Save()`;
      spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    }
  }
  return { status: 'installed', detail: `task: ${TASKS.join(', ')} (every 10 min) + logon${r2.status === 0 ? '' : ' (logon entry failed)'}${lnk ? `; shortcut: ${lnk}` : ''}` };
}

function uninstall() {
  if (process.platform === 'win32') for (const t of TASKS) spawnSync('schtasks', ['/Delete', '/F', '/TN', t], { encoding: 'utf8' });
  if (process.platform === 'win32') spawnSync('reg', ['delete', RUN_KEY, '/v', 'SyzerOrcaPatch', '/f'], { encoding: 'utf8' });
  try { fs.rmSync(path.join(os.homedir(), 'Desktop', 'Orca (Syzer).lnk'), { force: true }); } catch { /* yok */ }
  return { status: 'uninstalled' };
}

// CLI: syzer orca <status|patch|install|uninstall|restore> [--quiet] [--dry-run] [--shortcut]
function run(sub, flags = {}) {
  let r;
  if (sub === 'patch') { r = patch({ dryRun: flags.dryRun, quiet: flags.quiet }); log(`patch: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`); }
  else if (sub === 'install') { r = install({ shortcut: flags.shortcut }); const p = patch(); r.patch = p; log(`install: ${r.status}; patch: ${p.status}`); }
  else if (sub === 'uninstall') r = uninstall();
  else if (sub === 'restore') r = restore();
  else r = status();
  if (!flags.quiet) console.log(JSON.stringify(r, null, 2));
  if (['error', 'incompatible'].includes(r.status)) process.exitCode = 1;
  return r;
}

module.exports = { run, patch, status, install, uninstall, restore, PATCH_VERSION };
