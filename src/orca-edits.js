'use strict';

// Orca yama listesi. Her düzenleme { file | glob, from, to, group }:
//   from  → paketteki TAM metin (dosya içinde tam bir kez eşleşmeli)
//   group → bir grup bütünüyle uygulanır ya da bütünüyle atlanır (yarım yama bırakılmaz)
// Gruplar: core (yama işareti) · usage (Usage paneli/durum çubuğu) · agent (Syzer'ın kendi ajan kimliği + durum olayları)
//          · history (oturum geçmişi tarayıcısı: Syzer oturumları + alt ajan listesi)
const SB = /^out\/renderer\/assets\/StatusBar-.*\.js$/;

// usage sağlayıcı yamaları (ayrı dosya; glob'lar out/ önekiyle, yer tutucular doldurulur)
function usageEdits(cmd, ICON) {
  return require('./orca-edits-usage').edits.map((e) => ({
    group: e.group === 'settings' ? 'usage-settings' : 'usage',
    glob: new RegExp(e.glob.source.replace(/^\^/, '^out\/'), e.glob.flags),
    from: e.from,
    to: e.to.split('__SYZER_CMD__').join(JSON.stringify(cmd)).split('__SYZER_ICON__').join(ICON),
  }));
}
const g = (name) => (re) => ({ re, name });

// Tarayıcı hizmetine eklenen Syzer oturum ayrıştırıcısı (minified yardımcı adları bu Orca sürümüne göre: _ ve m)
const PARSER = 'async function __syzerParse(file,platform,messages){' +
  'let o;try{o=_.Q(JSON.parse(await m.u(file.path,`utf-8`,`scan`)))}catch(e){if(e instanceof m.h)throw e;return null}' +
  'if(!o)return null;' +
  'const a=_.h({agent:`syzer`,file,sessionId:_.F(o.id)??_.y(file.path),messages});' +
  'a.cwd=_.F(o.cwd);a.model=_.F(o.model);_.C(a,o.ts);' +
  'const t=_.F(o.title);if(t)a.title=_.ot(t);' +
  'for(const x of _.A(o.messages)){const r=_.Q(x),role=_.F(r?.role);' +
  'if(role!==`user`&&role!==`assistant`)continue;' +
  'a.messageCount++;role===`user`&&(a.title??=_.nt(r.content));_.f(a,role,r.content)}' +
  'try{const fs=require(`node:fs`),p=require(`node:path`);' +
  'a.subagentTranscriptCount=fs.readdirSync(p.join(p.dirname(file.path),p.basename(file.path,p.extname(file.path)),`subagents`)).filter(n=>n.startsWith(`agent-`)&&n.endsWith(`.json`)).length}catch{}' +
  'return _.g(a,platform)}\n';

const SUBS = 'async function __syzerSubs(parent){' +
  'const fs=require(`node:fs`),pa=require(`node:path`),base=pa.basename(parent,pa.extname(parent)),' +
  'dir=pa.join(pa.dirname(parent),base,`subagents`),out=[],issues=[];' +
  'let names;try{names=fs.readdirSync(dir).filter(n=>n.startsWith(`agent-`)&&n.endsWith(`.json`))}catch{return{sessions:[],issues}}' +
  'const ST={running:`running`,completed:`completed`,failed:`failed`,stopped:`stopped`,killed:`stopped`};' +
  'for(const n of names){try{' +
  'const fp=pa.join(dir,n),st=fs.statSync(fp),j=JSON.parse(fs.readFileSync(fp,`utf8`)),iso=st.mtime.toISOString(),' +
  'k=(Array.isArray(j.messages)?j.messages:[]).filter(x=>x&&(x.role===`user`||x.role===`assistant`)).length,' +
  'sid=String(j.id||pa.basename(n,`.json`));' +
  'out.push({id:`local:syzer:${base}:${sid}:${fp}`,executionHostId:`local`,agent:`syzer`,sessionId:sid,' +
  'title:String(j.description||sid).slice(0,200),cwd:null,branch:null,model:null,filePath:fp,codexHome:null,' +
  'createdAt:iso,updatedAt:iso,modifiedAt:iso,messageCount:k,totalTokens:0,previewMessages:[],' +
  'queuedMessageCount:0,subagentTranscriptCount:0,resumeCommand:``,' +
  'subagent:{parentSessionId:base,agentType:j.agentType||null,status:ST[j.status]??null}})}catch{}}' +
  'out.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));return{sessions:out,issues}}\n';


