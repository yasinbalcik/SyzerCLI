'use strict';

// Orca yama listesi. Her düzenleme { file | glob, from, to, group }:
//   from  → paketteki TAM metin (dosya içinde tam bir kez eşleşmeli)
//   group → bir grup bütünüyle uygulanır ya da bütünüyle atlanır (yarım yama bırakılmaz)
// Gruplar: core (yama işareti) · usage (Usage paneli/durum çubuğu) · agent (Syzer'ın kendi ajan kimliği + durum olayları)
//          · history (oturum geçmişi tarayıcısı: Syzer oturumları + alt ajan listesi)
const SB = /^out\/renderer\/assets\/StatusBar-.*\.js$/;
const g = (name) => (re) => ({ re, name });

function mainFetch(cmd) {
  return 'return(async()=>{const cp=process.getBuiltinModule?process.getBuiltinModule(`child_process`):require(`child_process`);' +
    'const base={provider:`kimi`,weekly:null,updatedAt:Date.now()};' +
    `return await new Promise(r=>cp.execFile(process.env.SYZER_BIN||${JSON.stringify(cmd)},[\`usage\`,\`--summary\`,\`--json\`],{timeout:20000,shell:true,windowsHide:true,maxBuffer:1<<20},(err,out)=>{` +
    'if(err)return r({...base,session:null,error:`syzer: `+String(err.message).split(String.fromCharCode(10))[0],status:`error`});' +
    'try{const j=JSON.parse(out);const ps=(j.providers||[]).filter(p=>p.percent_used!=null);' +
    'if(!ps.length)return r({...base,session:null,error:`No quota info (${j.keys_ready}/${j.keys_total} keys ready)`,status:`unavailable`});' +
    'const reset=ps.map(p=>p.resets_at?Date.parse(p.resets_at):null).filter(Boolean).sort()[0]||Date.now()+864e5;' +
    'const mk=(name,u,badge,detail,ra)=>({name,usedPercent:u,windowMinutes:1440,resetsAt:ra,resetDescription:badge,badge,detail});' +
    'const left=p=>p.limit!=null?`${Math.max(0,p.limit-(p.used||0))} left`:`quota n/a`;' +
    'const lim=ps.filter(p=>p.limit!=null);const tl=lim.length?`${lim.reduce((a,p)=>a+Math.max(0,p.limit-(p.used||0)),0)} left`:`quota n/a`;' +
    'const total=mk(`Total`,Math.round(ps.reduce((a,p)=>a+p.percent_used,0)/ps.length),`${j.keys_ready}/${j.keys_total} keys`,tl,reset);' +
    'const buckets=[...ps.map(p=>mk(p.name,p.percent_used,`${p.keys_ready}/${p.keys_total} keys`,left(p),p.resets_at?Date.parse(p.resets_at):reset)),total];' +
    'r({...base,session:total,buckets,error:null,status:`ok`})}' +
    'catch(e){r({...base,session:null,error:`syzer: bad JSON`,status:`error`})}}))})();';
}

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

const SYZER_DIR = 'require(`node:path`).join(require(`node:os`).homedir(),`.syzercli`,`sessions`)';

