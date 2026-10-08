'use strict';

// Üç bölmeli web arayüzü (Orca benzeri): sol = beceriler/model/key, orta = sohbet, sağ = çalışma alanları + oturumlar.
// Bağımlılıksız tek sayfa. Sunucu: src/web.js
const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Syzer</title><link rel="icon" href="/icon.png">
<style>
:root{--bg:#0d0d10;--side:#131317;--panel:#17171c;--panel2:#1d1d24;--line:#25252d;--fg:#ececf1;--mut:#8b8b99;--acc:#ff8a3d;--ok:#3ecf8e;--warn:#f5b84b;--bad:#f0616d;--code:#0f0f13;--blue:#6cb6ff}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--fg);font:13.5px/1.55 system-ui,Segoe UI,Roboto,sans-serif;display:grid;grid-template-columns:var(--lw,280px) minmax(0,1fr) var(--rw,290px);overflow:hidden}
body.nol{--lw:0px}body.nor{--rw:0px}
.col{background:var(--side);display:flex;flex-direction:column;min-height:0;overflow:hidden}
#left{border-right:1px solid var(--line)}#right{border-left:1px solid var(--line)}
body.nol #left,body.nor #right{display:none}
.brand{display:flex;align-items:center;gap:10px;padding:12px 14px;font-weight:600;font-size:15px}
.brand img{width:24px;height:24px;border-radius:6px}.brand small{color:var(--mut);font-weight:400;font-size:11px}
.tabs{display:flex;gap:2px;padding:0 8px 8px;border-bottom:1px solid var(--line)}
.tabs button{flex:1;background:none;border:0;border-radius:8px;padding:6px 4px;color:var(--mut);cursor:pointer;font:inherit;font-size:12.5px}
.tabs button.on{background:var(--panel2);color:var(--fg)}
.pane{flex:1;overflow:auto;padding:10px 12px;min-height:0}.pane[hidden]{display:none}
h4{margin:14px 0 6px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}h4:first-child{margin-top:2px}
label{display:block;font-size:11.5px;color:var(--mut);margin:9px 0 3px}
select,input,textarea,button{font:inherit;color:inherit}
select,input[type=text]{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 8px;outline:none}
select:focus,input:focus,textarea:focus{border-color:#3d3d4b}
button{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 11px;cursor:pointer}
button:hover{border-color:#3d3d4b}button.pri{background:var(--acc);border-color:var(--acc);color:#1a0d00;font-weight:600}
.item{display:flex;flex-direction:column;gap:1px;padding:7px 9px;border-radius:8px;cursor:pointer;border:1px solid transparent}
.item:hover{background:var(--panel2)}.item.on{background:var(--panel2);border-color:var(--line)}
.item .t{font-weight:500;display:flex;gap:6px;align-items:center}.item .d{color:var(--mut);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:10.5px;color:var(--mut);border:1px solid var(--line);border-radius:99px;padding:0 7px}.tag.g{color:var(--ok)}.tag.w{color:var(--warn)}
.bar{height:6px;border-radius:99px;background:var(--panel2);overflow:hidden;margin:4px 0}.bar>i{display:block;height:100%;background:var(--ok)}
.bar.w>i{background:var(--warn)}.bar.b>i{background:var(--bad)}
.row{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mut)}.prov{margin-bottom:10px}.prov b{color:var(--fg);font-size:13px}
.key{display:flex;align-items:center;gap:7px;font:12px ui-monospace,Consolas,monospace;padding:3px 4px;border-radius:6px;cursor:pointer}.key:hover{background:var(--panel2)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);flex:none}.dot.wait{background:var(--warn)}.dot.off{background:var(--bad)}
.key.active{color:var(--acc)}.key .x{margin-left:auto;color:var(--mut);background:none;border:0;padding:0 4px}
textarea{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;resize:none;outline:none}
/* orta */
#mid{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg)}
.top{display:flex;gap:8px;align-items:center;height:42px;padding:0 10px;border-bottom:1px solid var(--line);flex:none}
.top .ttl{flex:1;display:flex;align-items:center;gap:8px;min-width:0;font-weight:500}.top .ttl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ib{background:none;border:0;padding:5px 8px;color:var(--mut);font-size:15px;line-height:1}.ib:hover{color:var(--fg);background:var(--panel2)}
#log{flex:1;overflow:auto;padding:22px max(18px,calc((100% - 820px)/2))}
.empty{margin:14vh auto 0;text-align:center;color:var(--mut)}.empty img{width:56px;border-radius:14px;margin-bottom:10px}.empty h2{color:var(--fg);margin:0 0 4px;font-weight:600}
.msg{margin:0 0 18px}.msg .who{font-size:11px;color:var(--mut);margin-bottom:4px}
.msg.user .body{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:9px 13px;white-space:pre-wrap;display:inline-block;max-width:100%}
.body p{margin:.4em 0}.body pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:11px;overflow:auto;font:12.5px/1.5 ui-monospace,Consolas,monospace}
.body code{background:var(--code);padding:1px 5px;border-radius:5px;font:12.5px ui-monospace,Consolas,monospace}.body pre code{padding:0;background:none}
.tool{margin:6px 0;font:12.5px ui-monospace,Consolas,monospace;color:var(--mut)}.tool b{color:var(--blue)}.tool .res{padding-left:14px}.tool .res.bad{color:var(--bad)}
.tool details{padding-left:14px}.tool pre{max-height:220px;margin:4px 0}
.agent{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:8px 12px;margin:8px 0;font-size:12.5px}.agent summary{cursor:pointer}.agent .st{font:12px ui-monospace,Consolas,monospace;color:var(--mut);margin:2px 0 2px 8px}.agent pre{max-height:260px;overflow:auto;margin:6px 0;white-space:pre-wrap}.agent .live{color:var(--blue)}
.warn{color:var(--warn);font-size:12.5px;margin:4px 0}.err{color:var(--bad);margin:6px 0}
.think{color:var(--mut);font-size:12px;font-style:italic;max-height:3.2em;overflow:hidden;margin:4px 0}
.confirm{border:1px solid var(--warn);background:#1d1807;border-radius:12px;padding:12px;margin:10px 0}
.confirm pre{max-height:240px;overflow:auto;background:var(--code);padding:8px;border-radius:8px;font:12px ui-monospace,Consolas,monospace}
.confirm .btns{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.meta{font-size:11px;color:var(--mut);margin-top:4px}
.comp{padding:10px max(14px,calc((100% - 820px)/2)) 14px;flex:none}
.box{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:8px 10px 8px}
.box textarea{background:none;border:0;padding:4px 4px;min-height:42px;max-height:220px}
.bar2{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-top:4px}.bar2 select{width:auto;max-width:210px;padding:3px 6px;font-size:12px;background:var(--panel2)}
.bar2 .sp{flex:1}.sug{position:absolute;bottom:100%;left:0;right:0;background:var(--panel2);border:1px solid var(--line);border-radius:10px;margin-bottom:6px;max-height:220px;overflow:auto;display:none}
.sug div{padding:6px 10px;cursor:pointer;display:flex;gap:8px}.sug div:hover,.sug div.on{background:#262630}.sug span{color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rel{position:relative}
.add{display:flex;gap:6px;margin-top:8px}
@media(max-width:1000px){body{--lw:0px;--rw:0px}#left,#right{display:none}}
</style></head><body>
<div class="col" id="left">
  <div class="brand"><img src="/icon.png" alt=""><div>Syzer <small id="ver"></small></div></div>
  <div class="tabs"><button data-tab="skills" class="on" data-i="skills">Skills</button><button data-tab="model" data-i="model">Model</button><button data-tab="keys" data-i="keys">Keys</button></div>
  <div class="pane" id="p-skills">
    <input type="text" id="sk-q" placeholder="Search…" data-ph="search">
    <h4 data-i="skills">Skills</h4><div id="sk-skills"></div>
    <h4 data-i="commands">Commands</h4><div id="sk-cmds"></div>
    <h4 data-i="agents">Agents</h4><div id="sk-agents"></div>
  </div>
  <div class="pane" id="p-model" hidden>
    <h4 data-i="settings">Settings</h4>
    <label data-i="provider">Provider</label><select id="provider"></select>
    <label data-i="model">Model</label><select id="model"></select>
    <label data-i="effort">Effort</label><select id="effort"></select>
    <label data-i="perm">Permissions</label><select id="perm"></select>
    <label data-i="lang">Language</label><select id="lang"></select>
  </div>
  <div class="pane" id="p-keys" hidden>
    <h4 data-i="usage">Usage</h4><div id="usage">…</div><button id="ref" style="width:100%;margin-top:4px" data-i="refresh">Refresh</button>
    <h4 data-i="keys">Keys</h4><div id="keys"></div>
    <label data-i="addkeys">Add keys</label><textarea id="newkeys" rows="2" placeholder="sk-or-v1-… / nvapi-…"></textarea>
    <button id="addk" style="width:100%;margin-top:6px" data-i="add">Add</button><div class="meta" id="kmsg"></div>
  </div>
</div>

<div id="mid">
  <div class="top"><button class="ib" id="tl" title="Toggle left">☰</button><div class="ttl"><img src="/icon.png" width="16" height="16" style="border-radius:4px"><span id="title">Syzer</span></div><button id="clear" data-i="clear">+ New chat</button><button class="ib" id="tr" title="Toggle right">▥</button></div>
  <div id="log"></div>
  <div class="comp"><div class="box rel"><div class="sug" id="sug"></div>
    <textarea id="inp" rows="1" placeholder="Message… (Enter = send, Shift+Enter = newline, / = skills)"></textarea>
    <div class="bar2"><select id="m2"></select><select id="e2"></select><select id="p2"></select><span class="sp"></span><span class="tag" id="ctxtag"></span><button class="pri" id="send" data-i="send">Send</button><button id="stop" style="display:none" data-i="stop">Stop</button></div>
  </div></div>
</div>

<div class="col" id="right">
  <div class="brand" style="font-size:13px"><span data-i="workspaces">Workspaces</span></div>
  <div class="pane" style="flex:none;max-height:46%">
    <div id="ws"></div>
    <div class="add"><input type="text" id="wspath" placeholder="C:\path\to\project"><button id="wsadd">+</button></div>
  </div>
  <div class="tabs" style="border-top:1px solid var(--line);padding-top:8px"><button class="on" data-i="sessions">Sessions</button></div>
  <div class="pane" id="sess"></div>
</div>

<script>
const I={en:{skills:'Skills',commands:'Commands',agents:'Agents',model:'Model',keys:'Keys',settings:'Settings',provider:'Provider',effort:'Effort',perm:'Permissions',lang:'Language',usage:'Usage',refresh:'Refresh',addkeys:'Add keys',add:'Add',clear:'+ New chat',send:'Send',stop:'Stop',search:'Search…',workspaces:'Workspaces',sessions:'Sessions',left:'left',keysr:'keys ready',noq:'quota n/a',used:'used',allow:'Allow',deny:'Deny',always:'Always (session)',rule:'Always (save rule)',nosess:'No saved sessions in this workspace',hello:'How can I help?',msgs:'msgs',ph:'Message… (Enter = send, Shift+Enter = newline, / = skills)'},
tr:{skills:'Beceriler',commands:'Komutlar',agents:'Ajanlar',model:'Model',keys:'Key\'ler',settings:'Ayarlar',provider:'Sağlayıcı',effort:'Efor',perm:'İzinler',lang:'Dil',usage:'Kullanım',refresh:'Yenile',addkeys:'Key ekle',add:'Ekle',clear:'+ Yeni sohbet',send:'Gönder',stop:'Durdur',search:'Ara…',workspaces:'Çalışma alanları',sessions:'Oturumlar',left:'kaldı',keysr:'key hazır',noq:'kota yok',used:'kullanıldı',allow:'İzin ver',deny:'Reddet',always:'Her zaman (oturum)',rule:'Her zaman (kural kaydet)',nosess:'Bu çalışma alanında kayıtlı oturum yok',hello:'Nasıl yardımcı olabilirim?',msgs:'mesaj',ph:'Mesaj… (Enter = gönder, Shift+Enter = satır, / = beceriler)'}};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];let ST=null,L='en',SK={skills:[],commands:[],agents:[]};
const tr=k=>(I[L]||I.en)[k]||I.en[k]||k;
const api=async(p,b)=>{const r=await fetch(p,b===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json()};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function md(t){const parts=t.split(/(\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$))/);return parts.map(p=>{if(p.startsWith('\x60\x60\x60')){const c=p.replace(/^\x60\x60\x60[^\n]*\n?/,'').replace(/\x60\x60\x60$/,'');return '<pre><code>'+esc(c)+'</code></pre>'}
return esc(p).split(/\n{2,}/).map(x=>'<p>'+x.replace(/\x60([^\x60\n]+)\x60/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>')+'</p>').join('')}).join('')}
function i18n(){$$('[data-i]').forEach(e=>e.textContent=tr(e.dataset.i));$$('[data-ph]').forEach(e=>e.placeholder=tr(e.dataset.ph));$('#inp').placeholder=tr('ph')}
function fill(sel,items,val){const el=$(sel);el.innerHTML=items.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===val?' selected':'')+'>'+esc(l)+'</option>').join('')}
const saveLS=(k,v)=>{try{localStorage.setItem(k,v)}catch{}},getLS=k=>{try{return localStorage.getItem(k)}catch{return null}};

/* ---- sol ---- */
$$('.tabs button[data-tab]').forEach(b=>b.onclick=()=>{$$('.tabs button[data-tab]').forEach(x=>x.classList.toggle('on',x===b));['skills','model','keys'].forEach(t=>$('#p-'+t).hidden=t!==b.dataset.tab)});
function renderSkills(){const q=$('#sk-q').value.toLowerCase();const mk=(arr,pre)=>arr.filter(x=>!q||x.name.toLowerCase().includes(q)||(x.description||'').toLowerCase().includes(q)).map(x=>'<div class="item" data-ins="'+(pre?'/'+esc(x.name)+' ':'')+'" data-n="'+esc(x.name)+'"><div class="t">'+(pre?'/':'')+esc(x.name)+(x.builtin?' <span class="tag">built-in</span>':'')+'</div><div class="d">'+esc(x.description||'')+'</div></div>').join('')||'<div class="meta">—</div>';
$('#sk-skills').innerHTML=mk(SK.skills,1);$('#sk-cmds').innerHTML=mk(SK.commands,1);$('#sk-agents').innerHTML=mk(SK.agents,0);
$$('#p-skills .item[data-ins]').forEach(e=>e.onclick=()=>{const v=e.dataset.ins||('Use the "'+e.dataset.n+'" agent (spawn_agent) for: ');$('#inp').value=v;$('#inp').focus()});
$$('#sk-agents .item').forEach(e=>e.onclick=()=>{$('#inp').value='Use the "'+e.dataset.n+'" agent (spawn_agent) for: ';$('#inp').focus()})}
$('#sk-q').oninput=renderSkills;
function render(){L=I[ST.lang]?ST.lang:'en';i18n();$('#ver').textContent='v'+ST.version;
fill('#provider',ST.providers.map(p=>[p.id,p.name]),ST.provider);fill('#effort',['auto','off','low','medium','high','xhigh'].map(x=>[x,x]),ST.effort);fill('#e2',['auto','off','low','medium','high','xhigh'].map(x=>[x,'effort: '+x]),ST.effort);
fill('#perm',['ask','auto','readonly'].map(x=>[x,x]),ST.perm);fill('#p2',['ask','auto','readonly'].map(x=>[x,'perm: '+x]),ST.perm);fill('#lang',Object.entries(ST.langs),ST.lang);
$('#keys').innerHTML=ST.keys.map(k=>'<div class="key'+(k.active?' active':'')+'" data-k="'+k.index+'"><span class="dot '+k.state+'"></span><span title="'+esc(k.reason||'')+'">'+k.index+'. '+esc(k.key)+'</span><button class="x" data-rm="'+k.index+'">✕</button></div>').join('')||'<div class="meta">—</div>';
$$('[data-rm]').forEach(b=>b.onclick=async ev=>{ev.stopPropagation();ST=await api('/api/keys/remove',{index:b.dataset.rm});render();usage()});
$$('#keys .key').forEach(e=>e.onclick=async()=>{ST=await api('/api/settings',{activeKey:e.dataset.k});render()});
$('#ctxtag').textContent=ST.provider+' · '+ST.ready+' '+tr('keysr')}
async function loadModels(){const m=await api('/api/models');const ids=m.map(x=>[x.id,x.id]);if(!ids.find(x=>x[0]===ST.model))ids.unshift([ST.model,ST.model]);fill('#model',ids,ST.model);fill('#m2',ids,ST.model)}
async function usage(){const u=await api('/api/usage');$('#usage').innerHTML=u.providers.map(p=>{const c=p.percent_used==null?0:p.percent_used;const left=p.limit!=null?Math.max(0,p.limit-(p.used||0))+' '+tr('left'):tr('noq');
return '<div class="prov"><div class="row"><b>'+esc(p.name)+'</b><span>'+p.keys_ready+'/'+p.keys_total+' '+tr('keysr')+'</span></div><div class="bar '+(c>=90?'b':c>=60?'w':'')+'"><i style="width:'+c+'%"></i></div><div class="row"><span>'+(p.percent_used==null?'—':c+'% '+tr('used'))+'</span><span>'+left+'</span></div></div>'}).join('')+(u.providers.length>1?'<div class="row"><b style="color:var(--fg)">Total</b><span>'+(u.percent_used==null?'—':u.percent_used+'%')+'</span></div>':'')}
for(const [id,key] of [['#provider','provider'],['#model','model'],['#effort','effort'],['#perm','perm'],['#lang','lang'],['#m2','model'],['#e2','effort'],['#p2','perm']])$(id).onchange=async e=>{const r=await api('/api/settings',{[key]:e.target.value});if(r.error){alert(r.error);return}ST=r;render();if(key==='provider'){await loadModels();usage()}else{fill('#model',[...$('#model').options].map(o=>[o.value,o.value]),ST.model);fill('#m2',[...$('#m2').options].map(o=>[o.value,o.value]),ST.model)}};
$('#addk').onclick=async()=>{const t=$('#newkeys').value;if(!t.trim())return;$('#kmsg').textContent='…';const r=await api('/api/keys/add',{text:t});$('#newkeys').value='';$('#kmsg').textContent='+'+r.added+' / ='+r.exists+' / ✖'+r.invalid;ST=r.state;render();usage()};
$('#ref').onclick=usage;

/* ---- sağ ---- */
async function workspaces(){const w=await api('/api/workspaces');$('#ws').innerHTML=w.list.map(x=>'<div class="item'+(x.path===w.current?' on':'')+'" data-p="'+esc(x.path)+'"><div class="t">'+(x.path===w.current?'● ':'')+esc(x.name)+(x.branch?' <span class="tag">'+esc(x.branch)+(x.dirty?' ±'+x.dirty:'')+'</span>':'')+'<button class="x ib" style="margin-left:auto;padding:0 5px" data-rmw="'+esc(x.path)+'">✕</button></div><div class="d" title="'+esc(x.path)+'">'+esc(x.path)+' · '+x.sessions+' '+tr('sessions').toLowerCase()+'</div></div>').join('');
$$('#ws .item').forEach(e=>e.onclick=async()=>{if(e.classList.contains('on'))return;const r=await api('/api/workspace',{action:'select',path:e.dataset.p});if(r.error)return alert(r.error);ST=r;newView();render();workspaces();sessionsList();loadSkills()});
$$('[data-rmw]').forEach(b=>b.onclick=async ev=>{ev.stopPropagation();await api('/api/workspace',{action:'remove',path:b.dataset.rmw});workspaces()})}
$('#wsadd').onclick=async()=>{const p=$('#wspath').value.trim();if(!p)return;const r=await api('/api/workspace',{action:'add',path:p});if(r.error)return alert(r.error);$('#wspath').value='';workspaces()};
async function sessionsList(){const s=await api('/api/sessions');$('#sess').innerHTML=s.map(x=>'<div class="item'+(x.current?' on':'')+'" data-id="'+x.id+'"><div class="t">'+esc(x.title||'…')+'</div><div class="d">'+new Date(x.ts).toLocaleString()+' · '+x.count+' '+tr('msgs')+'</div></div>').join('')||'<div class="meta">'+tr('nosess')+'</div>';
$$('#sess .item').forEach(e=>e.onclick=async()=>{const r=await api('/api/session/resume',{id:e.dataset.id});ST=r;newView();ST.messages.forEach(m=>addMsg(m.role,m.role==='user'?esc(m.content):md(m.content)));render();sessionsList()})}
async function loadSkills(){SK=await api('/api/skills');renderSkills()}

/* ---- orta ---- */
const log=$('#log');const bottom=()=>{log.scrollTop=log.scrollHeight};
function newView(){log.innerHTML='';if(!ST.messages.length)empty()}
function empty(){log.innerHTML='<div class="empty"><img src="/icon.png" alt=""><h2>'+tr('hello')+'</h2><div>'+esc(ST.cwd)+'</div></div>'}
function addMsg(role,h){const e=log.querySelector('.empty');if(e)e.remove();const d=document.createElement('div');d.className='msg '+role;d.innerHTML='<div class="who">'+(role==='user'?'You':'Syzer')+'</div><div class="body">'+h+'</div>';log.appendChild(d);bottom();return d.querySelector('.body')}
async function send(text){if(!text.trim())return;addMsg('user',esc(text));$('#inp').value='';$('#inp').style.height='auto';$('#send').style.display='none';$('#stop').style.display='';$('#title').textContent=text.slice(0,60);
let body=addMsg('assistant',''),buf='',think=null,tools=null;
const flush=()=>{if(buf){let t=body.querySelector('.t');if(!t){t=document.createElement('div');t.className='t';body.appendChild(t)}t.innerHTML=md(buf);bottom()}};
const newBlock=()=>{buf='';const t=body.querySelector('.t');if(t)t.classList.remove('t')};
try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
if(!r.ok){const j=await r.json();throw new Error(j.error||r.status)}
const rd=r.body.getReader(),dec=new TextDecoder();let rest='';
for(;;){const {value,done}=await rd.read();if(done)break;rest+=dec.decode(value,{stream:true});const lines=rest.split('\n');rest=lines.pop();
for(const ln of lines){if(!ln)continue;const e=JSON.parse(ln);
if(e.type==='text'){buf+=e.text;if(think){think.remove();think=null}flush()}
else if(e.type==='endText'){newBlock()}
else if(e.type==='thinking'){if(!think){think=document.createElement('div');think.className='think';body.appendChild(think)}think.textContent=(think.textContent+e.text).slice(-300)}
else if(e.type==='tool'){newBlock();const d=document.createElement('div');d.className='tool';d.innerHTML='<b>● '+esc(e.name)+'</b> '+esc(e.summary.slice(0,140));body.appendChild(d);tools=d;bottom()}
else if(e.type==='toolResult'&&tools){const x=document.createElement('div');x.className='res'+(e.ok?'':' bad');x.textContent='⎿ '+e.summary;tools.appendChild(x);if(e.body){const dt=document.createElement('details');dt.innerHTML='<summary>…</summary><pre>'+esc(e.body)+'</pre>';tools.appendChild(dt)}bottom()}
else if(e.type==='agentStart'){newBlock();const d=document.createElement('div');d.className='agent';d.id='ag-'+e.id;d.innerHTML='<span class="live">⠿ '+esc(e.label)+'</span> <span class="meta" data-act></span>';body.appendChild(d);bottom()}
else if(e.type==='agentUpdate'){const d=document.getElementById('ag-'+e.id);if(d){const a=d.querySelector('[data-act]');if(a)a.textContent=e.action}}
else if(e.type==='agentDone'){const d=document.getElementById('ag-'+e.id);const r=e.run;if(d&&r){d.innerHTML='<details><summary>'+(r.ok?'✔ ':'✖ ')+'<b>'+esc(r.agent)+'</b> · '+esc(r.label)+' <span class="meta">'+(r.steps||[]).length+' steps · '+esc(r.secs||'?')+'s'+(r.model?' · '+esc(r.model):'')+'</span></summary><div class="meta">Task</div><pre>'+esc(r.prompt)+'</pre>'+(r.steps||[]).map((s,i)=>'<div class="st">'+(i+1)+'. '+esc(s.tool)+'('+esc(s.summary)+')'+(s.result?'<br>&nbsp;&nbsp;⎿ '+esc(s.result):'')+'</div>').join('')+'<div class="meta">Report</div><pre>'+esc(r.report)+'</pre></details>'}bottom()}
else if(e.type==='warn'){const w=document.createElement('div');w.className='warn';w.textContent='⚠ '+e.text;body.appendChild(w)}
else if(e.type==='confirm'){const c=document.createElement('div');c.className='confirm';c.innerHTML='<b>'+esc(e.kind)+'</b> '+esc(e.summary)+(e.preview?'<pre>'+esc(e.preview)+'</pre>':'')+'<div class="btns"><button class="pri" data-a="yes">'+tr('allow')+'</button><button data-a="no">'+tr('deny')+'</button><button data-a="always">'+tr('always')+'</button><button data-a="rule">'+tr('rule')+'</button></div>';
c.querySelectorAll('button').forEach(b=>b.onclick=async()=>{await api('/api/confirm',{id:e.id,answer:b.dataset.a});c.remove()});body.appendChild(c);bottom()}
else if(e.type==='error'){const x=document.createElement('div');x.className='err';x.textContent='✖ '+e.text;body.appendChild(x)}
else if(e.type==='aborted'){const x=document.createElement('div');x.className='warn';x.textContent='[stopped]';body.appendChild(x)}
else if(e.type==='done'){const m=document.createElement('div');m.className='meta';m.textContent=e.model+' · key '+e.key+' · '+e.tokens+' tok · '+(e.ms/1000).toFixed(1)+'s';body.appendChild(m)}}}
}catch(err){const x=document.createElement('div');x.className='err';x.textContent='✖ '+err.message;body.appendChild(x)}
$('#send').style.display='';$('#stop').style.display='none';usage();sessionsList();workspaces();ST=await api('/api/state');render()}
$('#send').onclick=()=>send($('#inp').value);
/* / otomatik tamamlama */
let sugIdx=0;function sug(){const v=$('#inp').value;const box=$('#sug');if(!v.startsWith('/')||v.includes(' ')){box.style.display='none';return}
const q=v.slice(1).toLowerCase();const all=[...SK.skills.map(x=>[x.name,x.description]),...SK.commands.map(x=>[x.name,x.description])].filter(x=>x[0].toLowerCase().startsWith(q)).slice(0,30);
if(!all.length){box.style.display='none';return}sugIdx=Math.min(sugIdx,all.length-1);box.innerHTML=all.map((x,i)=>'<div class="'+(i===sugIdx?'on':'')+'" data-n="'+esc(x[0])+'">/'+esc(x[0])+'<span>'+esc(x[1]||'')+'</span></div>').join('');box.style.display='block';
$$('#sug div').forEach(d=>d.onmousedown=e=>{e.preventDefault();$('#inp').value='/'+d.dataset.n+' ';box.style.display='none'})}
$('#inp').oninput=e=>{e.target.style.height='auto';e.target.style.height=Math.min(220,e.target.scrollHeight)+'px';sug()};
$('#inp').onkeydown=e=>{const box=$('#sug');if(box.style.display==='block'){const n=box.children.length;if(e.key==='ArrowDown'){e.preventDefault();sugIdx=(sugIdx+1)%n;sug();return}if(e.key==='ArrowUp'){e.preventDefault();sugIdx=(sugIdx-1+n)%n;sug();return}if(e.key==='Tab'||e.key==='Enter'){e.preventDefault();$('#inp').value='/'+box.children[sugIdx].dataset.n+' ';box.style.display='none';return}if(e.key==='Escape'){box.style.display='none';return}}
if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send($('#inp').value)}};
$('#stop').onclick=()=>api('/api/abort',{});
$('#clear').onclick=async()=>{ST=await api('/api/clear',{});newView();render();sessionsList();$('#title').textContent='Syzer'};
$('#tl').onclick=()=>{document.body.classList.toggle('nol');saveLS('nol',document.body.classList.contains('nol')?'1':'')};
$('#tr').onclick=()=>{document.body.classList.toggle('nor');saveLS('nor',document.body.classList.contains('nor')?'1':'')};
if(getLS('nol'))document.body.classList.add('nol');if(getLS('nor'))document.body.classList.add('nor');
(async()=>{ST=await api('/api/state');render();newView();for(const m of ST.messages)addMsg(m.role,m.role==='user'?esc(m.content):md(m.content));loadSkills();workspaces();sessionsList();await loadModels();usage()})();
</script></body></html>`;

module.exports = { html };
