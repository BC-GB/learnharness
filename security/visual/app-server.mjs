// Private Unix-only original Next interface. No host port is published for this server.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import next from 'next';
import '../broker/app-ipc.mjs';
if(process.env.LH_VISUAL_ISOLATED!=='1'||process.env.LH_BROKER_MODE!=='1')throw Error('Isolated broker mode required');
process.env.LH_DESKTOP_API_SECRET=crypto.randomBytes(32).toString('hex');
const socket='/app-ipc/web.sock';
if(fs.existsSync(socket))fs.unlinkSync(socket);
const app=next({dev:false,hostname:'127.0.0.1',port:3000});
await app.prepare();
const handle=app.getRequestHandler();
const server=http.createServer({maxHeaderSize:16384},(req,res)=>{
 if(req.headers.host!=='127.0.0.1:3000'){res.writeHead(403);return res.end();}
 req.headers['x-learnharness-desktop']=process.env.LH_DESKTOP_API_SECRET;
 handle(req,res);
});
server.listen(socket,()=>fs.chmodSync(socket,0o666));
