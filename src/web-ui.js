'use strict';

// Tek sayfa web arayüzü (bağımlılıksız). Sunucu: src/web.js
const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Syzer</title><link rel="icon" href="/icon.png">
<style>
:root{--bg:#0b0b0d;--panel:#131317;--panel2:#1a1a20;--line:#26262e;--fg:#ececf1;--mut:#8b8b99;--acc:#ff8a3d;--ok:#3ecf8e;--warn:#f5b84b;--bad:#f0616d;--code:#0f0f13}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,Segoe UI,Roboto,sans-serif;display:flex}
aside{width:300px;flex:none;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow:auto}
main{flex:1;display:flex;flex-direction:column;min-width:0}
.brand{display:flex;align-items:center;gap:10px;padding:16px;font-weight:600;font-size:16px}
.brand img{width:28px;height:28px;border-radius:6px}.brand small{color:var(--mut);font-weight:400}
section{padding:12px 16px;border-top:1px solid var(--line)}
h4{margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
label{display:block;font-size:12px;color:var(--mut);margin:8px 0 3px}
select,input,textarea,button{font:inherit;color:inherit}
select,input[type=text]{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
button{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:7px 12px;cursor:pointer}
button:hover{border-color:#3a3a46}button.pri{background:var(--acc);border-color:var(--acc);color:#1a0d00;font-weight:600}
.bar{height:7px;border-radius:99px;background:var(--panel2);overflow:hidden;margin:4px 0}.bar>i{display:block;height:100%;background:var(--ok)}
.bar.w>i{background:var(--warn)}.bar.b>i{background:var(--bad)}
.row{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mut)}
.prov{margin-bottom:10px}.prov b{color:var(--fg);font-weight:600;font-size:13px}
.key{display:flex;align-items:center;gap:6px;font:12px ui-monospace,Consolas,monospace;padding:3px 0}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);flex:none}.dot.wait{background:var(--warn)}.dot.off{background:var(--bad)}
.key.active{color:var(--acc)}.key .x{margin-left:auto;cursor:pointer;color:var(--mut);background:none;border:0;padding:0 4px}
textarea{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px;resize:vertical;min-height:54px}
#log{flex:1;overflow:auto;padding:24px max(24px,calc((100% - 860px)/2))}
.msg{margin:0 0 18px;max-width:100%}.msg .who{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.msg.user .body{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 14px;white-space:pre-wrap}
.body p{margin:.4em 0}.body pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;font:12.5px/1.5 ui-monospace,Consolas,monospace}
.body code{background:var(--code);padding:1px 5px;border-radius:5px;font:12.5px ui-monospace,Consolas,monospace}.body pre code{padding:0;background:none}
.tool{margin:6px 0;font:12.5px ui-monospace,Consolas,monospace;color:var(--mut)}.tool b{color:#6cb6ff}.tool .res{padding-left:14px}.tool .res.bad{color:var(--bad)}
.tool details{padding-left:14px}.tool pre{max-height:220px;margin:4px 0}
.warn{color:var(--warn);font-size:12.5px;margin:4px 0}.err{color:var(--bad);margin:6px 0}
.think{color:var(--mut);font-size:12px;font-style:italic;max-height:3.2em;overflow:hidden;margin:4px 0}
.confirm{border:1px solid var(--warn);background:#1d1807;border-radius:12px;padding:12px;margin:10px 0}
.confirm pre{max-height:240px;overflow:auto;background:var(--code);padding:8px;border-radius:8px;font:12px ui-monospace,Consolas,monospace}
.confirm .btns{display:flex;gap:8px;margin-top:8px}
form{padding:14px max(24px,calc((100% - 860px)/2)) 18px;border-top:1px solid var(--line);display:flex;gap:10px;align-items:flex-end}
form textarea{min-height:46px;max-height:200px}
.meta{font-size:11px;color:var(--mut);margin-top:4px}
.top{display:flex;gap:8px;align-items:center;padding:10px 24px;border-bottom:1px solid var(--line);font-size:12px;color:var(--mut)}
.top .sp{flex:1}.pill{background:var(--panel2);border:1px solid var(--line);border-radius:99px;padding:2px 10px}
@media(max-width:800px){aside{display:none}}
</style></head><body>
<aside>
  <div class="brand"><img src="/icon.png" alt=""><div>Syzer <small id="ver"></small></div></div>
  <section><h4 data-i="usage">Usage</h4><div id="usage">…</div><button id="ref" style="margin-top:6px;width:100%" data-i="refresh">Refresh</button></section>
  <section><h4 data-i="settings">Settings</h4>
    <label data-i="provider">Provider</label><select id="provider"></select>
    <label data-i="model">Model</label><select id="model"></select>
    <label data-i="effort">Effort</label><select id="effort"></select>
    <label data-i="perm">Permissions</label><select id="perm"></select>
    <label data-i="lang">Language</label><select id="lang"></select>
  </section>
  <section><h4 data-i="keys">Keys</h4><div id="keys"></div>
    <label data-i="addkeys">Add keys</label><textarea id="newkeys" placeholder="sk-or-v1-… / nvapi-…"></textarea>
    <button id="addk" style="margin-top:6px;width:100%" data-i="add">Add</button><div class="meta" id="kmsg"></div></section>
</aside>
<main>
  <div class="top"><span class="pill" id="cwd"></span><span class="sp"></span><button id="clear" data-i="clear">New chat</button></div>
  <div id="log"></div>
  <form id="f"><textarea id="inp" rows="1" placeholder="Message… (Enter = send, Shift+Enter = newline)"></textarea><button class="pri" id="send" data-i="send">Send</button><button type="button" id="stop" style="display:none" data-i="stop">Stop</button></form>
</main>
<script>
const I={en:{usage:'Usage',refresh:'Refresh',settings:'Settings',provider:'Provider',model:'Model',effort:'Effort',perm:'Permissions',lang:'Language',keys:'Keys',addkeys:'Add keys',add:'Add',clear:'New chat',send:'Send',stop:'Stop',ph:'Message… (Enter = send, Shift+Enter = newline)',allow:'Allow',deny:'Deny',always:'Always (session)',rule:'Always (save rule)',left:'left',keysr:'keys ready',noq:'quota n/a',used:'used'},
tr:{usage:'Kullanım',refresh:'Yenile',settings:'Ayarlar',provider:'Sağlayıcı',model:'Model',effort:'Efor',perm:'İzinler',lang:'Dil',keys:'Anahtarlar',addkeys:'Key ekle',add:'Ekle',clear:'Yeni sohbet',send:'Gönder',stop:'Durdur',ph:'Mesaj… (Enter = gönder, Shift+Enter = satır)',allow:'İzin ver',deny:'Reddet',always:'Her zaman (oturum)',rule:'Her zaman (kural kaydet)',left:'kaldı',keysr:'key hazır',noq:'kota yok',used:'kullanıldı'}};
const $=s=>document.querySelector(s);let ST=null,L='en';
const tr=k=>(I[L]||I.en)[k]||I.en[k]||k;
const api=async(p,b)=>{const r=await fetch(p,b===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json()};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function md(t){const parts=t.split(/(\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$))/);return parts.map(p=>{if(p.startsWith('\x60\x60\x60')){const c=p.replace(/^\x60\x60\x60[^\n]*\n?/,'').replace(/\x60\x60\x60$/,'');return '<pre><code>'+esc(c)+'</code></pre>'}
return esc(p).split(/\n{2,}/).map(x=>'<p>'+x.replace(/\x60([^\x60\n]+)\x60/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>')+'</p>').join('')}).join('')}
function i18n(){document.querySelectorAll('[data-i]').forEach(e=>e.textContent=tr(e.dataset.i));$('#inp').placeholder=tr('ph')}
function fill(sel,items,val){const el=$(sel);el.innerHTML=items.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===val?' selected':'')+'>'+esc(l)+'</option>').join('')}
async function loadModels(){const m=await api('/api/models');const ids=m.map(x=>[x.id,x.id]);if(!ids.find(x=>x[0]===ST.model))ids.unshift([ST.model,ST.model]);fill('#model',ids,ST.model)}
function render(){L=I[ST.lang]?ST.lang:'en';i18n();$('#ver').textContent='v'+ST.version;$('#cwd').textContent=ST.cwd;
fill('#provider',ST.providers.map(p=>[p.id,p.name]),ST.provider);fill('#effort',['auto','off','low','medium','high','xhigh'].map(x=>[x,x]),ST.effort);
fill('#perm',['ask','auto','readonly'].map(x=>[x,x]),ST.perm);fill('#lang',Object.entries(ST.langs),ST.lang);
$('#keys').innerHTML=ST.keys.map(k=>'<div class="key'+(k.active?' active':'')+'"><span class="dot '+k.state+'"></span><span title="'+esc(k.reason||'')+'">'+k.index+'. '+esc(k.key)+'</span><button class="x" data-rm="'+k.index+'">✕</button></div>').join('')||'<div class="meta">—</div>';
document.querySelectorAll('[data-rm]').forEach(b=>b.onclick=async()=>{ST=await api('/api/keys/remove',{index:b.dataset.rm});render();usage()});
document.querySelectorAll('#keys .key').forEach((e,i)=>e.onclick=async ev=>{if(ev.target.dataset.rm)return;ST=await api('/api/settings',{activeKey:i+1});render()});}
async function usage(){const u=await api('/api/usage');$('#usage').innerHTML=u.providers.map(p=>{const c=p.percent_used==null?0:p.percent_used;const left=p.limit!=null?Math.max(0,p.limit-(p.used||0))+' '+tr('left'):tr('noq');
return '<div class="prov" style="width:100%"><div class="row"><b>'+esc(p.name)+'</b><span>'+p.keys_ready+'/'+p.keys_total+' '+tr('keysr')+'</span></div><div class="bar '+(c>=90?'b':c>=60?'w':'')+'"><i style="width:'+c+'%"></i></div><div class="row"><span>'+(p.percent_used==null?'—':c+'% '+tr('used'))+'</span><span>'+left+'</span></div></div>'}).join('')+(u.providers.length>1?'<div class="prov" style="width:100%"><div class="row"><b>Total</b><span>'+(u.percent_used==null?'—':u.percent_used+'%')+'</span></div></div>':'')}
const log=$('#log');const bottom=()=>{log.scrollTop=log.scrollHeight};
function addMsg(role,html){const d=document.createElement('div');d.className='msg '+role;d.innerHTML='<div class="who">'+(role==='user'?'You':'Syzer')+'</div><div class="body">'+html+'</div>';log.appendChild(d);bottom();return d.querySelector('.body')}
async function send(text){if(!text.trim())return;addMsg('user',esc(text));$('#inp').value='';$('#send').style.display='none';$('#stop').style.display='';
let body=addMsg('assistant',''),buf='',think=null,tools=null;
const flush=()=>{if(buf){let t=body.querySelector('.t');if(!t){t=document.createElement('div');t.className='t';body.appendChild(t)}t.innerHTML=md(buf);bottom()}};
const newBlock=()=>{buf='';const t=body.querySelector('.t');if(t)t.classList.remove('t')};
try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
const rd=r.body.getReader(),dec=new TextDecoder();let rest='';
for(;;){const {value,done}=await rd.read();if(done)break;rest+=dec.decode(value,{stream:true});const lines=rest.split('\n');rest=lines.pop();
for(const ln of lines){if(!ln)continue;const e=JSON.parse(ln);
if(e.type==='text'){buf+=e.text;if(think){think.remove();think=null}flush()}
else if(e.type==='endText'){newBlock()}
else if(e.type==='thinking'){if(!think){think=document.createElement('div');think.className='think';body.appendChild(think)}think.textContent=(think.textContent+e.text).slice(-300)}
else if(e.type==='tool'){newBlock();const d=document.createElement('div');d.className='tool';d.innerHTML='<b>● '+esc(e.name)+'</b> '+esc(e.summary.slice(0,140));body.appendChild(d);tools=d;bottom()}
else if(e.type==='toolResult'&&tools){const x=document.createElement('div');x.className='res'+(e.ok?'':' bad');x.textContent='⎿ '+e.summary;tools.appendChild(x);if(e.body){const dt=document.createElement('details');dt.innerHTML='<summary>…</summary><pre>'+esc(e.body)+'</pre>';tools.appendChild(dt)}bottom()}
else if(e.type==='warn'){const w=document.createElement('div');w.className='warn';w.textContent='⚠ '+e.text;body.appendChild(w)}
else if(e.type==='confirm'){const c=document.createElement('div');c.className='confirm';c.innerHTML='<b>'+esc(e.kind)+'</b> '+esc(e.summary)+(e.preview?'<pre>'+esc(e.preview)+'</pre>':'')+'<div class="btns"><button class="pri" data-a="yes">'+tr('allow')+'</button><button data-a="no">'+tr('deny')+'</button><button data-a="always">'+tr('always')+'</button><button data-a="rule">'+tr('rule')+'</button></div>';
c.querySelectorAll('button').forEach(b=>b.onclick=async()=>{await api('/api/confirm',{id:e.id,answer:b.dataset.a});c.remove()});body.appendChild(c);bottom()}
else if(e.type==='error'){const x=document.createElement('div');x.className='err';x.textContent='✖ '+e.text;body.appendChild(x)}
else if(e.type==='aborted'){const x=document.createElement('div');x.className='warn';x.textContent='[stopped]';body.appendChild(x)}
else if(e.type==='done'){const m=document.createElement('div');m.className='meta';m.textContent=e.model+' · key '+e.key+' · '+e.tokens+' tok · '+(e.ms/1000).toFixed(1)+'s';body.appendChild(m)}}}
}catch(err){const x=document.createElement('div');x.className='err';x.textContent='✖ '+err.message;body.appendChild(x)}
$('#send').style.display='';$('#stop').style.display='none';usage();ST=await api('/api/state');render()}
$('#f').onsubmit=e=>{e.preventDefault();send($('#inp').value)};
$('#inp').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send($('#inp').value)}};
$('#inp').oninput=e=>{e.target.style.height='auto';e.target.style.height=Math.min(200,e.target.scrollHeight)+'px'};
$('#stop').onclick=()=>api('/api/abort',{});$('#ref').onclick=usage;
$('#clear').onclick=async()=>{ST=await api('/api/clear',{});log.innerHTML='';render()};
for(const [id,key] of [['#provider','provider'],['#model','model'],['#effort','effort'],['#perm','perm'],['#lang','lang']])$(id).onchange=async e=>{const r=await api('/api/settings',{[key]:e.target.value});if(r.error){alert(r.error);return}ST=r;render();if(key==='provider'){await loadModels();usage()}};
$('#addk').onclick=async()=>{const t=$('#newkeys').value;if(!t.trim())return;$('#kmsg').textContent='…';const r=await api('/api/keys/add',{text:t});$('#newkeys').value='';$('#kmsg').textContent='+'+r.added+' / ='+r.exists+' / ✖'+r.invalid;ST=r.state;render();usage()};
(async()=>{ST=await api('/api/state');render();for(const m of ST.messages)addMsg(m.role,m.role==='user'?esc(m.content):md(m.content));await loadModels();usage()})();
</script></body></html>`;

module.exports = { html };
