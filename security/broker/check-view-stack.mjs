import fs from 'node:fs';
import assert from 'node:assert/strict';
const expectedHost=process.env.LH_VIEW_HOST??'127.0.0.1:3188';
const token=fs.readFileSync('/view-secret/token','utf8').trim();
async function api(route,body,expected=200){const r=await fetch('http://127.0.0.1:8080'+route,{method:'POST',headers:{host:expectedHost,origin:'http://'+expectedHost,'x-view-token':token,'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.equal(r.status,expected,JSON.stringify(j));return j}
let models,lastError;
for(let i=0;i<100;i++){try{models=await api('/app',{op:'models'});break}catch(e){lastError=e;await new Promise(r=>setTimeout(r,100))}}
assert.ok(models?.length,lastError?.message);
if(process.argv[2]){const chat=await api('/app',{op:'chat',id:process.argv[2]});assert.ok(JSON.stringify(chat.messages).includes('Synthetic lesson:'));console.log(JSON.stringify({restartPersistence:true}));process.exit(0)}
const unauth=await fetch('http://127.0.0.1:8080/app',{method:'POST',headers:{host:expectedHost,'content-type':'application/json'},body:'{"op":"chats"}'});assert.equal(unauth.status,403);
const page=await fetch('http://127.0.0.1:8080/',{headers:{host:expectedHost}});assert.match(page.headers.get('content-security-policy'),/frame-src 'none'/);
const chat=await api('/app',{op:'create',model:models[0].id,title:'SYNTHETIC_BROKER_INTEGRATION'});
const ack=await api('/app',{op:'send',id:chat.id,text:'SYNTHETIC_BROKER_INTEGRATION Explain random assignment.'});assert.equal(ack.status,200);
let job;
for(let i=0;i<100;i++){const jobs=await api('/control',{op:'list'});if(jobs.length){job=jobs[0];break}await new Promise(r=>setTimeout(r,100))}
assert.ok(job);const review=await api('/control',{op:'show',id:job.id});assert.equal(review.destination,'isolated mock provider');assert.ok(review.exactUtf8Body.includes('SYNTHETIC_BROKER_INTEGRATION'));
await api('/control',{op:'approve',id:job.id,sha256:'0'.repeat(64)},409);
await api('/control',{op:'approve',id:job.id,sha256:job.sha256});
await api('/control',{op:'approve',id:job.id,sha256:job.sha256},409);
let saved;
for(let i=0;i<100;i++){saved=await api('/app',{op:'chat',id:chat.id});if(JSON.stringify(saved.messages).includes('Synthetic lesson:'))break;await new Promise(r=>setTimeout(r,100))}
assert.ok(JSON.stringify(saved.messages).includes('Synthetic lesson:'));
console.log(JSON.stringify({chatId:chat.id,privateView:true,approvedExactRequest:true,normalChatSaved:true,realProviderCalls:0}));
