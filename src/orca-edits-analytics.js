// Patch table for Orca 1.4.222: each `from` must occur EXACTLY ONCE in its file. Groups are all-or-nothing.
const fs = require('fs'), path = require('path')
const dir = __dirname
const mainInject = fs.readFileSync(path.join(dir, 'orca-snippets', 'analytics-main.js'), 'utf8')
const paneInject = fs.readFileSync(path.join(dir, 'orca-snippets', 'analytics-pane.js'), 'utf8').replace('summaryCardCount:9', 'summaryCardCount:8')

const PRELOAD = 'preload/index.js'
const MAIN = 'main/index.js'
const STORE = 'renderer/assets/store-Dg1gqLCH.js'
const SETTINGS = 'renderer/assets/Settings-C_vhm5cJ.js'

const groups = {
  // A: main process service + IPC registration
  A_main: [
    { file: MAIN,
      from: 'function iq(e,t){',
      to: mainInject + 'function iq(e,t){' },
    { file: MAIN,
      from: 'iq(`museUsage`,e.museUsage)}',
      to: 'iq(`museUsage`,e.museUsage),iq(`syzerUsage`,__getSyzerUsage())}' }
  ],
  // B: preload bridge
  B_preload: [
    { file: PRELOAD,
      from: 'const museUsageApi = createUsageProviderApi(electron.ipcRenderer, "museUsage");',
      to: 'const museUsageApi = createUsageProviderApi(electron.ipcRenderer, "museUsage");\nconst syzerUsageApi = createUsageProviderApi(electron.ipcRenderer, "syzerUsage");' },
    { file: PRELOAD,
      from: '\tmuseUsage: museUsageApi,',
      to: '\tmuseUsage: museUsageApi,\n\tsyzerUsage: syzerUsageApi,' }
  ],
  // C: renderer store slice (zustand)
  C_store: [
    { file: STORE,
      from: 'getApi:()=>window.api.museUsage,hasCachedData:e=>e.hasAnyMuseData});',
      to: 'getApi:()=>window.api.museUsage,hasCachedData:e=>e.hasAnyMuseData}),__syzerSlice=O5({prefix:`syzer`,name:`Syzer`,initialScope:`all`,initialRange:`30d`,getApi:()=>window.api.syzerUsage,hasCachedData:e=>e.hasAnySyzerData});' },
    { file: STORE,
      from: '...GEe(...e),',
      to: '...GEe(...e),...__syzerSlice(...e),' }
  ],
  // D: settings pane + dropdown
  D_settings: [
    { file: SETTINGS,
      from: 'function ZC(e){return e.inputTokens+e.outputTokens+e.cacheReadTokens+e.cacheWriteTokens}',
      to: paneInject + 'function ZC(e){return e.inputTokens+e.outputTokens+e.cacheReadTokens+e.cacheWriteTokens}' },
    { file: SETTINGS,
      from: '`Grok`)}}];function Dw(',
      to: '`Grok`)}},{id:`syzer`,get label(){return`Syzer`}}];function Dw(' },
    { file: SETTINGS,
      from: 'function Dw({tab:e}){return e===`overview`?(0,Q.jsx)(Kn,{className:`size-3.5 text-muted-foreground`}):(0,Q.jsx)(al,{agent:e,size:14})}',
      to: 'function Dw({tab:e}){return e===`overview`?(0,Q.jsx)(Kn,{className:`size-3.5 text-muted-foreground`}):e===`syzer`?(0,Q.jsx)(`span`,{className:`grid size-3.5 place-items-center rounded-sm bg-secondary text-[9px] font-bold text-foreground`,children:`S`}):(0,Q.jsx)(al,{agent:e,size:14})}' },
    { file: SETTINGS,
      from: 'r===`muse`?(0,Q.jsx)(XC,{}):(0,Q.jsx)(zC,{})',
      to: 'r===`muse`?(0,Q.jsx)(XC,{}):r===`syzer`?(0,Q.jsx)(__SyzerUsagePane,{}):(0,Q.jsx)(zC,{})' }
  ],
  // E (OPTIONAL): include Syzer in the Overview (heatmap, token mix, Providers list, "N enabled - M with data")
  E_overview: [
    { file: SETTINGS,
      from: 'function dw(e){let t=[sw(e.claude),cw(e.codex),lw(e.opencode),uw(e.muse)],n=tw(e)',
      to: 'function __syzOv(e){let t=e.summary,n=e.daily.filter(e=>e.totalTokens>0).map(e=>e.day);return{id:`syzer`,label:`Syzer`,enabled:e.scanState?.enabled??!1,isScanning:e.scanState?.isScanning??!1,hasData:t?.hasAnySyzerData??e.scanState?.hasAnySyzerData??!1,lastScanCompletedAt:e.scanState?.lastScanCompletedAt??null,lastScanError:e.scanState?.lastScanError??null,sessions:t?.sessions??0,activityLabel:`events`,activityCount:t?.events??0,totalTokens:t?.totalTokens??0,newInputTokens:t?Math.max(t.inputTokens-t.cachedInputTokens,0):0,outputTokens:t?.outputTokens??0,cacheTokens:t?.cachedInputTokens??0,reasoningTokens:t?.reasoningOutputTokens??0,estimatedCostUsd:t?.estimatedCostUsd??null,hasPartialCost:!1,topModel:t?.topModel??null,topProject:t?.topProject??null,activeDays:$C(n)}}function dw(e){let t=[sw(e.claude),cw(e.codex),lw(e.opencode),uw(e.muse),__syzOv(e.syzer)],n=tw(e)' },
    { file: SETTINGS,
      from: 'for(let n of e.muse.daily){let e=t.get(n.day)??ew(n.day);e.totalTokens+=n.totalTokens,e.museTokens+=n.totalTokens,t.set(n.day,e)}',
      to: 'for(let n of e.muse.daily){let e=t.get(n.day)??ew(n.day);e.totalTokens+=n.totalTokens,e.museTokens+=n.totalTokens,t.set(n.day,e)}for(let n of e.syzer.daily){let e=t.get(n.day)??ew(n.day);e.totalTokens+=n.totalTokens,t.set(n.day,e)}' },
    { file: SETTINGS,
      from: 'C=I(e=>e.enableMuseUsage),w=I(e=>e.recordFeatureInteraction);(0,Z.useEffect)(()=>{f(),p(),m(),h()},[f,p,m,h]);',
      to: 'C=I(e=>e.enableMuseUsage),w=I(e=>e.recordFeatureInteraction),SA=I(e=>e.syzerUsageScanState),SB=I(e=>e.syzerUsageSummary),SC=I(e=>e.syzerUsageDaily),SD=I(e=>e.fetchSyzerUsage),SE=I(e=>e.refreshSyzerUsage),SF=I(e=>e.enableSyzerUsage);(0,Z.useEffect)(()=>{f(),p(),m(),h(),SD()},[f,p,m,h,SD]);' },
    { file: SETTINGS,
      from: 'muse:{scanState:l,summary:u,daily:d}}),[n,e,t,a,r,i,d,l,u,c,o,s])',
      to: 'muse:{scanState:l,summary:u,daily:d},syzer:{scanState:SA,summary:SB,daily:SC}}),[n,e,t,a,r,i,d,l,u,c,o,s,SA,SB,SC])' },
    { file: SETTINGS,
      from: 'l?.enabled?y():Promise.resolve()])',
      to: 'l?.enabled?y():Promise.resolve(),SA?.enabled?SE():Promise.resolve()])' },
    { file: SETTINGS,
      from: 'e.id===`opencode`?S():C()}',
      to: 'e.id===`opencode`?S():e.id===`syzer`?SF():C()}' }
  ]
}
module.exports = { groups, FILES: [PRELOAD, MAIN, STORE, SETTINGS] }
