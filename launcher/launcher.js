'use strict';

// syzer.exe girişi: GitHub'dan en son sürümü kontrol eder, gerekirse indirir, sonra uygulamayı çalıştırır.
const path = require('path');
const { createRequire } = require('module');
const U = require('../src/updater'); //@UPDATER

const argv = process.argv.slice(2);
const skip = process.env.SYZER_NO_UPDATE || process.env.ORCA_AGENT_LAUNCH_TOKEN || argv.includes('--no-update') || !process.stdout.isTTY || argv[0] === 'mcp' || argv[0] === 'serve';
const log = (m) => process.stderr.write(`${m}\n`);

// SyzerCLI-Setup.exe (ya da "syzer.exe install"): kendini kullanıcı dizinine kurar, PATH'e ekler, uygulamayı indirir.
const isSetup = process.platform === 'win32' && (path.basename(process.execPath).toLowerCase().includes('setup') || argv[0] === 'install');
const ps = (script) => require('child_process').execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
async function setup() {
  const fs = require('fs');
  const dir = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Programs', 'SyzerCLI');
  const dest = path.join(dir, 'syzer.exe');
  const q = (p) => p.replace(/'/g, "''");
  log('Installing SyzerCLI…');
  fs.mkdirSync(dir, { recursive: true });
  if (path.resolve(process.execPath).toLowerCase() !== dest.toLowerCase()) {
    try { fs.copyFileSync(process.execPath, dest); } catch (e) { throw new Error(`Cannot write ${dest} (is syzer running? close it and retry): ${e.message}`); }
  }
  log(`  -> ${dest}`);
  ps(`$d='${q(dir)}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains $d)) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $d).TrimStart(';')), 'User') }`);
  log('  -> added to your PATH');
  try {
    ps(`$m=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $m 'Syzer Code.lnk')); $s.TargetPath='${q(dest)}'; $s.IconLocation='${q(dest)},0'; $s.Save()`);
    log('  -> Start menu shortcut "Syzer Code"');
  } catch { /* kısayol isteğe bağlı */ }
  const info = await U.latest({ force: true });
  if (!U.installed() || U.cmpVer(info.version, U.installed()) > 0) { log(`Downloading SyzerCLI v${info.version}…`); await U.install(info); }
  log('\nDone. Open a NEW terminal and run: syzer');
}

async function main() {
  if (isSetup) {
    try { await setup(); } catch (e) { log(`Setup failed: ${e.message}`); process.exitCode = 1; }
    if (process.stdin.isTTY && !argv.includes('--no-pause')) { log('\nPress Enter to close…'); await new Promise((r) => { process.stdin.resume(); process.stdin.once('data', r); }); }
    return;
  }
  const forced = argv[0] === 'update';
  if (forced || !skip) {
    try {
      const have = U.installed();
      if (forced && have) log(`Checking for updates (current v${have})…`);
      const info = await U.latest({ force: forced });
      if (!have || U.cmpVer(info.version, have) > 0) {
        log(have ? `Update available: v${have} → v${info.version}. Downloading…` : `First run: downloading SyzerCLI v${info.version}…`);
        await U.install(info);
        log(`Updated to v${info.version}.`);
      } else if (forced) log(`SyzerCLI is up to date (v${have}).`);
    } catch (e) {
      if (!U.installed()) { log(`Cannot download SyzerCLI: ${e.message}\nCheck your connection or run "gh auth login" if the repo is private.`); process.exit(1); }
      if (forced) log(`Update check failed: ${e.message}`);
    }
    if (forced) return;
  }
  const ver = U.installed();
  if (!ver) { log('SyzerCLI is not installed yet and updates are disabled (SYZER_NO_UPDATE / non-interactive). Run "syzer update".'); process.exit(1); }
  process.env.SYZER_LAUNCHER = '1';
  const entry = path.join(U.APP_DIR, ver, 'bin', 'syzer.js');
  createRequire(entry)(entry);
}

main().catch((e) => { log(e.message); process.exit(1); });
