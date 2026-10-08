'use strict';

// `syzer update`: exe launcher üzerinden çalışıyorsa launcher zaten güncellemiştir; değilse sürümü karşılaştırıp yönlendirir.
const pkg = require('../package.json');
const U = require('./updater');
const SU = require('./selfupdate');
const { t } = require('./i18n');
const { C } = require('./ui');

async function run() {
  console.log(C.gray(t('up_checking')));
  if (SU.eligible()) { await SU.run({ force: true }); return; } // npm kurulumu: kendini günceller
  try {
    const info = await U.latest({ force: true });
    if (U.cmpVer(info.version, pkg.version) > 0) {
      console.log(C.yellow(t('up_available', pkg.version, info.version)));
      console.log(C.gray(process.env.SYZER_LAUNCHER ? 'syzer update' : 'syzer.exe (launcher) or: git pull'));
    } else console.log(C.green(`✔ ${t('up_current', pkg.version)}`));
  } catch (e) { console.log(C.red(`✖ ${t('up_failed', e.message)}`)); process.exitCode = 1; }
}

module.exports = { run };
