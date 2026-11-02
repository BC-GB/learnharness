import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {startView} from './view.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'view-test-')),socket=path.join(dir,'app.sock'),token='a'.repeat(64);
const attack='<img src="https://evil.invalid/steal" onerror="globalThis.compromised=true"><script>steal()</script>';
const ipc=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({value:attack}))});await new Promise(r=>ipc.listen(socket,r));
const view=await startView({token,port:0,host:'127.0.0.1:3188',appSocket:socket,controlSocket:socket});const port=view.address().port;
function request(route,headers={},data){return new Promise((resolve,reject)=>{const body=data===undefined?null:JSON.stringify(data);const r=http.request({agent:false,hostname:'127.0.0.1',port,path:route,method:body?'POST':'GET',headers:{host:'127.0.0.1:3188',...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}))});r.on('error',reject);r.end(body)})}
try{
 await test('view denies missing access token, forged origin and DNS rebinding',async()=>{
  assert.equal((await request('/app',{}, {op:'chats'})).status,403);
  assert.equal((await request('/app',{'x-view-token':token,origin:'https://evil.invalid'},{op:'chats'})).status,403);
  assert.equal((await request('/',{host:'evil.invalid'})).status,403);
 });
 await test('review session survives refresh but retains exact Origin, Host and token checks',async()=>{
  const first=await request('/control',{'x-view-token':token,origin:'http://127.0.0.1:3188'},{op:'list'});
  const set=first.headers['set-cookie'][0];assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);assert.ok(!set.includes(token));assert.ok(!set.includes('Max-Age'));
  const cookie=set.split(';')[0],headers={cookie,origin:'http://127.0.0.1:3188'};
  assert.equal((await request('/control',headers,{op:'list'})).status,200);
  assert.equal((await request('/control',{...headers,origin:'http://127.0.0.1:3189'},{op:'list'})).status,403);
  assert.equal((await request('/control',{...headers,origin:'https://evil.invalid'},{op:'list'})).status,403);
  assert.equal((await request('/control',{...headers,host:'evil.invalid'},{op:'list'})).status,403);
  assert.equal((await request('/control',{...headers,'x-view-token':'wrong'},{op:'list'})).status,403);
  assert.equal((await request('/control',{...headers,cookie:cookie+'; '+cookie},{op:'list'})).status,403);
  assert.equal((await request('/control',{cookie},{op:'list'})).status,403);
 });
 await test('view serves only fixed trusted assets and inert JSON with restrictive browser headers',async()=>{
  const page=await request('/');assert.equal(page.status,200);assert.match(page.headers['content-security-policy'],/script-src 'self'/);assert.match(page.headers['content-security-policy'],/img-src 'none'/);assert.match(page.headers['content-security-policy'],/frame-src 'none'/);assert.equal(page.headers['x-content-type-options'],'nosniff');
  assert.equal((await request('/app-owned-script.js')).status,404);
  const r=await request('/app',{'x-view-token':token,origin:'http://127.0.0.1:3188'},{op:'chats'});assert.equal(r.status,200);assert.equal(r.headers['content-type'],'application/json');assert.equal(JSON.parse(r.text).value,attack);
  assert.equal((await request('/app',{'x-view-token':token,origin:'http://127.0.0.1:3188'},{op:'arbitrary-url',url:'https://evil.invalid'})).status,400);
 });
 await test('actual view script renders malicious app output as text, never executable DOM',async()=>{
  const {document}=parseHTML(fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'));
  // LinkeDOM lacks the native select.value setter; Chromium tests cover the real control.
  for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{
   get(){return [...this.options].find(o=>o.selected)?.value??this.options[0]?.value??''},
   set(value){for(const option of this.options)option.selected=option.value===value}
  });
  const routes=[];const context={document,location:{hash:'#'+token,pathname:'/'},history:{replaceState(){}},setInterval(){},fetch:async(route,options)=>{
   routes.push(route);assert.ok(['/app','/control','/subscription'].includes(route));assert.equal(options.headers['x-view-token'],token);
   const request=JSON.parse(options.body);let value;
   if(request.op==='status')value={mode:'mock'};
   if(request.op==='models')value=[{id:'mock',name:attack}];
   if(request.op==='chats')value=[{id:'chat1',title:attack}];
   if(request.op==='list')value=[];
   if(request.op==='create')value={id:'chat1'};
   if(request.op==='chat')value={messages:[{role:'assistant',content:[{type:'text',text:attack,textSignature:'PRIVATE_METADATA'}]}]};
   return {ok:true,json:async()=>value};
  }};
  vm.runInNewContext(fs.readFileSync(new URL('./client.js',import.meta.url),'utf8'),context);
  await new Promise(r=>setTimeout(r,20));await document.getElementById('create').onclick();
  assert.ok(document.getElementById('lesson').textContent.includes(attack));assert.ok(!document.getElementById('lesson').textContent.includes('PRIVATE_METADATA'));
  assert.equal(document.querySelectorAll('img,iframe,object').length,0);assert.equal(document.querySelectorAll('script').length,1);assert.equal(context.compromised,undefined);assert.ok(routes.length>=4);
 });
 await test('initial transient failures retry reads, but access denial does not retry',async()=>{
  for(const status of [502,403]){
   const {document}=parseHTML(fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'));
   const timers=[],events={};let attempts=0,reloads=0;
   const context={document,location:{hash:'#'+token,pathname:'/',reload(){reloads++}},history:{replaceState(){}},setInterval(){},setTimeout(fn){timers.push(fn)},addEventListener(name,fn){events[name]=fn},fetch:async()=>{attempts++;return {ok:false,status,json:async()=>({error:'fixture failure'})}}};
   vm.runInNewContext(fs.readFileSync(new URL('./client.js',import.meta.url),'utf8'),context);
   await new Promise(r=>setTimeout(r,10));
   assert.equal(attempts,1);assert.equal(timers.length,status===502?1:0);
   context.location.hash='';events.hashchange();assert.equal(reloads,0);
   context.location.hash='#new-private-link';events.hashchange();assert.equal(reloads,1);
  }
 });
}finally{view.closeAllConnections();await new Promise(r=>view.close(r));await new Promise(r=>ipc.close(r))}
