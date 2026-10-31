import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/client.js',['client.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
assets.set('/account.html',['account.html','text/html; charset=utf-8']);assets.set('/account.js',['account.js','text/javascript; charset=utf-8']);
export function socketJson(socketPath,route,method='GET',value){
 return new Promise((resolve,reject)=>{
  const data=value===undefined?null:JSON.stringify(value);
  const req=http.request({agent:false,socketPath,path:route,method,headers:data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}},res=>{
   const parts=[];let size=0;res.on('data',b=>{size+=b.length;if(size>8*1024*1024){res.destroy();return}parts.push(b)});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(parts).toString('utf8'))})}catch{reject(Error('Invalid upstream JSON'))}});
  });req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('IPC timeout')));req.end(data);
 });
}
export async function startView({token,port=8080,bind='127.0.0.1',host='127.0.0.1:3188',appSocket='/app-ipc/app.sock',controlSocket='/control/admin.sock'}){
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('View capability must be 32 random bytes');
 const secret=Buffer.from(token),origin='http://'+host;
 const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000},async(req,res)=>{
  res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=()');
  res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');res.setHeader('referrer-policy','no-referrer');res.setHeader('cache-control','no-store');
  const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
  try{
   if(req.headers.host!==host)return reply(403,{error:'Host denied'});
   if(req.method==='GET'&&req.url.startsWith('/auth/callback?')){
    const url=new URL(req.url,origin),query={};
    for(const key of ['state','code','client_id','error']){if(url.searchParams.getAll(key).length>1)return reply(400,{error:'Duplicate callback parameter'});const value=url.searchParams.get(key);if(value!==null)query[key]=value}
    const result=await socketJson(controlSocket,'/subscription','POST',{op:'callback',query});
    res.writeHead(result.status,{'content-type':'text/html; charset=utf-8'});
    return res.end('<!doctype html><title>LearnHarness sign-in</title><p>'+(result.status===200?'Sign-in finished. Close this tab and return to the restricted LearnHarness interface. Spending remains locked until verified.':'Sign-in failed closed. Return to LearnHarness and start a new sign-in.')+'</p>');
   }
   if(req.method==='GET'&&assets.has(req.url)){const [file,type]=assets.get(req.url);res.writeHead(200,{'content-type':type});return res.end(fs.readFileSync(path.join(root,file)))}
   if(req.method!=='POST'||!['/app','/control','/subscription'].includes(req.url))return reply(404,{error:'Route denied'});
   const supplied=Buffer.from(req.headers['x-view-token']??'');
   if(supplied.length!==secret.length||!crypto.timingSafeEqual(supplied,secret)||req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Private access required'});
   if(req.headers['content-type']!=='application/json')return reply(415,{error:'JSON required'});
   const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>65536)throw Error('Size');chunks.push(b)}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(req.url==='/subscription'){
    if(!['status','start','models','logout'].includes(body.op))return reply(400,{error:'Subscription operation denied'});
    const data={op:body.op};
    if(body.op==='start'){data.redirectUri=origin+'/auth/callback';if(body.account!==null&&body.account!==undefined&&!/^[a-f0-9]{64}$/.test(body.account))return reply(400,{error:'Account denied'});data.account=body.account??null}
    const result=await socketJson(controlSocket,'/subscription','POST',data);return reply(result.status,result.value);
   }
   if(req.url==='/app'){
    if(!['models','chats','chat','create','send'].includes(body.op))return reply(400,{error:'Operation denied'});
    const result=await socketJson(appSocket,'/rpc','POST',body);return reply(result.status,result.value);
   }
   let route='/pending',method='GET',data;
   if(body.op!=='list'){
    if(!/^[a-f0-9-]{36}$/.test(body.id??''))return reply(400,{error:'Request ID'});
    route='/requests/'+body.id;
    if(body.op!=='show'){
     if(!['approve','reject'].includes(body.op)||!/^[a-f0-9]{64}$/.test(body.sha256??''))return reply(400,{error:'Approval denied'});
     method='POST';data={action:body.op,sha256:body.sha256};
    }
   }
   const result=await socketJson(controlSocket,route,method,data);return reply(result.status,result.value);
  }catch(error){console.warn('View request failed:',error?.code??error?.name??'Error');if(!res.headersSent)reply(502,{error:'Request failed closed'});else res.destroy()}
 });server.maxConnections=32;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,bind,resolve)});return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const token=fs.readFileSync('/view-secret/token','utf8').trim();
 await startView({token,bind:'0.0.0.0',host:process.env.LH_VIEW_HOST??'127.0.0.1:3188'});
}
