'use strict';
// Trusted browser code. App/provider strings are used only as text, never markup.
(()=>{
 const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
 const $=id=>document.getElementById(id);let chat='',reviewed=null;
 const status=s=>{$('status').textContent=s};
 async function api(route,data){const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-view-token':token},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error??'Request failed');return j}
 function options(id,items,value,label){const e=$(id),old=e.value;e.replaceChildren();for(const item of items){const o=document.createElement('option');o.value=String(value(item));o.textContent=String(label(item));e.append(o)}if([...e.options].some(o=>o.value===old))e.value=old}
 function clearReview(){reviewed=null;$('checked').checked=false;$('approve').disabled=true;$('reject').disabled=true;$('payload').textContent='';$('destination').textContent=''}
 async function refresh(){
  const chats=await api('/app',{op:'chats'});options('chats',chats,c=>c.id,c=>c.title);
  const pending=await api('/control',{op:'list'});options('pending',pending,j=>j.id,j=>`${j.id} — ${j.bytes} bytes`);
  if(reviewed&&!pending.some(j=>j.id===reviewed.id))clearReview();
  if(chat){const c=await api('/app',{op:'chat',id:chat});$('lesson').textContent=(c?.messages??[]).map(m=>`${m.role}: ${typeof m.content==='string'?m.content:JSON.stringify(m.content,null,2)}`).join('\n\n')}
 }
 const action=fn=>async()=>{try{await fn()}catch(e){status(e.message)}};
 $('create').onclick=action(async()=>{const c=await api('/app',{op:'create',model:$('models').value,title:'New lesson'});chat=c.id;await refresh();status('Lesson ready')});
 $('chats').onchange=action(async()=>{chat=$('chats').value;await refresh()});
 $('send').onclick=action(async()=>{if(!chat)throw Error('Create or select a lesson');const r=await api('/app',{op:'send',id:chat,text:$('message').value});if(r.status!==200)throw Error(JSON.stringify(r.result));$('message').value='';status('Turn submitted. Review each outgoing request below.');await refresh()});
 $('pending').onchange=clearReview;
 $('review').onclick=action(async()=>{clearReview();const j=await api('/control',{op:'show',id:$('pending').value});reviewed=j;$('destination').textContent=`Destination: ${j.destination}\nSHA-256: ${j.sha256}`;$('payload').textContent=j.exactUtf8Body;$('reject').disabled=false});
 $('checked').onchange=()=>{$('approve').disabled=!reviewed||!$('checked').checked};
 for(const act of ['approve','reject'])$(act).onclick=action(async()=>{if(!reviewed)throw Error('Review a request first');const j=reviewed;clearReview();await api('/control',{op:act,id:j.id,sha256:j.sha256});status(`Request ${act==='approve'?'approved once':'rejected'}`);await refresh()});
 (async()=>{try{const models=await api('/app',{op:'models'});options('models',models,m=>m.id,m=>m.name);await refresh();status('Connected. Provider requests require separate approval.');setInterval(()=>refresh().catch(e=>status(e.message)),2000)}catch(e){status(e.message)}})();
})();
