import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { startBroker } from './server.mjs';
const payload={model:'synthetic',input:'fixture',store:false,stream:true};
const call=(socket,route,body)=>new Promise((resolve,reject)=>{
 const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 const request=http.request({agent:false,socketPath:socket,path:route,method:bytes?'POST':'GET',headers:bytes?{'content-type':'application/json','content-length':bytes.length}:{}},response=>{
  let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,text}));response.on('error',reject);
 });request.on('error',reject);request.end(bytes);
});
const fixture=(directory,count)=>{
 fs.mkdirSync(directory,{recursive:true});const ids=[];
 for(let i=0;i<count;i++){const id=crypto.randomUUID();ids.push(id);fs.writeFileSync(path.join(directory,id+'.json'),JSON.stringify({id,sha256:'0'.repeat(64),status:'closed-on-restart'}));}
 return ids;
};
const jsonFiles=directory=>fs.readdirSync(directory).filter(name=>name.endsWith('.json'));
test('full legacy ledger and more than 1024 new requests archive history without lifetime quota or replay',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-'));const stateDir=path.join(dir,'state');const ids=fixture(stateDir,1024);let receipts=0;
 const upstream=http.createServer((request,response)=>{request.resume();request.on('end',()=>{receipts++;response.writeHead(200,{'content-type':'text/event-stream'});response.end('data: {"type":"response.completed"}\n\n');});});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const opts={requestSocket:dir+'/request',controlSocket:dir+'/control',stateDir,mode:'mock',requireReview:false,mockHost:'127.0.0.1',mockPort:upstream.address().port};let broker;
 try{
  broker=await startBroker(opts);
  for(let i=0;i<1025;i++)assert.equal((await call(opts.requestSocket,'/v1/responses',payload)).status,200);
  assert.equal(receipts,1025);assert.equal(jsonFiles(stateDir).length,1024);assert.equal(jsonFiles(stateDir+'/archive').length,1025);
  for(const id of ids)assert.ok(fs.existsSync(path.join(stateDir,id+'.json'))||fs.existsSync(path.join(stateDir,'archive',id+'.json')));
  assert.equal((await call(opts.controlSocket,'/requests/'+ids[0],{action:'approve',sha256:'0'.repeat(64)})).status,409);
  await broker.close();broker=await startBroker(opts);assert.equal(receipts,1025);
  assert.deepEqual(JSON.parse((await call(opts.controlSocket,'/pending')).text),[]);
  assert.equal((await call(opts.requestSocket,'/v1/responses',payload)).status,200);assert.equal(receipts,1026);
  assert.equal(jsonFiles(stateDir).length,1024);assert.equal(jsonFiles(stateDir+'/archive').length,1026);
  for(const directory of [stateDir,stateDir+'/archive'])for(const file of jsonFiles(directory))assert.ok(!fs.readFileSync(path.join(directory,file),'utf8').includes('bodyBase64'));
 }finally{if(broker)await broker.close();await new Promise(resolve=>upstream.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('terminal history does not consume the 16 pending slots; pending records are never archived',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pending-'));const stateDir=dir+'/state';fixture(stateDir,1024);
 const opts={requestSocket:dir+'/request',controlSocket:dir+'/control',stateDir,mode:'mock',approvalMs:10000};const broker=await startBroker(opts);const responses=[];
 try{
  for(let i=0;i<16;i++)responses.push(call(opts.requestSocket,'/v1/responses',payload));
  let pending=[];for(let i=0;i<100;i++){pending=JSON.parse((await call(opts.controlSocket,'/pending')).text);if(pending.length===16)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(pending.length,16);const rejected=await call(opts.requestSocket,'/v1/responses',payload);assert.equal(rejected.status,429);assert.equal(JSON.parse(rejected.text).code,'BROKER_ACTIVE_CAPACITY');
  assert.equal(jsonFiles(stateDir).length,1040);
  for(const job of pending){assert.ok(fs.readFileSync(path.join(stateDir,job.id+'.json'),'utf8').includes('bodyBase64'));assert.equal((await call(opts.controlSocket,'/requests/'+job.id,{action:'reject',sha256:job.sha256})).status,200);}
  assert.ok((await Promise.all(responses)).every(response=>response.status===403));assert.equal(jsonFiles(stateDir).length,1024);assert.equal(jsonFiles(stateDir+'/archive').length,16);
 }finally{await broker.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('interrupted archive move preserves audit bytes and never replays; conflict fails closed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-'));const stateDir=dir+'/state';const [id]=fixture(stateDir,1);fs.mkdirSync(stateDir+'/archive');fs.linkSync(stateDir+'/'+id+'.json',stateDir+'/archive/'+id+'.json');
 const opts={requestSocket:dir+'/request',controlSocket:dir+'/control',stateDir};let broker;
 try{
  const before=fs.readFileSync(stateDir+'/archive/'+id+'.json');broker=await startBroker(opts);assert.ok(!fs.existsSync(stateDir+'/'+id+'.json'));assert.deepEqual(fs.readFileSync(stateDir+'/archive/'+id+'.json'),before);await broker.close();broker=null;
  fs.writeFileSync(stateDir+'/'+id+'.json','{"status":"different"}');await assert.rejects(startBroker(opts),/Conflicting archived/);assert.deepEqual(fs.readFileSync(stateDir+'/archive/'+id+'.json'),before);
 }finally{if(broker)await broker.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('archive creation is parent-synced before link and source removal',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-sync-'));const stateDir=dir+'/state';fixture(stateDir,1025);
 const archiveDir=stateDir+'/archive';const events=[];const descriptors=new Map();let broker;
 const original=Object.fromEntries(['mkdirSync','openSync','fsyncSync','closeSync','linkSync','unlinkSync'].map(key=>[key,fs[key]]));
 fs.mkdirSync=(target,...args)=>{const result=original.mkdirSync(target,...args);if(target===archiveDir)events.push('mkdir');return result;};
 fs.openSync=(target,...args)=>{const fd=original.openSync(target,...args);descriptors.set(fd,target);return fd;};
 fs.fsyncSync=fd=>{const result=original.fsyncSync(fd);const target=descriptors.get(fd);if(target===stateDir)events.push('sync-parent');if(target===archiveDir)events.push('sync-archive');return result;};
 fs.closeSync=fd=>{descriptors.delete(fd);return original.closeSync(fd);};
 fs.linkSync=(source,destination)=>{const result=original.linkSync(source,destination);if(path.dirname(destination)===archiveDir)events.push('link');return result;};
 fs.unlinkSync=target=>{const result=original.unlinkSync(target);if(path.dirname(target)===stateDir&&target.endsWith('.json'))events.push('unlink');return result;};
 try{
  broker=await startBroker({requestSocket:dir+'/request',controlSocket:dir+'/control',stateDir});
  const start=events.indexOf('mkdir');assert.notEqual(start,-1);
  assert.deepEqual(events.slice(start,start+6),['mkdir','sync-parent','link','sync-archive','unlink','sync-parent']);
 }finally{for(const [key,value]of Object.entries(original))fs[key]=value;if(broker)await broker.close();fs.rmSync(dir,{recursive:true,force:true});}
});
