// No credentials, app state or host files. This daemon carries end-to-end TLS.
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const allowed=new Set(['auth.openai.com','api.openai.com']);
const blocked=new net.BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,prefix,'ipv4');
export const publicAddress=ip=>net.isIPv4(ip)&&!blocked.check(ip,'ipv4');
export async function startEgress({socketPath='/egress/tunnel.sock',lookup=host=>dns.resolve4(host),connect=options=>net.connect(options)}={}){
  fs.mkdirSync(path.dirname(socketPath),{recursive:true,mode:0o700});
  if(fs.existsSync(socketPath)){if(!fs.lstatSync(socketPath).isSocket())throw Error('Occupied egress socket');fs.unlinkSync(socketPath)}
  const clients=new Set();
  const server=net.createServer(client=>{
    if(clients.size>=8){client.destroy();return}clients.add(client);let text='',upstream;
    const timer=setTimeout(()=>client.destroy(),180000);
    client.on('error',()=>client.destroy());client.on('close',()=>{clearTimeout(timer);clients.delete(client);upstream?.destroy()});client.setTimeout(10000,()=>client.destroy());
    const hello=async b=>{
      text+=b.toString('ascii');if(text.length>64){client.destroy();return}
      if(!text.endsWith('\n'))return;client.off('data',hello);client.pause();
      const host=text.slice(0,-1);if(!allowed.has(host)){client.destroy();return}
      try{
        const addresses=await lookup(host);
        if(client.destroyed||!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw Error('DNS denied');
        upstream=connect({host:addresses[0],port:443,family:4});
        upstream.setTimeout(10000,()=>upstream.destroy());upstream.on('error',()=>client.destroy());upstream.on('close',()=>client.destroy());
        upstream.once('connect',()=>{if(client.destroyed){upstream.destroy();return}client.setTimeout(0);upstream.setTimeout(0);client.write('OK\n');let sent=0,received=0;client.on('data',b=>{sent+=b.length;if(sent>2*1024*1024)client.destroy()});upstream.on('data',b=>{received+=b.length;if(received>18*1024*1024)client.destroy()});client.pipe(upstream).pipe(client);client.resume()});
      }catch{client.destroy()}
    };client.on('data',hello);
  });server.maxConnections=8;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve)});fs.chmodSync(socketPath,0o600);
  return {close:async()=>{for(const c of clients)c.destroy();await new Promise(r=>server.close(r))}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await startEgress();