function edits(cmd, ICON, marker) {
  const icon = (size) => `(0,J.jsx)(\`img\`,{src:\`${ICON}\`,width:${size},height:${size},alt:\`Syzer\`,style:{borderRadius:4}})`;
  const CFG = 'jcode:{detectCmd:`jcode`,launchCmd:`jcode`,expectedProcess:`jcode`,promptInjectionMode:`stdin-after-start`}};';
  const CFG_TO = 'jcode:{detectCmd:`jcode`,launchCmd:`jcode`,expectedProcess:`jcode`,promptInjectionMode:`stdin-after-start`},syzer:{detectCmd:`syzer`,launchCmd:`syzer`,expectedProcess:`syzer`,promptInjectionMode:`stdin-after-start`}};';
  const RESUME = 'case`omp`:case`prime-agent`:return`${t} --resume ${n}`';
  return [
    // ---- core: yama sürüm işareti ----
    { group: 'core', file: 'out/main/index.js', from: 'const guardKey = "__ORCA_BOOTSTRAP_FATAL_EXIT_GUARD__"', to: `${marker}const guardKey = "__ORCA_BOOTSTRAP_FATAL_EXIT_GUARD__"` },

    // ---- usage: Kimi yuvası → Syzer (Usage paneli + durum çubuğu) ----
    { group: 'usage', file: 'out/main/index.js', from: 'fetchKimiWithResolvedHome(){', to: `fetchKimiWithResolvedHome(){${mainFetch(cmd)}` },
    { group: 'usage', glob: SB, from: '(0,J.jsx)(`div`,{className:`font-medium ${n}`,children:t}),(0,J.jsx)(`div`,{className:`h-[6px]', to: '(0,J.jsxs)(`div`,{className:`flex justify-between font-medium ${n}`,children:[t,e.badge?(0,J.jsx)(`span`,{className:`font-normal opacity-70`,children:e.badge}):null]}),(0,J.jsx)(`div`,{className:`h-[6px]' },
    { group: 'usage', glob: SB, from: 'd&&(0,J.jsx)(`span`,{children:d})]})]})}function At(', to: 'e.detail&&(0,J.jsx)(`span`,{children:e.detail}),d&&(0,J.jsx)(`span`,{children:d})]})]})}function At(' },
    { group: 'usage', glob: SB, from: 'e===`kimi`?(0,J.jsx)(G,{agent:`kimi`,size:13})', to: `e===\`kimi\`?${icon(13)}` },
    { group: 'usage', glob: SB, from: '(0,J.jsx)(G,{agent:`kimi`,size:14})', to: icon(14) },
    { group: 'usage', glob: SB, from: 'e===`kimi`?`Kimi`:', to: 'e===`kimi`?`Syzer`:' },
    { group: 'usage', glob: SB, from: '`Kimi Usage`', to: '`Syzer Usage`' },
    { group: 'usage', glob: SB, from: 'case`kimi`:return`K`', to: 'case`kimi`:return`S`' },
    { group: 'usage', glob: /^out\/renderer\/assets\/status-bar-agent-gating-.*\.js$/, from: '`gemini`,`kimi`,`antigravity`,`grok`,`zcode`]);function D', to: '`gemini`,`antigravity`,`grok`,`zcode`]);function D' },
    { group: 'usage', glob: SB, from: 'e===`zcode`?t.zcodePlanApiKeyConfigured===!0:!1:!1}', to: 'e===`zcode`?t.zcodePlanApiKeyConfigured===!0:e===`kimi`||!1:!1}' },

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
    // durum olayları: Syzer, hermes kaynağı üzerinden `orca_agent_type: syzer` işaretiyle gelir → ajan türü syzer
    { group: 'agent', file: 'out/main/index.js', from: 'agentType:`hermes`,toolName:o.toolName', to: 'agentType:i&&i.orca_agent_type===`syzer`?`syzer`:`hermes`,toolName:o.toolName' },
    { group: 'agent', file: 'out/main/index.js', from: 'case`hermes`:f=bse(t,r,i,a,o);break;', to: 'case`hermes`:if(o&&o.orca_agent_type===`syzer`&&(r===`SubagentStart`||r===`SubagentStop`)){let e=foe(t,r,i,a,o);f=e?{...e,agentType:`syzer`}:null;break}f=bse(t,r,i,a,o);break;' },

    // ---- history: oturum geçmişi (Syzer oturumları + alt ajanlar, kendi biçimimiz) ----
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: '`kimi`,`muse`,`jcode`],p=64', to: '`kimi`,`muse`,`jcode`,`syzer`],p=64' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: 'muse:`Muse`,jcode:`Jcode`', to: 'muse:`Muse`,jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: '`kimi`,`muse`,`jcode`]', to: '`kimi`,`muse`,`jcode`,`syzer`]' },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: 'jcode:`Jcode`', to: 'jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: RESUME, to: `case\`syzer\`:${RESUME}` },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-session-resume-preparation-.*\.js$/, from: RESUME, to: `case\`syzer\`:${RESUME}` },
    { group: 'history', glob: /^out\/main\/chunks\/codex-rollout-session-meta-.*\.js$/, from: '"prime-agent":{rootDirs:(e,t)=>x(e.primeAgentSessionsDir??re,t,[`.prime`,`agent`,`sessions`]),extensions:[`.jsonl`]},', to: `"prime-agent":{rootDirs:(e,t)=>x(e.primeAgentSessionsDir??re,t,[\`.prime\`,\`agent\`,\`sessions\`]),extensions:[\`.jsonl\`]},syzer:{rootDirs:()=>[${SYZER_DIR}],extensions:[\`.json\`],directoryPredicate:()=>!1},` },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-service-protocol-.*\.js$/, from: 'case`jcode`:return ec(e.file,t,n)}}', to: 'case`jcode`:return ec(e.file,t,n);case`syzer`:return __syzerParse(e.file,t,n)}}' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-service-protocol-.*\.js$/, from: 'async function fc(', to: `${PARSER}async function fc(` },
    { group: 'history', file: 'out/main/session-scanner-service-entry.js', from: 'return e.agent===`claude`?li({parentFilePath:e.parentFilePath}):vi({parentFilePath:e.parentFilePath})', to: 'return e.agent===`syzer`?__syzerSubs(e.parentFilePath):e.agent===`claude`?li({parentFilePath:e.parentFilePath}):vi({parentFilePath:e.parentFilePath})' },
    { group: 'history', file: 'out/main/session-scanner-service-entry.js', from: 'function bi(', to: `${SUBS}function bi(` },
    { group: 'history', file: 'out/main/index.js', from: 'fRi(e){if(!e||e.agent!==`claude`&&e.agent!==`omp`||', to: 'fRi(e){if(!e||e.agent!==`claude`&&e.agent!==`omp`&&e.agent!==`syzer`||' },
    { group: 'history', file: 'out/main/index.js', from: '(e.agent===`claude`?Xe.y({wslHomeDirs:n}):Xe.x({wslHomeDirs:n}))', to: `(e.agent===\`syzer\`?[${SYZER_DIR}]:e.agent===\`claude\`?Xe.y({wslHomeDirs:n}):Xe.x({wslHomeDirs:n}))` },
  ];
}

module.exports = { edits, g };
