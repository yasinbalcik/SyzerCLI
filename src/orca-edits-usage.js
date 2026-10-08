'use strict';
// Independent `syzer` usage provider patches for Orca 1.4.222 (hashes in filenames => globs).
const SB = /^renderer\/assets\/StatusBar-.*\.js$/, ST = /^renderer\/assets\/store-.*\.js$/, SM = /^renderer\/assets\/useSettingsNavigationMetadata-.*\.js$/, CT = /^main\/chunks\/constants-.*\.js$/, MAIN = /^main\/index\.js$/;
const SZ_ICON = (n) => `(0,J.jsx)(\`img\`,{src:\`__SYZER_ICON__\`,width:${n},height:${n},alt:\`Syzer\`,style:{borderRadius:4}})`;
const FETCH = 'fetchSyzerUsage(sig){return(async()=>{const cp=process.getBuiltinModule?process.getBuiltinModule(`child_process`):require(`child_process`);' +
  'const base={provider:`syzer`,weekly:null,updatedAt:Date.now()};' +
  'return await new Promise(r=>{if(sig&&sig.aborted)return r({...base,session:null,error:`aborted`,status:`error`});' +
  'const ch=cp.exec((process.env.SYZER_BIN||__SYZER_CMD__)+` usage --summary --json`,{timeout:20000,windowsHide:true,maxBuffer:1<<20},(err,out)=>{' +
  'if(err)return r({...base,session:null,error:`syzer: `+String(err.message).split(String.fromCharCode(10))[0],status:`error`});' +
  'try{const j=JSON.parse(out);const ps=(j.providers||[]).filter(p=>p.percent_used!=null);' +
  'if(!ps.length)return r({...base,session:null,error:`No quota info (${j.keys_ready}/${j.keys_total} keys ready)`,status:`unavailable`});' +
  'const reset=ps.map(p=>p.resets_at?Date.parse(p.resets_at):null).filter(Boolean).sort()[0]||Date.now()+864e5;' +
  'const mk=(name,u,badge,detail,ra)=>({name,usedPercent:u,windowMinutes:1440,resetsAt:ra,resetDescription:badge,badge,detail});' +
  'const left=p=>p.limit!=null?`${Math.max(0,p.limit-(p.used||0))} left`:`quota n/a`;' +
  'const lim=ps.filter(p=>p.limit!=null);const tl=lim.length?`${lim.reduce((a,p)=>a+Math.max(0,p.limit-(p.used||0)),0)} left`:`quota n/a`;' +
  'const total=mk(`Total`,Math.round(ps.reduce((a,p)=>a+p.percent_used,0)/ps.length),`${j.keys_ready}/${j.keys_total} keys`,tl,reset);' +
  'const buckets=[...ps.map(p=>mk(p.name,p.percent_used,`${p.keys_ready}/${p.keys_total} keys`,left(p),p.resets_at?Date.parse(p.resets_at):reset)),total];' +
  'r({...base,session:total,buckets,error:null,status:`ok`})}catch(e){r({...base,session:null,error:`syzer: bad JSON`,status:`error`})}});' +
  'sig&&sig.addEventListener&&sig.addEventListener(`abort`,()=>{try{ch.kill()}catch{}},{once:true})})})()}';
