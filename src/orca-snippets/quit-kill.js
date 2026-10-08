'use strict';
// Orca kapanırken daemon'daki tüm terminal oturumlarını kapatır. Orca'nın "daemon" kapanış adımına (normalde yalnızca bağlantıyı keser) takılır:
// önce "Manage Sessions -> kill all" mantığıyla oturumlar kapatılır, sonra Orca'nın kendi adımı çalışır.
// Ayar: ~/.syzercli/orca/settings.json -> { "killShellsOnQuit": false } ile kapatılır (varsayılan: açık). Günlük: ~/.syzercli/orca/quit.log
// Enjekte metinde tek tırnak ve ${} yok; dize sınırlayıcı olarak ters tırnak kullanılır (Orca paketi biçemi).
const LINES = [
  'function __syzerDir(){return require(`node:path`).join(require(`node:os`).homedir(),`.syzercli`,`orca`)}',
  'function __syzerLog(m){try{require(`node:fs`).appendFileSync(require(`node:path`).join(__syzerDir(),`quit.log`),new Date().toISOString()+` `+m+String.fromCharCode(10))}catch{}}',
  'function __syzerQuitCfg(){try{return JSON.parse(require(`node:fs`).readFileSync(require(`node:path`).join(__syzerDir(),`settings.json`),`utf8`)).killShellsOnQuit!==!1}catch{return!0}}',
  'async function __syzerKillAll(){try{let e=ZYr();__syzerLog(`adapters=`+e.length);let t=await eH(e);__syzerLog(`sessions=`+t.length+` fields=`+(t[0]?Object.keys(t[0]).join(`,`):``));await Promise.allSettled(t.map(async t=>{let n=e.find(e=>e.protocolVersion===t.protocolVersion);if(!n){__syzerLog(`no adapter for `+t.sessionId);return}try{await n.shutdown(t.sessionId,{immediate:!0})}catch(x){__syzerLog(`shutdown error `+(x&&x.message))}}));let r=await eH(e);__syzerLog(`remaining=`+r.length)}catch(x){__syzerLog(`killAll error `+(x&&x.message))}try{u$t()}catch{}}',
  'async function __syzerQuitDaemon(f){if(__syzerQuitCfg()){__syzerLog(`quit: killing sessions`);await Promise.race([__syzerKillAll(),new Promise(r=>setTimeout(r,4e3))])}else __syzerLog(`quit: killShellsOnQuit is off`);return f()}',
];
const DEFS = LINES.join('');
module.exports = { DEFS, LINES };
