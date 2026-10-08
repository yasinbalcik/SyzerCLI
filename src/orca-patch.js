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

const PATCH_VERSION = 11;
const HOME = path.join(config.DIR, 'orca');
const LOG = path.join(HOME, 'patch.log');
const TASKS = ['SyzerOrcaPatch'];
const RUN_KEY = ['HKCU','Software','Microsoft','Windows','CurrentVersion','Run'].join(String.fromCharCode(92));

const ICON = `data:image/png;base64,${(() => { try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'syzer-icon.png')).toString('base64'); } catch { return ''; } })()}`;

// Syzer'ı çalıştıracak komut (Orca ana süreci bunu çağırır): exe ise exe, değilse node + syzer.js
function selfCmd() {
  if (process.env.SYZER_LAUNCHER) return `"${process.execPath}"`;
  return `"${process.execPath}" "${path.join(__dirname, '..', 'bin', 'syzer.js')}"`;
}

// Yama kaynağının özeti: orca-edits*/snippet dosyaları değişince işaret kendiliğinden değişir (PATCH_VERSION artırmayı unutmak yamayı bayatlatamaz)
function sourceHash() {
  const h = crypto.createHash('sha1');
  const files = [];
  for (const f of fs.readdirSync(__dirname)) if (/^orca-(edits|analytics)[\w-]*\.js$/.test(f)) files.push(path.join(__dirname, f));
  try { const sd = path.join(__dirname, 'orca-snippets'); for (const f of fs.readdirSync(sd)) files.push(path.join(sd, f)); } catch { /* yok */ }
  for (const f of files.sort()) { try { h.update(path.basename(f)).update(fs.readFileSync(f)); } catch { /* önemsiz */ } }
  return h.digest('hex');
}
const markerOf = (cmd) => `/*syzer-orca:${PATCH_VERSION}:${crypto.createHash('sha1').update(cmd).update(sourceHash()).update(`skip:${skipList().join(',')}`).digest('hex').slice(0, 8)}*/`;
// Hata ayıklama: bazı yama gruplarını kalıcı olarak atla (syzer orca skip restore,usage). Boş = hepsi uygulanır.
const SKIP_FILE = path.join(os.homedir(), '.syzercli', 'orca', 'skip-groups.txt');
const skipList = () => { try { return fs.readFileSync(SKIP_FILE, 'utf8').split(/[\s,]+/).filter(Boolean); } catch { return []; } };
const GROUPS_FILE = path.join(os.homedir(), '.syzercli', 'orca', 'groups.json');
const readGroups = () => { try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return null; } };
const edits = (cmd) => require('./orca-edits').edits(cmd, ICON, markerOf(cmd));

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
    const g = readGroups();
    return { found: true, dir, orcaVersion: i.orcaVersion, patched: !!i.marker, upToDate: applied, running: orcaRunning(), ...(g && g.orcaVersion === i.orcaVersion ? { groups: g.applied, skippedGroups: g.skipped } : {}) };
  } catch (e) { return { found: true, dir, error: e.message }; }
}

