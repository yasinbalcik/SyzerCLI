'use strict';
// Orca kapanırken (will-quit) daemon'daki tüm terminal oturumlarını kapatır. Orca'nın kendi "Manage Sessions -> kill all" mantığını yeniden kullanır.
// Ayar: ~/.syzercli/orca/settings.json -> { "killShellsOnQuit": false } ile kapatılır (varsayılan: açık).
// Enjekte metinde tek tırnak ve ${} yok; dize sınırlayıcı olarak ters tırnak kullanılır (Orca paketi biçemi).
const LINES = [
  'var __syzerQK=!1;',
  'function __syzerQuitCfg(){try{const c=JSON.parse(require(`node:fs`).readFileSync(require(`node:path`).join(require(`node:os`).homedir(),`.syzercli`,`orca`,`settings.json`),`utf8`));return c.killShellsOnQuit!==!1}catch{return!0}}',
  'async function __syzerKillAll(){try{let e=ZYr(),t=await eH(e);await Promise.allSettled(t.map(async t=>{let n=e.find(e=>e.protocolVersion===t.protocolVersion);n&&await n.shutdown(t.sessionId,{immediate:!0}).catch(()=>{})}))}catch{}try{u$t()}catch{}}',
  'function __syzerInstallQuitKill(){if(__syzerQK)return;__syzerQK=!0;let done=!1;I.app.prependListener(`will-quit`,e=>{if(done||!__syzerQuitCfg())return;done=!0;e.preventDefault();let f=()=>I.app.quit();Promise.race([__syzerKillAll(),new Promise(r=>setTimeout(r,4e3))]).then(f,f)})}',
];
const DEFS = LINES.join('');
module.exports = { DEFS, LINES };
