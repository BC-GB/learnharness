import http from 'node:http';import fs from 'node:fs';import {spawn} from 'node:child_process';
const socket='/render-ipc/render.sock';if(fs.existsSync(socket)){if(!fs.lstatSync(socket).isSocket())throw Error('Occupied socket');fs.unlinkSync(socket)}let active=false;
const server=http.createServer({requestTimeout:15000,maxHeaderSize:4096},async(req,res)=>{
 const fail=(status)=>{if(!res.headersSent){res.writeHead(status,{'content-type':'application/json'});res.end('{"error":"Isolated rendering failed"}')}else res.destroy()};
 if(req.method!=='POST'||req.url!=='/render'||req.headers['content-type']!=='application/json')return fail(400);if(active)return fail(429);active=true;
 try{let size=0;const parts=[];for await(const b of req){size+=b.length;if(size>32*1024*1024)throw Error('Limit');parts.push(b)}
 const child=spawn(process.execPath,['--max-old-space-size=384','--import','tsx','/app/security/render-worker/job.mjs'],{detached:true,stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'production'}});
 const kill=()=>{
  // This container runs only this service and its current job. Docker exec
  // clients have PPid 0 and are not descendants of init.
  const rows=[];for(const n of fs.readdirSync('/proc'))if(/^\d+$/.test(n)){try{const t=fs.readFileSync('/proc/'+n+'/status','utf8');rows.push({pid:Number(n),parent:Number(t.match(/^PPid:\s+(\d+)/m)?.[1])})}catch{}}
  const ids=new Set([1]);for(let i=0;i<rows.length;i++)for(const r of rows)if(ids.has(r.parent))ids.add(r.pid);
  for(const pid of ids)if(pid!==1&&pid!==process.pid){try{process.kill(pid,'SIGKILL')}catch{}}
 };
 const timer=setTimeout(kill,20000);const output=[];let count=0;
 res.on('close',kill);child.stdout.on('data',b=>{count+=b.length;if(count>24*1024*1024)kill();else output.push(b)});
 child.on('error',()=>fail(502));child.on('close',code=>{clearTimeout(timer);kill();res.removeListener('close',kill);active=false;if(code!==0)return fail(502);res.writeHead(200,{'content-type':'application/json'});res.end(Buffer.concat(output))});child.stdin.on('error',()=>{});child.stdin.end(Buffer.concat(parts));
 }catch{active=false;fail(400)}
});server.listen(socket,()=>fs.chmodSync(socket,0o666));
