// Browser-container loopback only, Unix target fixed. Not an Internet proxy.
import http from 'node:http';
http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:3000'){res.writeHead(403);return res.end();}
 const upstream=http.request({socketPath:'/app-ipc/web.sock',path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:3000'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('App starting');});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
}).listen(3000,'127.0.0.1');