// ---------- yamayı uygula ----------
function buildPatched(dir, srcAsar, unpackedSrc, cmd) {
  const a = openAsar(srcAsar);
  try {
    const edited = new Map();
    const read = (f) => edited.get(f) ?? (a.node(f).unpacked ? fs.readFileSync(unpackedSrc(f), 'utf8') : a.read(f).toString('utf8'));
    const groups = new Map();
    for (const ed of edits(cmd)) { if (!groups.has(ed.group)) groups.set(ed.group, []); groups.get(ed.group).push(ed); }
    const skipped = [];
    for (const [name, list] of groups) {
      if (name !== 'core' && skipList().includes(name)) { skipped.push(`${name} (skipped by user)`); continue; }
      const snapshot = new Map(edited);
      try {
        for (const ed of list) {
          let targets = a.files.filter((f) => (ed.file ? f === ed.file : ed.glob.test(f)));
          if (ed.glob && targets.length > 1) targets = targets.filter((f) => read(f).includes(ed.from));
          if (targets.length !== 1) throw new Error(`anchor file not found/ambiguous: ${ed.file || ed.glob} (${targets.length})`);
          const f = targets[0];
          const cur = read(f);
          const n = cur.split(ed.from).length - 1;
          if (n !== 1) throw new Error(`anchor "${ed.from.slice(0, 60)}…" matched ${n}× in ${f}`);
          edited.set(f, cur.replace(ed.from, () => ed.to));
        }
      } catch (e) {
        if (name === 'core') throw e;
        edited.clear(); for (const [k, v] of snapshot) edited.set(k, v); // grubu geri al: yarım yama bırakma
        skipped.push(`${name} (${e.message})`);
      }
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
    return { header, data: a.copyData(), extra, unpacked, skipped, groupNames: [...groups.keys()] };
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
    if (applied && !opts.dryRun) return { status: 'up-to-date' }; // işaret asar'a en son yazılır → unpacked dosyalar da tamamdır
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
    if (opts.dryRun) return { status: 'dry-run-ok', detail: `${built.extra.length + built.unpacked.length} files would be patched (Orca ${st.orcaVersion})${built.skipped.length ? `; skipped: ${built.skipped.join(' | ')}` : ''}` };

    // unpacked dosyalar: orijinali .syzer-orig olarak sakla (yoksa; yamalı bir dosya "orijinal" diye yedeklenmez), sonra yamalıyı yaz
    for (const { f } of built.unpacked) {
      const dst = path.join(P.unpacked, ...f.split('/'));
      if (!fs.existsSync(`${dst}.syzer-orig`) && /syzer/i.test(fs.readFileSync(dst, 'utf8'))) {
        return { status: 'error', detail: `original of ${f} is missing (file already patched); run "syzer orca restore" or reinstall Orca` };
      }
    }
    for (const { f, buf } of built.unpacked) {
      const dst = path.join(P.unpacked, ...f.split('/'));
      if (!fs.existsSync(`${dst}.syzer-orig`)) fs.copyFileSync(dst, `${dst}.syzer-orig`);
      fs.writeFileSync(dst, buf);
    }
    const tmp = `${P.asarFile}.syzer-new`;
    writeAsar(tmp, built.header, built.data, built.extra);
    const chk = openAsar(tmp);
    try {
      for (const { f, buf } of built.extra) if (!chk.read(f).equals(buf)) throw new Error(`verify failed: ${f}`);
    } finally { chk.close(); }
    fs.renameSync(tmp, P.asarFile);
    try { fs.mkdirSync(path.dirname(GROUPS_FILE), { recursive: true }); fs.writeFileSync(GROUPS_FILE, JSON.stringify({ orcaVersion: st.orcaVersion, at: Date.now(), applied: built.groupNames.filter((n) => !built.skipped.some((x) => x.startsWith(`${n} (`))), skipped: built.skipped })); } catch { /* önemsiz */ }
    return { status: 'applied', detail: `Orca ${st.orcaVersion}${built.skipped.length ? `; skipped: ${built.skipped.join(' | ')}` : ''}` };
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
  else if (sub === 'skip') {
    const names = String(flags.arg || '').split(/[\s,]+/).filter(Boolean);
    fs.mkdirSync(path.dirname(SKIP_FILE), { recursive: true });
    if (names.length) fs.writeFileSync(SKIP_FILE, names.join(',')); else fs.rmSync(SKIP_FILE, { force: true });
    r = { status: 'ok', skip: names, detail: 'Orca kapalıyken "syzer orca patch" (veya masaüstü kısayolu) ile uygula' };
  }
  else if (sub === 'config') {
    // syzer orca config [killShellsOnQuit on|off]
    const SETTINGS = path.join(os.homedir(), '.syzercli', 'orca', 'settings.json');
    let cur = {}; try { cur = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { /* yok */ }
    const [key, val] = String(flags.arg || '').split(',');
    if (key) {
      if (key !== 'killShellsOnQuit' || !/^(on|off)$/.test(val || '')) r = { status: 'error', detail: 'kullanım: syzer orca config killShellsOnQuit on|off' };
      else { cur[key] = val === 'on'; fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(cur, null, 2)); r = { status: 'ok', settings: { killShellsOnQuit: cur.killShellsOnQuit !== false } }; }
    } else r = { status: 'ok', settings: { killShellsOnQuit: cur.killShellsOnQuit !== false }, file: SETTINGS };
  }
  else if (sub === 'uninstall') r = uninstall();
  else if (sub === 'restore') r = restore();
  else r = status();
  if (!flags.quiet) console.log(JSON.stringify(r, null, 2));
  if (['error', 'incompatible'].includes(r.status)) process.exitCode = 1;
  return r;
}

module.exports = { run, patch, status, install, uninstall, restore, PATCH_VERSION, markerOf, sourceHash, edits, openAsar };
