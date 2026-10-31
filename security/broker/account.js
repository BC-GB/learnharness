'use strict';
(()=>{
 const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
 globalThis.addEventListener('hashchange',()=>{if(location.hash)location.reload()});
 const $=id=>document.getElementById(id);
 let activeId=null;
 async function api(data){const r=await fetch('/subscription',{method:'POST',headers:{'content-type':'application/json','x-view-token':token},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error??'Account request failed');return value}
 const action=fn=>async()=>{try{await fn()}catch(e){$('status').textContent=e.message}};
 async function refresh(){
  const s=await api({op:'status'});if(s.mode!=='subscription')throw Error('Subscription setup is not enabled');
  const old=$('accounts').value;$('accounts').replaceChildren();
  for(const a of [{id:'',email:'Add account'},...s.accounts]){const o=document.createElement('option');o.value=a.id;o.textContent=a.email+(a.clientId?' — '+a.clientId:'');$('accounts').append(o)}
  if([...$('accounts').options].some(o=>o.value===old))$('accounts').value=old;
  if(s.active!==activeId){$('accounts').value=s.active??'';activeId=s.active;$('authorize-link').hidden=true;$('authorize-link').removeAttribute('href')}
  const active=s.accounts.find(a=>a.id===s.active);
  $('status').textContent=s.signedIn?(s.planPermission?`Signed in. Active account: ${active?.email??active?.clientId??''}. Your credentials remain in the isolated broker.`:'Signed in, but ChatGPT plan permission was not granted.'):'Sign-in required.';
  $('spending-status').textContent=s.spendingLocked?'Inference remains locked. Paid-credit settings must be verified separately.':'Spending verification is current. The learning app must still pass deployment checks before launch.';
 }
 $('signin').onclick=action(async()=>{const r=await api({op:'start',account:$('accounts').value||null});const u=new URL(r.url);if(u.origin!=='https://auth.openai.com'||u.pathname!=='/api/accounts/authorize')throw Error('Sign-in destination denied');$('authorize-link').href=u.href;$('authorize-link').hidden=false;$('status').textContent='Open the OpenAI sign-in link, then return to this tab.'});
 $('signout').onclick=action(async()=>{const r=await api({op:'logout'});$('authorize-link').hidden=true;$('authorize-link').removeAttribute('href');await refresh();$('status').textContent=r.revoked?'Disconnected; session revoked.':'Disconnected locally. Remote revocation was not confirmed; disconnect the app in ChatGPT settings.'});
 action(refresh)();setInterval(action(refresh),3000);
})();
