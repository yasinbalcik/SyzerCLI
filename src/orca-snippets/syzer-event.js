'use strict';
// Proposed replacement for SYZER_EVENT in src/orca-edits.js. Depends ONLY on Orca's generic `un` (normalizeAgentStatusPayload).
// No single quotes and no template ${} inside the injected text; backticks are used as string delimiters (Orca bundle style).
const LINES = [
  'var __syzerEvMap={Prompt:`working`,ToolStart:`working`,ToolEnd:`working`,Waiting:`waiting`,Resumed:`working`,Done:`done`,End:`done`},__syzerPanes=new WeakMap;',
  'function __syzerStr(v,n){return typeof v==`string`&&v.trim().length>0?v.slice(0,n):void 0}',
  'function __syzerPrev(v){if(typeof v==`string`)return v;if(!v||typeof v!=`object`)return;for(const k of[`command`,`cmd`,`file_path`,`filePath`,`path`,`pattern`,`url`,`query`,`description`]){const x=v[k];if(typeof x==`string`&&x.trim().length>0)return x}try{return JSON.stringify(v)}catch{return}}',
  'function __syzerRoster(p){if(p.subs.size===0)return;return[...p.subs].map(([id,s])=>({id,state:`working`,startedAt:s.startedAt,agentType:s.agentType,description:s.description})).sort((a,b)=>a.startedAt-b.startedAt||(a.id<b.id?-1:a.id>b.id?1:0))}',
  'function __syzerOut(p,s,ip,intr){return un({state:s,prompt:p.prompt,agentType:`syzer`,model:p.model,toolName:p.tool,toolInput:p.input,interactivePrompt:ip,lastAssistantMessage:p.msg,lastAssistantMessageIsToolOutput:p.msgTool,interrupted:intr,subagents:__syzerRoster(p)})}',
  'function __syzerEvent(e,t,n,r,i){let P=__syzerPanes.get(e);P||__syzerPanes.set(e,P=new Map);',
  'let p=P.get(r)||{lead:void 0,prompt:``,model:void 0,tool:void 0,input:void 0,msg:void 0,msgTool:void 0,subs:new Map};i=i&&typeof i==`object`?i:{};',
  'if(t===`SubagentStart`||t===`SubagentStop`){const id=__syzerStr(i.agent_id,64);if(!id)return null;',
  'if(t===`SubagentStart`){const o=p.subs.get(id);if(!o&&p.subs.size>=32)return null;p.subs.set(id,{startedAt:o?o.startedAt:Date.now(),agentType:__syzerStr(i.agent_type,40)??o?.agentType,description:__syzerStr(i.description,160)??o?.description})}else p.subs.delete(id);',
  'if(p.lead===void 0&&p.subs.size===0)return null;P.set(r,p);return __syzerOut(p,p.lead===`done`&&p.subs.size>0?`working`:p.lead??`working`)}',
  'const s=typeof t==`string`?__syzerEvMap[t]:void 0;if(!s)return null;',
  'if(P.size>=256&&!P.has(r))P.delete(P.keys().next().value);',
  'if(t===`Prompt`)p.tool=p.input=p.msg=p.msgTool=void 0;',
  'if(typeof n==`string`&&n.trim().length>0)p.prompt=n;const md=__syzerStr(i.model,120);md&&(p.model=md);let ip;',
  'if(t===`ToolStart`||t===`ToolEnd`||t===`Waiting`||t===`Resumed`){',
  'const nm=__syzerStr(i.tool_name,200)??__syzerStr(i.name,200)??(t===`Waiting`||t===`Resumed`?`approval`:void 0),raw=i.tool_input??i.args??i.input??i.command,has=raw!=null,pv=has?__syzerStr(__syzerPrev(raw),1000):void 0;',
  'if(nm!==void 0){(nm!==p.tool||has)&&(p.input=pv);p.tool=nm}else has&&(p.input=pv);',
  'if(t===`ToolEnd`){const o=__syzerStr(__syzerPrev(i.result??i.output??i.tool_response),8000);o&&(p.msg=o,p.msgTool=!0)}',
  'if(t===`Waiting`){const q=i.interactive_prompt;ip=__syzerStr(typeof q==`string`?q:q&&typeof q==`object`?JSON.stringify(q):void 0,16000)}}',
  'if(t===`Done`){const a=__syzerStr(i.last_assistant_message,8000);a&&(p.msg=a,p.msgTool=void 0)}',
  'p.lead=s;P.set(r,p);const out=__syzerOut(p,s,ip,s===`done`&&(i.interrupted===!0||i.is_interrupt===!0)?!0:void 0);t===`End`&&P.delete(r);return out}',
];
const SYZER_EVENT = LINES.join('');
module.exports = { SYZER_EVENT, LINES };
