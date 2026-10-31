import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSubscription,verifyIdentity,normalizeSubscriptionRequest,ISSUER,RESOURCE} from './subscription.mjs';
import {publicAddress,startEgress} from './egress.mjs';
import net from 'node:net';

const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'}]};
const scopes='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
function signed(claims,head={alg:'RS256',kid:'fixture'}){
 const parts=[head,claims].map(o=>Buffer.from(JSON.stringify(o)).toString('base64url'));
 return parts.join('.')+'.'+crypto.sign('RSA-SHA256',Buffer.from(parts.join('.')),privateKey).toString('base64url');
}
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subscription-'));let clock=Date.now(),nonce='',subject='synthetic-user',granted=scopes,refreshes=0,failRefresh=false,revoked=false;
 const calls=[],policyFile=path.join(dir,'policy.json');
 const claims=()=>({iss:ISSUER,aud:'oaiapp_fixture',sub:subject,nonce,email:'synthetic@example.invalid',iat:Math.floor(clock/1000),exp:Math.floor(clock/1000)+3600});
 const request=async(url,options)=>{
  calls.push({url,method:options.method});
  if(url.endsWith('/.well-known/jwks.json'))return {status:200,value:jwks};
  if(url.endsWith('/.well-known/openid-configuration'))return {status:200,value:{revocation_endpoint:ISSUER+'/api/accounts/oauth/revoke'}};
  if(url.endsWith('/oauth/revoke')){revoked=true;return {status:200,value:null}}
  if(url===RESOURCE+'/models')return {status:200,value:{models:[{slug:'gpt-4',display_name:'Synthetic model',visibility:'list'},{slug:'hidden',visibility:'hide'}]}};
  assert.equal(url,ISSUER+'/api/accounts/oauth/token');
  const form=new URLSearchParams(options.body);
  assert.equal(form.get('client_id'),'oaiapp_fixture');assert.equal(form.get('resource'),RESOURCE);
  if(form.get('grant_type')==='refresh_token'){refreshes++;await new Promise(r=>setTimeout(r,10));if(failRefresh)return {status:401,value:{}};assert.equal(form.get('scope'),null)}
  else{assert.equal(form.get('code'),'fixture-code');assert.ok(form.get('code_verifier'));assert.equal(form.get('redirect_uri'),'http://127.0.0.1:3188/auth/callback')}
  return {status:200,value:{access_token:'fixture-access-'+refreshes,refresh_token:'fixture-refresh-'+refreshes,token_type:'Bearer',expires_in:3600,scope:granted,id_token:signed(claims())}};
 };
 const config={dir,policyFile,request,now:()=>clock};let manager=createSubscription(config);
 const start=(account=null)=>{const result=manager.start('http://127.0.0.1:3188/auth/callback',account),url=new URL(result.url);nonce=url.searchParams.get('nonce');return url};
 const finish=url=>manager.callback({state:url.searchParams.get('state'),code:'fixture-code',client_id:'oaiapp_fixture'});
 const unlock=()=>fs.writeFileSync(policyFile,JSON.stringify({version:1,accountKey:manager.status().accountKey,paidCreditsDisabled:true,evidenceSha256:'a'.repeat(64),verifiedAt:clock,expiresAt:clock+86400000}),{mode:0o600});
 return {get manager(){return manager},start,finish,unlock,calls,dir,claims,advance:ms=>clock+=ms,subject:s=>subject=s,scopes:s=>granted=s,failRefresh:()=>failRefresh=true,get refreshes(){return refreshes},get revoked(){return revoked},reload:()=>manager=createSubscription(config),close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('OAuth registers with PKCE, validates signed identity, persists privately; sign-in alone cannot spend',async()=>{
 const f=fixture();try{
  const u=f.start();assert.equal(u.origin,ISSUER);assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.ok(u.searchParams.get('ext_agent_host_id'));
  const s=await f.finish(u);assert.equal(s.signedIn,true);assert.equal(s.spendingLocked,true);assert.ok(!JSON.stringify(s).includes('fixture-access'));assert.ok(!JSON.stringify(s).includes('fixture-refresh'));
  await assert.rejects(f.manager.authorize('gpt-4'),/Spending locked/);
  assert.equal(fs.statSync(path.join(f.dir,'accounts.json')).mode&0o077,0);
  f.reload();assert.equal(f.manager.status().signedIn,true);assert.equal(f.manager.status().spendingLocked,true);
  f.unlock();assert.equal(await f.manager.authorize('gpt-4'),'fixture-access-0');await assert.rejects(f.manager.authorize('hidden'),/Model unavailable/);
  const returning=f.start(s.active);assert.equal(returning.searchParams.get('client_id'),'oaiapp_fixture');assert.equal(returning.searchParams.has('agent_name_hint'),false);assert.equal(returning.searchParams.has('id_token_hint'),false);
  await assert.rejects(f.manager.authorize('gpt-4'),/Spending locked/);
  f.advance(1);await f.finish(returning);assert.equal(f.manager.status().spendingLocked,true,'A fresh sign-in must invalidate older spending verification');
 }finally{f.close()}
});
test('wrong state, replay, callback client replacement, identity replacement and missing permission fail closed',async()=>{
 const f=fixture();try{
  let u=f.start();await assert.rejects(f.manager.callback({state:'wrong',code:'fixture-code',client_id:'oaiapp_fixture'}));assert.equal(f.calls.length,0);await assert.rejects(f.finish(u));
  u=f.start();const s=await f.finish(u);await assert.rejects(f.finish(u));
  u=f.start(s.active);await assert.rejects(f.manager.callback({state:u.searchParams.get('state'),code:'fixture-code',client_id:'oaiapp_other'}));
  u=f.start(s.active);f.subject('different-user');await assert.rejects(f.finish(u),/identity changed/);assert.equal(f.manager.status().active,s.active);
  f.subject('synthetic-user');f.scopes('openid email');u=f.start(s.active);await f.finish(u);assert.equal(f.manager.status().planPermission,false);f.unlock();await assert.rejects(f.manager.authorize('gpt-4'),/sign-in required/);
 }finally{f.close()}
});
test('identity validation rejects bad signature, issuer, audience, nonce, expiry, missing iat and unsafe algorithm',()=>{
 const now=Date.now(),claims={iss:ISSUER,aud:'oaiapp_fixture',sub:'test',nonce:'nonce',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600};
 assert.equal(verifyIdentity(signed(claims),jwks,'oaiapp_fixture','nonce').sub,'test');
 for(const change of [{iss:'https://evil.invalid'},{aud:'other'},{nonce:'other'},{exp:0},{iat:undefined},{aud:['oaiapp_fixture','other']}])assert.throws(()=>verifyIdentity(signed({...claims,...change}),jwks,'oaiapp_fixture','nonce'));
 assert.throws(()=>verifyIdentity(signed(claims,{alg:'none',kid:'fixture'}),jwks,'oaiapp_fixture','nonce'));
 const jwt=signed(claims).split('.');jwt[1]=Buffer.from(JSON.stringify({...claims,sub:'forged'})).toString('base64url');assert.throws(()=>verifyIdentity(jwt.join('.'),jwks,'oaiapp_fixture','nonce'));
});
test('refresh is serialized, rotates tokens, and invalid grant removes local credentials without paid fallback',async()=>{
 const f=fixture();try{
  await f.finish(f.start());f.unlock();f.advance(3550000);
  assert.deepEqual(await Promise.all([f.manager.authorize('gpt-4'),f.manager.authorize('gpt-4')]),['fixture-access-1','fixture-access-1']);assert.equal(f.refreshes,1);
  f.advance(3550000);f.failRefresh();await assert.rejects(f.manager.authorize('gpt-4'));assert.equal(f.manager.status().signedIn,false);
  assert.ok(f.calls.every(c=>c.url.startsWith(ISSUER+'/')||c.url===RESOURCE+'/models'));
 }finally{f.close()}
});
test('spending verification is account-bound and expires; logout revokes and preserves registration',async()=>{
 const f=fixture();try{
  const s=await f.finish(f.start());f.unlock();f.advance(86400001);await assert.rejects(f.manager.authorize('gpt-4'),/Spending locked/);
  const result=await f.manager.logout();assert.equal(result.revoked,true);assert.equal(f.revoked,true);assert.equal(result.signedIn,false);assert.equal(result.active,s.active);assert.equal(result.accounts.length,1);
  const saved=fs.readFileSync(path.join(f.dir,'accounts.json'),'utf8');assert.ok(!saved.includes('fixture-access'));assert.ok(!saved.includes('fixture-refresh'));
 }finally{f.close()}
});
test('subscription normalization precedes review, removes unsupported options and namespaces local tools',()=>{
 const v=normalizeSubscriptionRequest({model:'gpt-4',input:[{role:'system',content:'rules'},{role:'user',content:'lesson'}],stream:true,store:false,temperature:1,max_output_tokens:123,metadata:{private:'unused'},tools:[{type:'function',name:'read_course',parameters:{}}]});
 assert.equal(v.input[0].role,'developer');assert.equal(v.temperature,undefined);assert.equal(v.max_output_tokens,undefined);assert.equal(v.metadata,undefined);assert.equal(v.tools[0].type,'namespace');assert.equal(v.tools[0].tools[0].name,'read_course');
 assert.throws(()=>normalizeSubscriptionRequest({...v,input:'text'}));assert.throws(()=>normalizeSubscriptionRequest({...v,tools:[{type:'web_search'}]}));
});
test('egress denies other hosts, private/metadata/loopback DNS results and non-IPv4 destinations',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','100.100.100.200','::1','::ffff:1.1.1.1','224.0.0.1'])assert.equal(publicAddress(ip),false);
 assert.equal(publicAddress('1.1.1.1'),true);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'egress-')),socketPath=path.join(dir,'tunnel.sock');let connects=0;
 const server=await startEgress({socketPath,lookup:async()=>['127.0.0.1'],connect:()=>{connects++;throw Error('Must not connect')}});
 try{
  for(const host of ['evil.invalid','api.openai.com','auth.openai.com'])await new Promise((resolve,reject)=>{const c=net.connect(socketPath);c.on('connect',()=>c.write(host+'\n'));c.on('error',reject);c.on('close',resolve)});
  assert.equal(connects,0);
 }finally{await server.close();fs.rmSync(dir,{recursive:true,force:true})}
});
