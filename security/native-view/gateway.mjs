// Private loopback web gateway. App and credentials remain in separate containers.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function startGateway({token,host='127.0.0.1:3192',port=8080,bind='0.0.0.0',appSocket='/app-ipc/web.sock'}){
 if(!/^[a-f0-9]{64}$/.test(token)||!/^127\.0\.0\.1:\d{1,5}$/.test(host))throw Error('Invalid gateway configuration');
 const origin='http://'+host,session=crypto.createHmac('sha256',token).update('learnharness-native-session-v1').digest('hex');
 const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const csp="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
 const agent=new http.Agent({keepAlive:true,maxSockets:64});
 const server=http.createServer({maxHeaderSize:32768,requestTimeout:30000},async(req,res)=>{
  const security=()=>{
   res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
   res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
   res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin');
   res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=(), local-network-access=()');
  };security();
  const fail=(code,text)=>{if(!res.headersSent){res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8','Connection':'close'});res.end(text);}else res.destroy();};
  try{
   if(req.headers.host!==host)return fail(403,'Host denied');
   const site=req.headers['sec-fetch-site'];if(site&&!['same-origin','none'].includes(site))return fail(403,'Cross-origin request denied');
   if(req.headers.origin&&req.headers.origin!==origin)return fail(403,'Origin denied');
   if(!req.url.startsWith('/')||req.url.startsWith('//')||/[\\\x00-\x20]/.test(req.url)||/%(?:00|0a|0d|5c)/i.test(req.url))return fail(400,'Invalid path');
   const url=new URL(req.url,origin);
   if(req.method==='GET'&&url.pathname==='/open'){
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><meta charset="utf-8"><title>LearnHarness</title><p id="status">Opening LearnHarness…</p><script src="/open.js" defer></script>');
   }
   if(req.method==='GET'&&req.url==='/open.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return res.end(fs.readFileSync(path.join(root,'open.js')));}
   if(req.method==='POST'&&req.url==='/_session'){
    if(req.headers.origin!==origin||!equal(req.headers['x-native-key'],token)||req.headers['transfer-encoding']||!['0',undefined].includes(req.headers['content-length']))return fail(403,'Private access required');
    res.setHeader('Set-Cookie','lh_native='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000');res.writeHead(204);return res.end();
   }
   const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('lh_native='));
   if(cookies.length!==1||!equal(cookies[0].slice(10),session))return fail(403,'Open LearnHarness using Start-Learning.ps1 to establish private access.');
   if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(req.method))return fail(405,'Method denied');
   if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)return fail(403,'Same-origin request required');
   // No broker, OAuth, device, debugger or general-purpose file/proxy endpoints.
   if(/^\/(?:_session|open(?:\.js)?|control|subscription|auth|devtools|websockify|scroll)(?:\/|$)/.test(url.pathname))return fail(404,'Route unavailable');
   if(req.headers['service-worker']==='script')return fail(403,'Service workers disabled');
   const length=Number(req.headers['content-length']??0);if(!Number.isSafeInteger(length)||length<0||length>28*1024*1024)return fail(413,'Upload too large');
   const headers={host:'127.0.0.1:3000','accept-encoding':'identity'};
   for(const key of ['accept','accept-language','content-type','content-length','range','if-range','rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','next-action','x-learnharness-subscriptions'])if(req.headers[key])headers[key]=req.headers[key];
   if(req.headers.origin)headers.origin='http://127.0.0.1:3000';
   if(site)headers['sec-fetch-site']=site;
   // Never forward gateway/review cookies, capabilities or client desktop secrets.
   const upstream=http.request({agent,socketPath:appSocket,path:req.url,method:req.method,headers},reply=>{
    if(reply.headers.location){
     try{
      const next=new URL(reply.headers.location,'http://127.0.0.1:3000');
      if(next.origin!=='http://127.0.0.1:3000'||! [301,302,303,307,308].includes(reply.statusCode))throw Error('Redirect');
      res.writeHead(reply.statusCode,{'Location':next.pathname+next.search,'Content-Type':'text/plain'});reply.resume();return res.end();
     }catch{reply.destroy();return fail(403,'External or invalid redirect blocked');}
    }
    const type=String(reply.headers['content-type']??'application/octet-stream');
    const allowed=/^(?:text\/(?:html|plain|css|javascript|event-stream|x-component|markdown)|application\/(?:json|javascript|pdf|manifest\+json)|image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)|font\/)/i.test(type);
    if(!allowed&&reply.statusCode!==204&&reply.statusCode!==304){reply.destroy();return fail(502,'Unsupported response type');}
    security();res.setHeader('Content-Type',type);
    for(const key of ['content-range','accept-ranges','vary'])if(reply.headers[key])res.setHeader(key,reply.headers[key]);
    if(reply.headers['content-disposition']){
     // Text/PDF/image exports only; never return executable HTML attachments.
     if(/^text\/html|image\/svg\+xml/i.test(type)){reply.destroy();return fail(403,'Active download blocked');}
     res.setHeader('Content-Disposition',String(reply.headers['content-disposition']));
    }
    // A directly navigated SVG cannot become a same-origin scripting document.
    if(/^image\/svg\+xml/i.test(type))res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
    res.writeHead(reply.statusCode);reply.pipe(res);
   });
   let received=0;req.on('data',chunk=>{received+=chunk.length;if(received>28*1024*1024){upstream.destroy();fail(413,'Upload too large');}});
   upstream.on('error',()=>fail(502,'App unavailable'));upstream.setTimeout(180000,()=>upstream.destroy());
   req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
  }catch{fail(400,'Request rejected');}
 });
 server.on('upgrade',(_req,socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 server.maxConnections=64;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,bind,resolve)});
 server.on('close',()=>agent.destroy());return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await startGateway({token:fs.readFileSync('/view-secret/token','utf8').trim(),host:process.env.LH_NATIVE_HOST??'127.0.0.1:3192'});
