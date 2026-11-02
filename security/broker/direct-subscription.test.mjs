import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startBroker} from './server.mjs';
const call=(socket,route,body)=>new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):undefined;const q=http.request({socketPath:socket,path:route,method:data?'POST':'GET',headers:data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}},s=>{let text='';s.on('data',b=>text+=b);s.on('end',()=>resolve({status:s.statusCode,text}))});q.on('error',reject);q.end(data)});
test('direct subscription dispatch skips review but retains authorization and no replay',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'direct-'));let receipts=0;
 const upstream=http.createServer((q,s)=>{q.resume();q.on('end',()=>{receipts++;s.writeHead(200,{'content-type':'text/event-stream'});s.end('data: {"type":"response.completed"}\n\n')})});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const requestSocket=dir+'/request',controlSocket=dir+'/control';
 try{
 for(const change of [null,{spendingLocked:true},{signedIn:false},{planPermission:false},{accountKey:'changed'}]){
  let state={signedIn:true,planPermission:true,spendingLocked:false,accountKey:'synthetic'};const before=receipts;
  const opts={requestSocket,controlSocket,stateDir:dir+'/state',mode:'subscription',requireReview:false,subscription:{status:()=>({...state}),authorize:async()=>{await new Promise(r=>setTimeout(r,10));if(change)state={...state,...change};return 'synthetic'}},transport:{open:(_url,opts,cb)=>http.request({host:'127.0.0.1',port:upstream.address().port,...opts},cb)}};
  let broker=await startBroker(opts);
  try{
   const r=await call(requestSocket,'/v1/responses',{model:'synthetic',input:[{role:'user',content:'synthetic lesson'}],store:false,stream:true});
   assert.equal(r.status,change?423:200);assert.equal(receipts-before,change?0:1);assert.deepEqual(JSON.parse((await call(controlSocket,'/pending')).text),[]);
   const bad=await call(requestSocket,'/v1/responses',{model:'synthetic',input:[],store:false,stream:true,tools:[{type:'web_search'}]});assert.equal(bad.status,400);
  }finally{await broker.close()}
  broker=await startBroker(opts);await new Promise(r=>setTimeout(r,20));assert.equal(receipts-before,change?0:1);await broker.close();
 }
 await assert.rejects(startBroker({mode:'live',requireReview:false}),/Invalid review policy/);
 }finally{await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});

