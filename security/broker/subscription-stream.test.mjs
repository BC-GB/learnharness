import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {startBroker} from './server.mjs';
test('subscription accepts omitted stream type but rejects explicit HTML',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stream-type-'));let html=false;const upstream=http.createServer((q,s)=>{q.resume();q.on('end',()=>{if(html)s.setHeader('content-type','text/html');s.end('data: {"type":"response.completed"}\n\n')})});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const requestSocket=dir+'/request',controlSocket=dir+'/control';const b=await startBroker({requestSocket,controlSocket,stateDir:dir+'/state',mode:'subscription',subscription:{status:()=>({signedIn:true,planPermission:true,spendingLocked:false,accountKey:'synthetic'}),authorize:async()=> 'synthetic'},transport:{open:(_url,opts,cb)=>http.request({host:'127.0.0.1',port:upstream.address().port,path:'/',...opts},cb)}});
function call(socket,route,body){return new Promise((resolve,reject)=>{const r=http.request({socketPath:socket,path:route,method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{}},s=>{let text='';s.on('data',x=>text+=x);s.on('end',()=>resolve({status:s.statusCode,text}))});r.on('error',reject);r.end(body?JSON.stringify(body):undefined)})}
try{for(const bad of [false,true]){html=bad;const pending=call(requestSocket,'/v1/responses',{model:'synthetic',input:[],store:false,stream:true});let job;for(let i=0;i<30;i++){job=JSON.parse((await call(controlSocket,'/pending')).text)[0];if(job)break;await new Promise(r=>setTimeout(r,10))}assert.ok(job);await call(controlSocket,'/requests/'+job.id,{action:'approve',sha256:job.sha256});const out=await pending;assert.equal(out.status,bad?502:200);if(!bad)assert.match(out.text,/response.completed/);}}finally{await b.close();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true})}});

test('subscription policy change while credentials resolve prevents dispatch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-race-'));
  for (const change of [{spendingLocked:true},{signedIn:false},{planPermission:false}]) {
    let state = {signedIn:true, planPermission:true, spendingLocked:false, accountKey:'synthetic'};
    let upstreamCalls = 0;
    const requestSocket=dir+'/request', controlSocket=dir+'/control';
    const broker = await startBroker({requestSocket,controlSocket,stateDir:dir+'/state',mode:'subscription',
      subscription:{status:()=>({...state}),authorize:async()=>{await new Promise(r=>setTimeout(r,5));state={...state,...change};return 'synthetic';}},
      transport:{open:()=>{upstreamCalls++;throw Error('Must not dispatch');}}});
    const call=(socket,route,body)=>new Promise((resolve,reject)=>{
      const req=http.request({socketPath:socket,path:route,method:body?'POST':'GET',headers:{'content-type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});
      req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
    });
    try {
      const response=call(requestSocket,'/v1/responses',{model:'synthetic',input:[],store:false,stream:true});
      let job;
      for(let i=0;i<100;i++){job=JSON.parse((await call(controlSocket,'/pending')).text)[0];if(job)break;await new Promise(r=>setTimeout(r,10));}
      assert.ok(job);
      await call(controlSocket,'/requests/'+job.id,{action:'approve',sha256:job.sha256});
      assert.notEqual((await response).status,200);
      assert.equal(upstreamCalls,0);
      assert.deepEqual(JSON.parse((await call(controlSocket,'/pending')).text),[]);
    } finally {await broker.close();}
  }
  fs.rmSync(dir,{recursive:true,force:true});
});
