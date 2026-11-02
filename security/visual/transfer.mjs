// Fixed, bounded data operations for the trusted host viewer. Never an arbitrary proxy.
import http from 'node:http';
import fs from 'node:fs';
const socket='/browser-ipc/transfer.sock';
if(fs.existsSync(socket)){if(!fs.lstatSync(socket).isSocket())throw Error('Occupied socket');fs.unlinkSync(socket)}
const ID=/^[A-Za-z0-9_-]{1,100}$/;
let imports=0;
http.createServer({requestTimeout:15000,maxHeaderSize:8192},async(req,res)=>{
 const fail=(code)=>{if(!res.headersSent)res.writeHead(code,{'content-type':'application/json'});res.end('{"error":"Transfer unavailable"}')};
 let path,limit=256*1024,upload=false;
 if(req.method==='GET'&&req.url==='/sessions')path='/api/chats';
 else if(req.method==='GET'&&req.url.startsWith('/export/')&&ID.test(req.url.slice(8))){path='/api/chats/'+req.url.slice(8)+'/markdown';limit=8*1024*1024;}
 else if(req.method==='POST'&&req.url==='/import'){
  if(imports)return fail(429);
  if(!/^multipart\/form-data; boundary=[A-Za-z0-9'()+_,./:=?-]{1,100}$/.test(req.headers['content-type']||''))return fail(400);
  const n=Number(req.headers['content-length']);if(!Number.isSafeInteger(n)||n<1||n>21*1024*1024||req.headers['transfer-encoding'])return fail(413);
  path='/api/graph/import';upload=true;imports++;
 }else return fail(404);
 try{
  const chunks=[];let size=0;
  for await(const b of req){size+=b.length;if(size>21*1024*1024)throw Error('Limit');chunks.push(b)}
  const data=Buffer.concat(chunks);
  const response=await new Promise((resolve,reject)=>{
   const r=http.request({socketPath:'/app-ipc/web.sock',path,method:upload?'POST':'GET',headers:{host:'127.0.0.1:3000',...(upload?{'content-type':req.headers['content-type'],'content-length':data.length}:{})}},s=>{
    const out=[];let count=0;s.on('data',b=>{count+=b.length;if(count>limit)s.destroy(new Error('Limit'));else out.push(b)});
    s.on('error',reject);s.on('end',()=>resolve({status:s.statusCode,bytes:Buffer.concat(out)}));
   });r.on('error',reject);r.setTimeout(180000,()=>r.destroy(new Error('Timeout')));r.end(data);
  });
  // Discard every upstream header, especially cookies, redirects and filenames.
  res.writeHead(response.status,{'content-type':path.endsWith('/markdown')?'text/plain; charset=utf-8':'application/json','content-length':response.bytes.length});res.end(response.bytes);
 }catch{fail(502)}finally{if(upload)imports--;}
}).listen(socket,()=>fs.chmodSync(socket,0o666));
