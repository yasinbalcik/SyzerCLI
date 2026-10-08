'use strict';

// İlk kurulum sihirbazı: dil, kısa eğitim, sağlayıcı, key'ler, izin modu.
const readline = require('readline');
const config = require('./config');
const providers = require('./providers');
const cmds = require('./cmds');
const { t, setLang, LANGS } = require('./i18n');
const { C } = require('./ui');

const log = (s = '') => console.log(s);

function ask(rl, q) { return new Promise((res) => rl.question(q, (a) => res(a.trim()))); }

async function pick(rl, title, options, def) {
  log(`\n${C.bold(title)}`);
  options.forEach((o, i) => log(`  ${C.orange(String(i + 1))}) ${o.label}${i === def ? C.gray('  ←') : ''}`));
  const a = await ask(rl, `${C.gray(t('su_choice'))} [${def + 1}]: `);
  const n = parseInt(a, 10) - 1;
  return options[n >= 0 && n < options.length ? n : def].value;
}

async function run(cfg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // dil metinleri henüz seçilmediği için başlık çok dilli
    log(`\n${C.orange('◆')} ${C.bold('SyzerCLI')}  ${C.gray('— setup / kurulum')}`);
    const codes = Object.keys(LANGS);
    cfg.lang = await pick(rl, 'Language / Dil', codes.map((c) => ({ label: `${c}  ${LANGS[c]}`, value: c })), Math.max(0, codes.indexOf(cfg.lang)));
    setLang(cfg.lang);

    log(`\n${t('su_welcome')}\n`);
    log(t('su_tutorial', config.DIR));

    const provs = providers.list();
    const provId = await pick(rl, t('su_provider'), provs.map((p) => ({ label: `${p.name} ${C.gray(`(${p.keyHint})`)}`, value: p.id })), Math.max(0, provs.findIndex((p) => p.id === cfg.provider)));
    if (provId !== cfg.provider) config.switchProvider(cfg, provId);

    log(`\n${C.bold(t('su_keys'))}`);
    let text = '';
    for (;;) {
      const l = await ask(rl, '> ');
      if (!l) break;
      text += `${l}\n`;
    }
    if (text.trim()) await cmds.keyAdd(cfg, text, { check: true });
    else log(C.gray(t('su_skip_keys')));

    cfg.permissions = await pick(rl, t('su_perm'), [
      { label: t('su_perm_ask'), value: 'ask' }, { label: t('su_perm_auto'), value: 'auto' }, { label: t('su_perm_readonly'), value: 'readonly' },
    ], ['ask', 'auto', 'readonly'].indexOf(cfg.permissions) < 0 ? 0 : ['ask', 'auto', 'readonly'].indexOf(cfg.permissions));

    cfg.setupDone = true;
    config.save(cfg);
    log(`\n${C.green('✔')} ${t('su_done')}\n`);
  } finally { rl.close(); }
}

// Etkileşimli ilk açılışta, kurulum yapılmamışsa ve henüz key yoksa çalıştır
const needed = (cfg) => !cfg.setupDone && process.stdin.isTTY && process.stdout.isTTY &&
  !providers.list().some((p) => config.loadKeys(p.id).keys.length);

module.exports = { run, needed };
