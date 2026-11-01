import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {startGateway} from './gateway.mjs';
test('private native gateway preserves app transport and rejects boundary crossings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-gateway-')),socket=path.join(dir,'app.sock');const seen=[];
 const app=http.createServer((req,res)=>{seen.push({url:req.url,headers:req.headers,method:req.method});req.resume();
  if(req.url==='/redirect'){res.writeHead(302,{'content-type':'text/plain',location:'https://evil.invalid'});return res.end();}
  if(req.url==='/prefetch-redirect'){res.writeHead(307,{location:'/?_rsc=fixture'});return res.end();}
  if(req.url==='/malformed-redirect'){res.writeHead(302,{location:'http://['});return res.end();}
  if(req.url==='/bad'){res.writeHead(200,{'content-type':'application/x-msdownload'});return res.end('no');}
  if(req.url==='/active-export'){res.writeHead(200,{'content-type':'text/html','content-disposition':'attachment; filename="demo.html"'});return res.end('no');}
  res.writeHead(200,{'content-type':req.url==='/stream'?'text/event-stream':'text/html','set-cookie':'leak=secret','content-security-policy':"default-src *",'access-control-allow-origin':'*'});res.end(req.url==='/stream'?'data: synthetic\n\n':'<!doctype html><p>Original app</p>');
 });await new Promise(r=>app.listen(socket,r));
 const token='a'.repeat(64),host='127.0.0.1:3192',origin='http://'+host;const gateway=await startGateway({token,host,port:0,bind:'127.0.0.1',appSocket:socket});let cookie;
 function request(url='/',method='GET',extra={}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:gateway.address().port,path:url,method,headers:{host,...(cookie?{cookie}:{}),...extra}},s=>{let body='';s.on('data',b=>body+=b);s.on('end',()=>resolve({status:s.statusCode,headers:s.headers,body}))});r.on('error',e=>{e.message=method+' '+url+': '+e.message;reject(e)});r.end();});}
 try{
  assert.equal((await request('/')).status,403);assert.equal(seen.length,0);
  assert.equal((await request('/open')).status,200);
  assert.equal((await request('/_session','POST',{'x-native-key':token,origin:'https://evil.invalid'})).status,403);
  const session=await request('/_session','POST',{'x-native-key':token,origin});assert.equal(session.status,204);cookie=session.headers['set-cookie'][0].split(';')[0];assert.match(session.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);assert(!cookie.includes(token));
  const page=await request('/');assert.equal(page.status,200);assert.match(page.body,/Original app/);assert.match(page.headers['content-security-policy'],/connect-src 'self'/);assert.equal(page.headers['access-control-allow-origin'],undefined);assert.equal(page.headers['set-cookie'],undefined);assert.equal(seen.at(-1).headers.cookie,undefined);
  for(const headers of [{host:'evil.invalid'},{origin:'http://127.0.0.1:3188'},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'cross-site'},{cookie:cookie+'; '+cookie},{cookie:'lh_native='+token}])assert.equal((await request('/','GET',headers)).status,403);
  assert.equal((await request('/api/chat','POST')).status,403);
  assert.equal((await request('/api/chat','POST',{origin,'content-type':'application/json'})).status,200);assert.equal(seen.at(-1).headers.origin,'http://127.0.0.1:3000');
  assert.equal((await request('/stream')).body,'data: synthetic\n\n');
  const redirect=await request('/prefetch-redirect');assert.equal(redirect.status,307);assert.equal(redirect.headers.location,'/?_rsc=fixture');
  assert.equal((await request('/malformed-redirect')).status,403);assert.equal((await request('/')).status,200);
  assert.equal((await request('/redirect')).status,403);assert.equal((await request('/bad')).status,502);assert.equal((await request('/active-export')).status,403);
  for(const route of ['/control','/auth/callback','/devtools/browser','/websockify','/scroll'])assert.equal((await request(route)).status,404);
  assert.equal((await request('/sw.js','GET',{'service-worker':'script'})).status,403);
  assert.equal((await request('/api/graph/import','POST',{origin,'content-length':'999999999'})).status,413);
  await request('/','GET',{'x-view-token':'secret','x-learnharness-desktop':'forged','authorization':'Bearer secret'});assert.equal(seen.at(-1).headers['x-view-token'],undefined);assert.equal(seen.at(-1).headers.authorization,undefined);assert.equal(seen.at(-1).headers['x-learnharness-desktop'],undefined);
 }finally{gateway.closeAllConnections();await new Promise(r=>gateway.close(r));app.closeAllConnections();await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
