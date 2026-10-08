'use strict';

// syzer.exe girişi: GitHub'dan en son sürümü kontrol eder, gerekirse indirir, sonra uygulamayı çalıştırır.
const path = require('path');
const { createRequire } = require('module');
const U = require('../src/updater'); //@UPDATER

const argv = process.argv.slice(2);
const skip = process.env.SYZER_NO_UPDATE || process.env.ORCA_AGENT_LAUNCH_TOKEN || argv.includes('--no-update') || !process.stdout.isTTY || argv[0] === 'mcp' || argv[0] === 'serve';
const log = (m) => process.stderr.write(`${m}\n`);

async function main() {
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