// Syzer olay ayrıştırıcısı: kendi durum tablosu ve alan çıkarımı; Orca'dan yalnızca genel şema normalleştiricisini (un) kullanır
const SYZER_EVENT = require('./orca-snippets/syzer-event').SYZER_EVENT;

const SYZER_DIR = 'require(`node:path`).join(require(`node:os`).homedir(),`.syzercli`,`sessions`)';

const fsx = require('fs');
const pathx = require('path');
const snippet = (n) => fsx.readFileSync(pathx.join(__dirname, 'orca-snippets', n), 'utf8').trim();

const analyticsEdits = (cmd) => require('./orca-analytics-edits').analyticsEdits(cmd);

// Orca yeniden açılınca Syzer sekmesinin geri gelmesi: oturum kimliği kaydı + `syzer --resume <id>` (ayrı dosya)
function restoreEdits() {
  const { patches } = require('./orca-edits-restore');
  return patches.map((p) => ({ group: 'restore', glob: new RegExp(p.glob.source.replace(/^\^/, '^out\\/'), p.glob.flags), from: p.from, to: p.to }));
}

function edits(cmd, ICON, marker) {
  const icon = (size) => `(0,J.jsx)(\`img\`,{src:\`${ICON}\`,width:${size},height:${size},alt:\`Syzer\`,style:{borderRadius:4}})`;
  const CFG = 'jcode:{detectCmd:`jcode`,launchCmd:`jcode`,expectedProcess:`jcode`,promptInjectionMode:`stdin-after-start`}};';
  const CFG_TO = 'jcode:{detectCmd:`jcode`,launchCmd:`jcode`,expectedProcess:`jcode`,promptInjectionMode:`stdin-after-start`},syzer:{detectCmd:`syzer`,launchCmd:`syzer`,expectedProcess:`syzer`,promptInjectionMode:`stdin-after-start`}};';
  const RESUME = 'case`omp`:case`prime-agent`:return`${t} --resume ${n}`';
  return [
    // ---- core: yama sürüm işareti ----
    { group: 'core', file: 'out/main/index.js', from: 'const guardKey = "__ORCA_BOOTSTRAP_FATAL_EXIT_GUARD__"', to: `${marker}const guardKey = "__ORCA_BOOTSTRAP_FATAL_EXIT_GUARD__"` },

    // ---- usage: Syzer'ın KENDİ kullanım sağlayıcısı (provider id: syzer; Kimi'ye bağlı değil) ----
    { group: 'usage', glob: SB, from: '(0,J.jsx)(`div`,{className:`font-medium ${n}`,children:t}),(0,J.jsx)(`div`,{className:`h-[6px]', to: '(0,J.jsxs)(`div`,{className:`flex justify-between font-medium ${n}`,children:[t,e.badge?(0,J.jsx)(`span`,{className:`font-normal opacity-70`,children:e.badge}):null]}),(0,J.jsx)(`div`,{className:`h-[6px]' },
    { group: 'usage', glob: SB, from: 'd&&(0,J.jsx)(`span`,{children:d})]})]})}function At(', to: 'e.detail&&(0,J.jsx)(`span`,{children:e.detail}),d&&(0,J.jsx)(`span`,{children:d})]})]})}function At(' },
    ...usageEdits(cmd, ICON),

    // ---- agent: Syzer kendi ajan kimliği (`syzer`) ----
    { group: 'agent', glob: /^out\/main\/chunks\/tui-agent-config-.*\.js$/, from: CFG, to: CFG_TO },
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: CFG, to: CFG_TO },
    { group: 'agent', glob: /^out\/main\/chunks\/tui-agent-display-names-.*\.js$/, from: 'jcode:`Jcode`}', to: 'jcode:`Jcode`,syzer:`Syzer`}' },
    { group: 'agent', glob: /^out\/renderer\/assets\/stale-document-visibility-.*\.js$/, from: 'jcode:`Jcode`', to: 'jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'agent', glob: /^out\/renderer\/assets\/markdown-preview-document\.worker-.*\.js$/, from: 'jcode:`Jcode`}', to: 'jcode:`Jcode`,syzer:`Syzer`}' },
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: 'dsb:`DeepSeek Build`,jcode:`Jcode`};function FM', to: 'dsb:`DeepSeek Build`,jcode:`Jcode`,syzer:`Syzer`};function FM' },
    { group: 'agent', file: 'out/main/index.js', from: 'dsb:`DeepSeek Build`,jcode:`Jcode`};function hBa', to: 'dsb:`DeepSeek Build`,jcode:`Jcode`,syzer:`Syzer`};function hBa' },
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: 'jcode:!0};function LM(e)', to: 'jcode:!0,syzer:!0};function LM(e)' },
    { group: 'agent', glob: /^out\/renderer\/assets\/agent-catalog-.*\.js$/, from: 'homepageUrl:`https://github.com/1jehuang/jcode`}]}', to: 'homepageUrl:`https://github.com/1jehuang/jcode`},{id:`syzer`,label:`Syzer`,cmd:`syzer`,iconUrl:`' + ICON + '`,searchAliases:[`syzercli`,`openrouter`,`nvidia`],homepageUrl:`https://github.com/yasinbalcik/SyzerCLI`}]}' },
    // durum olayları: Syzer'ın KENDİ hook yolu (POST /hook/syzer) ve kendi olay ayrıştırıcısı (başka ajana bağlı değil)
    { group: 'agent', file: 'out/main/index.js', from: '"/hook/jcode":`jcode`})', to: '"/hook/jcode":`jcode`,"/hook/syzer":`syzer`})' },
    { group: 'agent', file: 'out/main/index.js', from: '.zcode.dsh.jcode`.split(`.`));function dn(e)', to: '.zcode.dsh.jcode.syzer`.split(`.`));function dn(e)' },
    { group: 'agent', file: 'out/main/index.js', from: 'case`hermes`:return t===`pre_llm_call`||t===`on_session_start`;case`devin`:', to: 'case`hermes`:return t===`pre_llm_call`||t===`on_session_start`;case`syzer`:return t===`Prompt`;case`devin`:' },
    { group: 'agent', file: 'out/main/index.js', from: 'case`hermes`:f=bse(t,r,i,a,o);break;', to: 'case`hermes`:f=bse(t,r,i,a,o);break;case`syzer`:f=__syzerEvent(t,r,i,a,o);break;' },
    { group: 'agent', file: 'out/main/index.js', from: 'function xse(e,t,n,r,i){if(t===`SessionStart`)return an(e,r),null;', to: SYZER_EVENT + 'function xse(e,t,n,r,i){if(t===`SessionStart`)return an(e,r),null;' },
    // ---- history: oturum geçmişi (Syzer oturumları + alt ajanlar, kendi biçimimiz) ----
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: '`kimi`,`muse`,`jcode`],p=64', to: '`kimi`,`muse`,`jcode`,`syzer`],p=64' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: 'muse:`Muse`,jcode:`Jcode`', to: 'muse:`Muse`,jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: '`kimi`,`muse`,`jcode`]', to: '`kimi`,`muse`,`jcode`,`syzer`]' },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: 'jcode:`Jcode`', to: 'jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: RESUME, to: RESUME + ';case`syzer`:return`${t} --resume ${n}`' },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-session-resume-preparation-.*\.js$/, from: RESUME, to: RESUME + ';case`syzer`:return`${t} --resume ${n}`' },
    { group: 'history', glob: /^out\/main\/chunks\/codex-rollout-session-meta-.*\.js$/, from: '"prime-agent":{rootDirs:(e,t)=>x(e.primeAgentSessionsDir??re,t,[`.prime`,`agent`,`sessions`]),extensions:[`.jsonl`]},', to: `"prime-agent":{rootDirs:(e,t)=>x(e.primeAgentSessionsDir??re,t,[\`.prime\`,\`agent\`,\`sessions\`]),extensions:[\`.jsonl\`]},syzer:{rootDirs:()=>[${SYZER_DIR}],extensions:[\`.json\`],directoryPredicate:()=>!1},` },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-service-protocol-.*\.js$/, from: 'case`jcode`:return ec(e.file,t,n)}}', to: 'case`jcode`:return ec(e.file,t,n);case`syzer`:return __syzerParse(e.file,t,n)}}' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-service-protocol-.*\.js$/, from: 'async function fc(', to: `${PARSER}async function fc(` },
    { group: 'history', file: 'out/main/session-scanner-service-entry.js', from: 'return e.agent===`claude`?li({parentFilePath:e.parentFilePath}):vi({parentFilePath:e.parentFilePath})', to: 'return e.agent===`syzer`?__syzerSubs(e.parentFilePath):e.agent===`claude`?li({parentFilePath:e.parentFilePath}):vi({parentFilePath:e.parentFilePath})' },
    { group: 'history', file: 'out/main/session-scanner-service-entry.js', from: 'function bi(', to: `${SUBS}function bi(` },
    { group: 'history', file: 'out/main/index.js', from: 'fRi(e){if(!e||e.agent!==`claude`&&e.agent!==`omp`||', to: 'fRi(e){if(!e||e.agent!==`claude`&&e.agent!==`omp`&&e.agent!==`syzer`||' },
    { group: 'history', file: 'out/main/index.js', from: '(e.agent===`claude`?Xe.y({wslHomeDirs:n}):Xe.x({wslHomeDirs:n}))', to: `(e.agent===\`syzer\`?[${SYZER_DIR}]:e.agent===\`claude\`?Xe.y({wslHomeDirs:n}):Xe.x({wslHomeDirs:n}))` },

    // ---- keys: Ayarlar → AI Provider Accounts içinde "Syzer" bölümü (key listesi, seç, sil, ekle) ----
    { group: 'keys', file: 'out/main/index.js', from: 'function lta(e){I.ipcMain.handle(`minimaxCredentials:getStatus`', to: snippet('keys-main.js').split('__SYZER_CMD__').join(JSON.stringify(cmd)) + 'function lta(e){__syzerReg();I.ipcMain.handle(`minimaxCredentials:getStatus`' },
    { group: 'keys', file: 'out/preload/index.js', from: 'const minimaxCredentialsApi = {', to: 'const syzerKeysApi = {list:()=>electron.ipcRenderer.invoke("syzerKeys:list"),add:(t)=>electron.ipcRenderer.invoke("syzerKeys:add",t),remove:(p,i)=>electron.ipcRenderer.invoke("syzerKeys:remove",p,i),use:(p,i)=>electron.ipcRenderer.invoke("syzerKeys:use",p,i)};\nconst minimaxCredentialsApi = {' },
    { group: 'keys', file: 'out/preload/index.js', from: '\tminimaxCredentials: minimaxCredentialsApi,', to: '\tsyzerKeys: syzerKeysApi,\n\tminimaxCredentials: minimaxCredentialsApi,' },
    { group: 'keys', glob: /^out\/renderer\/assets\/useSettingsNavigationMetadata-.*\.js$/, from: ',ct=S(()=>[...Qe(),', to: ',ct=S(()=>[{title:"Syzer API keys",description:"Manage Syzer OpenRouter and NVIDIA API keys.",keywords:["syzer","api key","openrouter","nvidia","key"]},...Qe(),' },
    { group: 'keys', glob: /^out\/renderer\/assets\/Settings-.*\.js$/, from: 'function Xm({provider:e,target:t}){', to: snippet('keys-renderer.js') + 'function Xm({provider:e,target:t}){' },
    { group: 'keys', glob: /^out\/renderer\/assets\/Settings-.*\.js$/, from: 'ze=[!s||/opencode|devin|account/i.test(s)?', to: 'ze=[!s||/syzer|openrouter|nvidia|api key/i.test(s)?(0,Q.jsx)(__SyzerKeys,{},`syzer`):null,!s||/opencode|devin|account/i.test(s)?' },

    // ---- analytics: Ayarlar → Stats & Usage → "Syzer" filtresi (kendi sağlayıcı servisi, kendi kart/ısı haritası) ----
    ...analyticsEdits(cmd),

    // ---- restore: Orca yeniden başlatılınca Syzer oturumunun geri yüklenmesi ----
    ...restoreEdits(),

    // ---- shells: Orca kapanırken açık terminal kabuklarını kapat (sahipsiz pwsh birikmesini önler)
    ...require('./orca-edits-shells').patches,
  ];
}

module.exports = { edits, g };
