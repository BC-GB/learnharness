import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const HOSTS = new Set(['auth.openai.com','api.openai.com']);
export function subscriptionTransport(socketPath='/egress/tunnel.sock') {
  const agent=new https.Agent({keepAlive:false,maxSockets:4});
  agent.createConnection=(options,callback)=>{
    if(!HOSTS.has(options.host))return callback(Error('Destination denied'));
    const socket=net.connect({path:socketPath});let received='';let settled=false;
    const fail=()=>{if(settled)return;settled=true;socket.destroy();callback(Error('Provider tunnel failed'))};
    socket.setTimeout(10000,fail);socket.once('error',fail);socket.once('close',fail);
    socket.once('connect',()=>socket.write(options.host+'\n'));
    const data=b=>{
      received+=b.toString('ascii');
      if(received.length>3)return fail();
      if(received!=='OK\n')return;
      socket.off('data',data);socket.off('error',fail);socket.setTimeout(0);settled=true;
      const secure=tls.connect({socket,servername:options.host,rejectUnauthorized:true,minVersion:'TLSv1.2'});
      let done=false;const end=(error)=>{if(done)return;done=true;clearTimeout(timer);if(error){secure.destroy();callback(Error('Provider TLS failed'))}else callback(null,secure)};
      const timer=setTimeout(()=>end(Error('TLS timeout')),10000);
      secure.once('error',end);secure.once('secureConnect',()=>end());
    };socket.on('data',data);
  };
  function open(url,options,onResponse){
    const u=new URL(url);
    if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.port||u.username||u.password||u.hash||u.search)throw Error('Destination denied');
    if(u.hostname==='api.openai.com'&&!['/v1/models','/v1/responses'].includes(u.pathname))throw Error('API path denied');
    return https.request(u,{...options,agent,headers:{...options.headers},rejectUnauthorized:true},onResponse);
  }
  async function request(url,{method='GET',headers={},body}={}){
    if(body!==undefined&&Buffer.byteLength(body)>65536)throw Error('Authentication body too large');
    return new Promise((resolve,reject)=>{
      const req=open(url,{method,headers:{...headers,...(body!==undefined?{'content-length':Buffer.byteLength(body)}:{})}},res=>{
        if(res.statusCode>=300&&res.statusCode<400){res.destroy();reject(Error('Provider redirect denied'));return}
        const chunks=[];let bytes=0;
        res.on('data',b=>{bytes+=b.length;if(bytes>1024*1024){reject(Error('Provider response too large'));res.destroy();return}chunks.push(b)});
        res.on('aborted',()=>reject(Error('Provider response interrupted')));
        res.on('close',()=>{if(!res.complete)reject(Error('Provider response interrupted'))});
        res.on('error',()=>reject(Error('Provider response interrupted')));
        res.on('end',()=>{try{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,value:text?JSON.parse(text):null})}catch{reject(Error('Provider response invalid'))}});
      });
      const timer=setTimeout(()=>req.destroy(Error('Provider deadline')),15000);
      req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error('Provider connection failed')));req.end(body);
    });
  }
  return {request,open,close:()=>agent.destroy()};
}
