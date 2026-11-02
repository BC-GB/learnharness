'use strict';
// Trusted browser code. App/provider strings are used only as text, never markup.
(()=>{
 const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
 // Returning to the private link in this tab is a fragment navigation, not a new document.
 globalThis.addEventListener?.('hashchange',()=>{if(location.hash)location.reload()});
 const $=id=>document.getElementById(id);let chat='',reviewed=null;
 let accountSignature='',activeId=null,refreshing=null;
 const status=s=>{$('status').textContent=s};
 const action=fn=>async()=>{try{await fn()}catch(e){status(e.message)}};
 async function api(route,data){const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-view-token':token},body:JSON.stringify(data)});const j=await r.json();if(!r.ok){const error=Error(j.error??'Request failed');error.status=r.status;throw error}return j}
 function options(id,items,value,label,selected){const e=$(id),old=selected??e.value;e.replaceChildren();for(const item of items){const o=document.createElement('option');o.value=String(value(item));o.textContent=String(label(item));e.append(o)}if([...e.options].some(o=>o.value===old))e.value=old;else if(selected!==undefined)e.selectedIndex=-1}
 function clearReview(){reviewed=null;$('checked').checked=false;$('approve').disabled=true;$('reject').disabled=true;$('payload').textContent='';$('destination').textContent=''}
 function refresh(force=false){if(force&&refreshing)return refreshing.catch(()=>{}).then(()=>refresh());if(!refreshing)refreshing=refreshState().finally(()=>{refreshing=null});return refreshing}
 async function refreshState(){
  await accountRefresh();
  const chats=await api('/app',{op:'chats'});options('chats',chats,c=>c.id,c=>c.title,chat);
  const pending=await api('/control',{op:'list'});options('pending',pending,j=>j.id,j=>`${j.id} — ${j.bytes} bytes`);
  if(reviewed&&!pending.some(j=>j.id===reviewed.id))clearReview();
  if(chat){const selected=chat;const c=await api('/app',{op:'chat',id:selected});if(selected!==chat)return;$('lesson').textContent=(c?.messages??[]).map(m=>`${m.role}: ${typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'):'[Unsupported content]'}`).join('\n\n')}
 }
 async function accountRefresh(){
  const s=await api('/subscription',{op:'status'});
  $('account-section').hidden=s.mode!=='subscription';
  if(s.mode!=='subscription')return;
  options('accounts',[{id:'',email:'Add account'},...s.accounts],a=>a.id,a=>a.email?`${a.email}${a.clientId?' — '+a.clientId:''}`:a.id);
  if(s.active!==activeId){$('accounts').value=s.active??'';activeId=s.active;$('authorize-link').hidden=true;$('authorize-link').removeAttribute('href')}
  const active=s.accounts.find(a=>a.id===s.active);
  $('account-status').textContent=s.signedIn?(s.planPermission?`Signed in with ChatGPT plan permission. Active account: ${active?.email??active?.clientId??''}.`:'Signed in; ChatGPT plan permission was not granted.'):'Sign-in required.';
  $('spending-status').textContent=s.spendingLocked?'Inference locked: spending settings need confirmation.':'Using ChatGPT plan. Spending settings are confirmed for this session; every outgoing request still needs approval.';
  if(!s.signedIn||!s.planPermission||s.spendingLocked)$('send').disabled=true;
  const signature=JSON.stringify([s.active,s.signedIn,s.planPermission]);
  if(signature!==accountSignature){
   const local=await api('/app',{op:'models'}),available=s.signedIn&&s.planPermission?await api('/subscription',{op:'models'}):[];
   const supported=available.filter(m=>local.some(l=>l.id===m.id));
   options('models',supported,m=>m.id,m=>m.name);$('create').disabled=!supported.length;
   accountSignature=s.signedIn&&s.planPermission&&!supported.length?'':signature;
  }
  $('send').disabled=!s.signedIn||!s.planPermission||s.spendingLocked||!$('models').options.length;
 }
 $('signin').onclick=action(async()=>{const result=await api('/subscription',{op:'start',account:$('accounts').value||null});const url=new URL(result.url);if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw Error('Sign-in destination rejected');$('authorize-link').href=url.href;$('authorize-link').hidden=false;status('Open the OpenAI sign-in link. Return here after sign-in. No inference is enabled by signing in alone.')});
 $('signout').onclick=action(async()=>{const result=await api('/subscription',{op:'logout'});$('authorize-link').hidden=true;$('authorize-link').removeAttribute('href');accountSignature='';await refresh(true);status(result.revoked?'Disconnected; renewable session revoked.':'Disconnected locally. Remote revocation was not confirmed; disconnect this app in ChatGPT settings.')});
 $('create').onclick=action(async()=>{const c=await api('/app',{op:'create',model:$('models').value,title:'New lesson'});chat=c.id;await refresh(true);status('Lesson ready')});
 $('chats').onchange=action(async()=>{chat=$('chats').value;await refresh(true)});
 $('send').onclick=action(async()=>{if(!chat)throw Error('Create or select a lesson');const r=await api('/app',{op:'send',id:chat,text:$('message').value});if(r.status!==200)throw Error(JSON.stringify(r.result));$('message').value='';status('Turn submitted. Review each outgoing request below.');await refresh(true)});
 $('pending').onchange=clearReview;
 $('review').onclick=action(async()=>{const id=$('pending').value;clearReview();const j=await api('/control',{op:'show',id});if($('pending').value!==id)return;reviewed=j;$('destination').textContent=`Destination: ${j.destination}\nSHA-256: ${j.sha256}`;$('payload').textContent=j.exactUtf8Body;$('reject').disabled=false});
 $('checked').onchange=()=>{$('approve').disabled=!reviewed||!$('checked').checked};
 for(const act of ['approve','reject'])$(act).onclick=action(async()=>{if(!reviewed)throw Error('Review a request first');const j=reviewed;clearReview();await api('/control',{op:act,id:j.id,sha256:j.sha256});status(`Request ${act==='approve'?'approved once':'rejected'}`);await refresh(true)});
 async function initialize(){try{const models=await api('/app',{op:'models'});options('models',models,m=>m.id,m=>m.name);await refresh(true);status('Connected. Provider requests require separate approval.');setInterval(()=>refresh().catch(e=>status(e.message)),2000)}catch(e){status(e.message);if(e.status===undefined||e.status>=500)setTimeout(initialize,1000)}}
 initialize();
})();
