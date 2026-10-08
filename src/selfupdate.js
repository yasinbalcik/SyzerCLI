'use strict';

// npm/terminal kurulumunun açılışta kendini güncellemesi (exe launcher'ın karşılığı): GitHub'daki son sürüme bakar,
// yeniyse `npm install -g github:<repo>#v<sürüm>` çalıştırır ve komutu yeni sürümle yeniden başlatır.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');
const U = require('./updater');

const ROOT = path.join(__dirname, '..');
const FAIL_FILE = path.join(U.HOME, 'selfupdate-fail.json');
const FAIL_TTL = 6 * 60 * 60 * 1000; // başarısız denemeden sonra aynı sürüm için 6 saat dinlen
const log = (m) => process.stderr.write(`${m}\n`);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// Geliştirme kopyası (git checkout) ve exe launcher kendini bu yolla güncellemez
const eligible = () => !process.env.SYZER_LAUNCHER && !process.env.SYZER_SELFUPDATED && !fs.existsSync(path.join(ROOT, '.git'));

function install(version) {
  const spec = `github:${U.REPO}#v${version}`;
  const r = spawnSync(`npm install -g "${spec}"`, { encoding: 'utf8', shell: true, timeout: 180000 });
  if (r.status !== 0) throw new Error(((r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ')) || `npm exit ${r.status}`);
}

// true → güncellendi ve komut yeni sürümle çalıştırıldı (çağıran çıkmalı; kod process.exitCode'a yazılır)
async function run({ force = false, quiet = false } = {}) {
  if (!eligible()) return false;
  let info;
  try { info = await U.latest({ force }); } catch (e) { if (force) log(`Update check failed: ${e.message}`); return false; }
  if (U.cmpVer(info.version, pkg.version) <= 0) { if (force && !quiet) log(`SyzerCLI is up to date (v${pkg.version}).`); return false; }
  const fail = readJson(FAIL_FILE);
  if (!force && fail && fail.version === info.version && Date.now() - fail.at < FAIL_TTL) return false;
  log(`Update available: v${pkg.version} → v${info.version}. Installing…`);
  try { install(info.version); } catch (e) {
    try { fs.mkdirSync(U.HOME, { recursive: true }); fs.writeFileSync(FAIL_FILE, JSON.stringify({ version: info.version, at: Date.now() })); } catch { /* önemsiz */ }
    log(`Update failed (continuing with v${pkg.version}): ${e.message}`);
    return false;
  }
  try { fs.rmSync(FAIL_FILE, { force: true }); } catch { /* önemsiz */ }
  log(`Updated to v${info.version}.`);
  if (force) return true;
  const r = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, SYZER_SELFUPDATED: '1' } });
  process.exitCode = r.status == null ? 1 : r.status;
  return true;
}

// Otomatik kontrol atlanacak durumlar (launcher ile aynı mantık)
const skip = (argv) => !!(process.env.SYZER_NO_UPDATE || process.env.ORCA_AGENT_LAUNCH_TOKEN || argv.includes('--no-update')
  || !process.stdout.isTTY || ['mcp', 'serve', 'update'].includes(argv[0]));

module.exports = { run, skip, eligible };
