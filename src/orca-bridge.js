'use strict';
// `syzer orca ...` köprüsü. Orca eklentisi ayrı bir projedir (github.com/yasinbalcik/SyzerCLI-Orca): bu modül eklentinin son release'ini
// indirir (~/.syzercli/orca-plugin/app), Orca'nın çağıracağı Syzer komutunu (SYZER_CLI_CMD) verip eklentiyi çalıştırır.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('./updater');

const PLUGIN_REPO = process.env.SYZER_ORCA_REPO || 'yasinbalcik/SyzerCLI-Orca';
const DIR = path.join(U.HOME, 'orca-plugin');
const APP = path.join(DIR, 'app');
const ENTRY_REL = path.join('bin', 'syzer-orca.js');

// Geliştirme/test: SYZER_ORCA_PLUGIN_DIR eklentiyi yerel bir klasörden çalıştırır (indirme yok).
const pluginRoot = () => process.env.SYZER_ORCA_PLUGIN_DIR || APP;
const entry = () => path.join(pluginRoot(), ENTRY_REL);
const installed = () => fs.existsSync(entry());
const installedVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(pluginRoot(), 'package.json'), 'utf8')).version; } catch { return null; } };

// Orca ana sürecinin Syzer'ı çağıracağı komut: exe launcher ise exe, değilse node + bu CLI'ın bin/syzer.js'i
function cliCmd() {
  if (process.env.SYZER_LAUNCHER) return `"${process.execPath}"`;
  return `"${process.execPath}" "${path.join(__dirname, '..', 'bin', 'syzer.js')}"`;
}
// Eklentiyi çalıştıracak node: exe launcher'ın içindeki node bir betik çalıştıramaz, o durumda PATH'teki node
const nodeBin = () => (process.env.SYZER_LAUNCHER ? 'node' : process.execPath);

async function latest() {
  const rel = await (await U.gh(`https://api.github.com/repos/${PLUGIN_REPO}/releases/latest`)).json();
  const asset = (rel.assets || []).find((a) => /^syzer-orca-.*\.tar\.gz$/.test(a.name));
  if (!asset) throw new Error('plugin release has no syzer-orca-*.tar.gz asset');
  return { version: String(rel.tag_name).replace(/^v/, ''), assetUrl: asset.url };
}

async function install(info) {
  const tmp = `${APP}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'pkg.tar.gz'), Buffer.from(await (await U.gh(info.assetUrl, 'application/octet-stream')).arrayBuffer()));
  const r = spawnSync('tar', ['-xzf', 'pkg.tar.gz'], { cwd: tmp, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar failed: ${(r.stderr || '').trim()}`);
  fs.rmSync(path.join(tmp, 'pkg.tar.gz'));
  if (!fs.existsSync(path.join(tmp, ENTRY_REL))) throw new Error(`corrupt plugin package (${ENTRY_REL} missing)`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.rmSync(APP, { recursive: true, force: true });
  fs.renameSync(tmp, APP);
}

// Eklenti yoksa ya da zorlanırsa en son sürümü indirir. Dönüş: true = hazır
async function ensure({ force = false } = {}) {
  if (process.env.SYZER_ORCA_PLUGIN_DIR) return installed();
  const have = installedVersion();
  if (have && !force) return true;
  try {
    const info = await latest();
    if (!have || force && U.cmpVer(info.version, have) > 0) {
      console.error(have ? `Orca plugin: v${have} → v${info.version}…` : `Orca plugin: downloading v${info.version} from ${PLUGIN_REPO}…`);
      await install(info);
    } else if (force) console.error(`Orca plugin is up to date (v${have}).`);
    return true;
  } catch (e) {
    console.error(`Cannot download the Orca plugin: ${e.message}\nSee https://github.com/${PLUGIN_REPO}`);
    return Boolean(have);
  }
}

function exec(args, opts = {}) {
  return spawnSync(nodeBin(), [entry(), ...args], { stdio: 'inherit', env: { ...process.env, SYZER_CLI_CMD: cliCmd() }, ...opts });
}

// `syzer orca <alt komut> ...`: args = "orca"dan sonrakiler
async function run(args) {
  const sub = args[0];
  if (sub === 'update') { if (!(await ensure({ force: true }))) { process.exitCode = 1; return; } console.log(`Orca plugin v${installedVersion()}`); return; }
  // kurulumda her zaman en son sürümü al; diğer komutlar kuruluyu kullanır
  if (!(await ensure({ force: sub === 'install' })) || !installed()) { process.exitCode = 1; return; }
  const r = exec(args);
  if (r.error) { console.error(r.error.code === 'ENOENT' ? 'Node.js is required to run the Orca plugin (https://nodejs.org).' : r.error.message); process.exitCode = 1; return; }
  process.exitCode = r.status == null ? 1 : r.status;
}

// syzer doctor için: eklenti durumu (JSON) ya da null (kurulu değil)
function status() {
  if (!installed()) return null;
  const r = spawnSync(nodeBin(), [entry(), 'status'], { encoding: 'utf8', env: { ...process.env, SYZER_CLI_CMD: cliCmd() } });
  try { return JSON.parse(r.stdout); } catch { return { found: true, error: (r.stderr || r.stdout || 'unreadable status').trim().slice(0, 200) }; }
}

module.exports = { run, status, ensure, installed, installedVersion, cliCmd, PLUGIN_REPO };
