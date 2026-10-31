import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { startBroker } from './server.mjs';
import { piEngineForSpec, piModels } from '../../src/agent/models.ts';
import { brokerFetch } from '../../src/agent/broker-fetch.ts';
const wait = ms => new Promise(r=>setTimeout(r,ms));
function call(socket, route, method='GET', data, headers={}) {
  return new Promise((resolve,reject)=>{
    const bytes=data===undefined?null:Buffer.from(typeof data==='string'?data:JSON.stringify(data));
    const req=http.request({agent:false,socketPath:socket,path:route,method,headers:{...(bytes?{'content-type':'application/json','content-length':bytes.length}:{}),...headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,json:()=>JSON.parse(text)}));res.on('error',reject)});
    req.on('error',reject);req.end(bytes);
  });
}
const app='/broker/request.sock',ctrl='/tmp/broker-control/admin.sock';
const payload={model:'gpt-4.1',input:'SYNTHETIC_LESSON',store:false,stream:true};
function events(){
 const item={type:'message',id:'msg_mock',role:'assistant',status:'completed',content:[{type:'output_text',text:'Random assignment separates treatment from selection.',annotations:[]}]};
 return [{type:'response.created',response:{id:'resp_mock'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:item.content[0].text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_mock',status:'completed',output:[item],usage:{input_tokens:4,output_tokens:8,total_tokens:12}}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('');
}
let receipts=[],redirect=false;
const mock=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{receipts.push({body,headers:req.headers,url:req.url});if(redirect){res.writeHead(302,{location:'http://127.0.0.1:1/stolen'});return res.end()};res.writeHead(200,{'content-type':'text/event-stream','set-cookie':'never-forward-this=1'});res.end(events())})});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const opts={requestSocket:app,controlSocket:ctrl,stateDir:'/tmp/broker-ledger',mode:'mock',mockHost:'127.0.0.1',mockPort:mock.address().port,approvalMs:2000,responseMs:2000};
let broker=await startBroker(opts);
async function pending(){for(let n=0;n<100;n++){const list=(await call(ctrl,'/pending')).json();if(list.length)return list[0];await wait(10)}throw Error('No pending request');}
async function approve(j){return call(ctrl,`/requests/${j.id}`,'POST',{action:'approve',sha256:j.sha256});}
try {
 await test('actual model factory + SDK streams only after separate exact-payload approval',async()=>{
  process.env.LH_BROKER_MODE='1';
  const model=piModels().getModels('openai').find(m=>m.api==='openai-responses');assert.ok(model);
  const engine=piEngineForSpec({provider:'openai',id:model.id,thinkingLevel:'off'});
  let bypass=0;const stream=engine.streamFn(engine.model,{systemPrompt:'Synthetic econometrics lesson',messages:[{role:'user',content:'Explain random assignment',timestamp:1}]},{fetch:async()=>{bypass++;throw Error('bypass')},apiKey:'SHOULD_NOT_LEAVE_APP'});
  const result=(async()=>{const a=[];for await(const e of stream)a.push(e);return a})();
  const j=await pending();assert.equal(receipts.length,0);
  const review=(await call(ctrl,`/requests/${j.id}`)).json();assert.ok(review.exactUtf8Body.includes('Explain random assignment'));assert.equal(review.sha256,j.sha256);
  assert.equal((await approve(j)).status,200);
  const out=await result;assert.ok(out.some(e=>e.type==='text_delta'));assert.ok(out.some(e=>e.type==='done'));assert.equal(bypass,0);
  assert.equal(receipts[0].body,review.exactUtf8Body);assert.equal(receipts[0].headers.authorization,'Bearer SYNTHETIC_BROKER_ONLY');assert.ok(!JSON.stringify(receipts).includes('SHOULD_NOT_LEAVE_APP'));
  assert.equal((await approve(j)).status,409);
 });
 await test('app socket cannot approve or list pending requests',async()=>{assert.equal((await call(app,'/pending')).status,404);assert.equal((await call(app,'/requests/00000000-0000-0000-0000-000000000000','POST',{})).status,404)});
 await test('changed hash and concurrent approval cannot dispatch twice',async()=>{
  const n=receipts.length, response=call(app,'/v1/responses','POST',payload),j=await pending();
  assert.equal((await call(ctrl,`/requests/${j.id}`,'POST',{action:'approve',sha256:'0'.repeat(64)})).status,409);assert.equal(receipts.length,n);
  const r=await Promise.all([approve(j),approve(j)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);assert.equal((await response).status,200);assert.equal(receipts.length,n+1);
 });
 await test('second model/tool/background request requires fresh approval',async()=>{
  const n=receipts.length,r=call(app,'/v1/responses','POST',{...payload,input:'SECOND_TOOL_RESULT'}),j=await pending();await wait(30);assert.equal(receipts.length,n);
  await call(ctrl,`/requests/${j.id}`,'POST',{action:'reject',sha256:j.sha256});assert.equal((await r).status,403);assert.equal(receipts.length,n);
 });
 await test('expiry fails closed',async()=>{const n=receipts.length;assert.equal((await call(app,'/v1/responses','POST',payload)).status,408);assert.equal(receipts.length,n)});
 await test('redirect and response credentials are not forwarded',async()=>{
  redirect=true;const r=call(app,'/v1/responses','POST',payload),j=await pending();await approve(j);assert.equal((await r).status,502);redirect=false;
 });
 await test('restart does not replay pending approval',async()=>{
  const n=receipts.length,r=call(app,'/v1/responses','POST',payload).catch(e=>{assert.equal(e.code,'ECONNRESET');return {status:503}}),j=await pending();await broker.close();assert.equal((await r).status,503);broker=await startBroker(opts);assert.equal((await approve(j)).status,409);assert.equal(receipts.length,n);assert.deepEqual((await call(ctrl,'/pending')).json(),[]);
 });
 await test('URLs, headers, provider tools, persistence and oversized bodies denied',async()=>{
  assert.equal((await call(app,'/v1/responses?url=https://elsewhere','POST',payload)).status,404);
  assert.equal((await call(app,'/v1/responses','POST',payload,{authorization:'secret'})).status,400);
  for(const data of [{...payload,store:true},{...payload,tools:[{type:'web_search'}]},'x'.repeat(1024*1024+1)])assert.equal((await call(app,'/v1/responses','POST',data)).status,400);
  await assert.rejects(()=>brokerFetch('https://evil.example/v1/responses',{method:'POST',body:'{}'}));
  assert.throws(()=>piEngineForSpec({provider:'anthropic',id:piModels().getModels('anthropic')[0].id}),/only OpenAI/);
 });
 await test('live mode refuses without explicit billing authorization',async()=>{await assert.rejects(()=>startBroker({...opts,mode:'live'}),/not authorized/)});
 await test('completed ledger contains hashes and status, not session bodies',()=>{
  for(const name of fs.readdirSync(opts.stateDir)) {const s=fs.readFileSync(`${opts.stateDir}/${name}`,'utf8');assert.ok(!s.includes('bodyBase64'));assert.ok(!s.includes('SYNTHETIC_LESSON'));}
 });
} finally {await broker.close();await new Promise(r=>mock.close(r));delete process.env.LH_BROKER_MODE;}
