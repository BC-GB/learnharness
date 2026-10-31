import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {startEgress} from './egress.mjs';
import {subscriptionTransport} from './subscription-transport.mjs';

test('TLS tunnel verifies certificates, carries only approved hosts, rejects redirects and bounds responses',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'broker-tls-')),key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem'),socketPath=path.join(dir,'tunnel.sock');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=api.openai.com','-addext','subjectAltName=DNS:api.openai.com,DNS:auth.openai.com'],{stdio:'ignore'});
 let receipts=0,redirect=false,oversize=false;
 const provider=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
  receipts++;assert.equal(req.headers.authorization,'Bearer SYNTHETIC_TLS_ONLY');
  if(redirect){res.writeHead(302,{location:'https://evil.invalid/steal'});return res.end()}
  res.writeHead(200,{'content-type':'application/json'});res.end(oversize?'x'.repeat(1100000):'{"models":[]}');
 });
 provider.on('tlsClientError',()=>{});
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 const tunnel=await startEgress({socketPath,lookup:async()=>['1.1.1.1'],connect:()=>net.connect({host:'127.0.0.1',port:provider.address().port})});
 const untrusted=subscriptionTransport(socketPath);
 async function child(expected){
  const script=`import {subscriptionTransport} from ${JSON.stringify(new URL('./subscription-transport.mjs',import.meta.url).href)};const t=subscriptionTransport(${JSON.stringify(socketPath)});try{const r=await t.request('https://api.openai.com/v1/models',{headers:{authorization:'Bearer SYNTHETIC_TLS_ONLY'}});if(${JSON.stringify(expected)}!=='ok'||r.status!==200)process.exitCode=1}catch{if(${JSON.stringify(expected)}==='ok')process.exitCode=2}finally{t.close()}`;
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,NODE_EXTRA_CA_CERTS:cert},stdio:'pipe'});let stderr='';p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('TLS child failed '+code+' '+stderr)))});
 }
 try{
  await assert.rejects(untrusted.request('https://api.openai.com/v1/models'));assert.equal(receipts,0);
  for(const url of ['http://api.openai.com/v1/models','https://evil.invalid/v1/models','https://api.openai.com/v1/files','https://api.openai.com/v1/models?redirect=evil'])await assert.rejects(untrusted.request(url));
  await child('ok');assert.equal(receipts,1);
  redirect=true;await child('denied');assert.equal(receipts,2);
  redirect=false;oversize=true;await child('denied');assert.equal(receipts,3);
 }finally{untrusted.close();await tunnel.close();provider.closeAllConnections();await new Promise(r=>provider.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