const K = 'fetchKimiWithResolvedHome(){let e=this.kimiHomeResolver?.();';
const P = (group, glob, from, to) => ({ group, glob, from, to });
const edits = [
  // ===== group main =====
  P('main', MAIN, K, FETCH + K),
  P('main', MAIN, 'cursor:null,zcode:null};grokAuthConfigured=', 'cursor:null,zcode:null,syzer:null};grokAuthConfigured='),
  P('main', MAIN, 'cursor:0,zcode:0};activeFailureStreakByProvider=', 'cursor:0,zcode:0,syzer:0};activeFailureStreakByProvider='),
  P('main', MAIN, 'cursor:0,zcode:0};mainWindow=null;', 'cursor:0,zcode:0,syzer:0};mainWindow=null;'),
  P('main', MAIN, 'this.withFetchingStatus(s.zcode,`zcode`)});let ce=_na()', 'this.withFetchingStatus(s.zcode,`zcode`),syzer:this.withFetchingStatus(s.syzer,`syzer`)});let ce=_na()'),
  P('main', MAIN, 'fe=Pka({signal:e,authReadResult:D}).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e})),pe=!t?.force', 'fe=Pka({signal:e,authReadResult:D}).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e})),__szp=this.fetchSyzerUsage(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e})),pe=!t?.force'),
  P('main', MAIN, 'antigravityResultPromise:ue})}};function y4', 'antigravityResultPromise:ue,syzerResultPromise:__szp})}};function y4'),
  P('main', MAIN, 'antigravityResultPromise:O}=n;', 'antigravityResultPromise:O,syzerResultPromise:__szq}=n;'),
  P('main', MAIN, 'let[ue,de,fe,pe]=await Promise.all([T,E,D,O]);', 'let[ue,de,fe,pe,__szr]=await Promise.all([T,E,D,O,__szq]);'),
  P('main', MAIN, '_e=y4(`antigravity`,pe),ve=', '_e=y4(`antigravity`,pe),__szy=y4(`syzer`,__szr),ve='),
  P('main', MAIN, 'this.trackActiveFailureStreak(`antigravity`,_e),this.updateState(', 'this.trackActiveFailureStreak(`antigravity`,_e),this.trackActiveFailureStreak(`syzer`,__szy),this.updateState('),
  P('main', MAIN, 'antigravity:this.applyStalePolicy(_e,s.antigravity)})}},uNa=class', 'antigravity:this.applyStalePolicy(_e,s.antigravity),syzer:this.applyStalePolicy(__szy,s.syzer)})}},uNa=class'),
  P('main', MAIN, 'zcode:this.state.zcode};return Object.entries(e)', 'zcode:this.state.zcode,syzer:this.state.syzer};return Object.entries(e)'),
  P('main', MAIN, '`cursor`,`zcode`,`ssh`,`resource-usage`,`ports`]),Hhr=', '`cursor`,`zcode`,`syzer`,`ssh`,`resource-usage`,`ports`]),Hhr='),
  P('main', MAIN, '_zcodeStatusBarDefaultAdded:p.l().optional(),', '_zcodeStatusBarDefaultAdded:p.l().optional(),_syzerStatusBarDefaultAdded:p.l().optional(),'),
  P('main', CT, '`cursor`,`zcode`,`ssh`,`resource-usage`,`ports`];var h=', '`cursor`,`zcode`,`syzer`,`ssh`,`resource-usage`,`ports`];var h='),
  // ===== group store =====
  P('store', ST, '`cursor`,`zcode`,`ssh`,`resource-usage`,`ports`],On={', '`cursor`,`zcode`,`syzer`,`ssh`,`resource-usage`,`ports`],On={'),
  P('store', ST, '[`_zcodeStatusBarDefaultAdded`,dve]];for(let[r,i]of n)', '[`_zcodeStatusBarDefaultAdded`,dve],[`_syzerStatusBarDefaultAdded`,`syzer`]];for(let[r,i]of n)'),
  P('store', ST, 'cursor:null,zcode:null,minimaxCookieConfigured:!1', 'cursor:null,zcode:null,syzer:null,minimaxCookieConfigured:!1'),
  // ===== group statusbar =====
  P('statusbar', SB, 'e===`cursor`?`Cursor`:e}function dt(e)', 'e===`cursor`?`Cursor`:e===`syzer`?`Syzer`:e}function dt(e)'),
  P('statusbar', SB, 'e===`kimi`?(0,J.jsx)(G,{agent:`kimi`,size:13})', 'e===`syzer`?' + SZ_ICON(13) + ':e===`kimi`?(0,J.jsx)(G,{agent:`kimi`,size:13})'),
  P('statusbar', SB, 'case`kimi`:return`K`;', 'case`kimi`:return`K`;case`syzer`:return`S`;'),
  P('statusbar', SB, 'case`antigravity`:case`kimi`:return null;', 'case`antigravity`:case`kimi`:return null;case`syzer`:return null;'),
  P('statusbar', SB, 'cursor:H,zcode:U}=r,de=_.includes(', 'cursor:H,zcode:U,syzer:__SZ}=r,de=_.includes('),
  P('statusbar', SB, 'be=$(`zcode`,U,W),xe=fe', 'be=$(`zcode`,U,W),__szd=$(`syzer`,__SZ,W),xe=fe'),
  P('statusbar', SB, '(r.zcodePlanApiKeyConfigured||K(`zcode`,S)),je=', '(r.zcodePlanApiKeyConfigured||K(`zcode`,S)),__szv=__szd!==null&&_.includes(`syzer`),je='),
  P('statusbar', SB, 'Ee||De||Oe||ke,Re=Le||Pe', 'Ee||De||Oe||ke||__szv,Re=Le||Pe'),
  P('statusbar', SB, 'cursor:H,zcode:U},W),Be=ze', 'cursor:H,zcode:U,syzer:__SZ},W),Be=ze'),
  P('statusbar', SB, 'e.zcode!==void 0&&Z(e.zcode)?!1:', 'e.zcode!==void 0&&Z(e.zcode)||e.syzer!=null&&Z(e.syzer)?!1:'),
  P('statusbar', SB, '&&!Q(e.zcode)}function _r(', '&&!Q(e.zcode)&&!Q(e.syzer)}function _r('),
  P('statusbar', SB, 'U?.status===`fetching`,He=', 'U?.status===`fetching`||__SZ?.status===`fetching`,He='),
  P('statusbar', SB, 'ke?be:null].filter(', 'ke?be:null,__szv?__szd:null].filter('),
  P('statusbar', SB, 'f(`auto.components.status.bar.StatusBar.5e59007df4`,`Kimi Usage`)]}),', 'f(`auto.components.status.bar.StatusBar.5e59007df4`,`Kimi Usage`)]}),(0,J.jsxs)(L,{checked:o.includes(`syzer`),onCheckedChange:()=>{i(`usage-tracking`),s(`syzer`)},children:[' + SZ_ICON(14) + ',`Syzer Usage`]}),'),
  // ===== group settings (optional) =====
  P('settings', SM, 'toggleDescription:g(`settings.appearance.statusBar.kimiToggleDescription`,`Show Kimi subscription usage for the active workspace.`)},', 'toggleDescription:g(`settings.appearance.statusBar.kimiToggleDescription`,`Show Kimi subscription usage for the active workspace.`)},{id:`syzer`,title:`Syzer Usage`,description:`Show Syzer key-pool usage in the status bar.`,keywords:[`status bar`,`syzer`,`usage`,`quota`],toggleDescription:`Show Syzer key-pool usage for the active workspace.`},'),
];
module.exports = { edits };
