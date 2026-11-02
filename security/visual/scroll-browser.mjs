import {spawn} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import {createWheelDispatcher,validateWheel} from './scroll-input.mjs';

// Anonymous inherited pipes only. No DevTools TCP port or socket is exposed.
const browser=spawn('chromium',[...process.argv.slice(2),'--remote-debugging-pipe'],{stdio:['ignore','inherit','inherit','pipe','pipe']});
let nextId=1,buffer=Buffer.alloc(0),closing=false;
const calls=new Map(),connections=new Set();
function rpc(method,params={},sessionId){
 if(closing||calls.size>=8)return Promise.reject(Error('Browser unavailable'));
 const id=nextId++;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{calls.delete(id);reject(Error('Browser timeout'));},1000);
  calls.set(id,{resolve,reject,timer});
  browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
 });
}
browser.stdio[4].on('data',chunk=>{
 buffer=Buffer.concat([buffer,chunk]);if(buffer.length>1024*1024)return shutdown(1);
 let i;while((i=buffer.indexOf(0))>=0){
  const part=buffer.subarray(0,i);buffer=buffer.subarray(i+1);
  try{const message=JSON.parse(part.toString());const call=calls.get(message.id);if(!call)continue;
   calls.delete(message.id);clearTimeout(call.timer);
   if(message.error)call.reject(Error('Browser input failed'));else call.resolve(message.result);
  }catch{return shutdown(1);}
 }
});
browser.stdio[3].on('error',()=>shutdown(1));browser.stdio[4].on('error',()=>shutdown(1));browser.on('error',()=>shutdown(1));browser.on('exit',code=>shutdown(code??1));
const dispatch=createWheelDispatcher(rpc);
let active=false,windowStart=performance.now(),requests=0;
const server=net.createServer(socket=>{
 if(connections.size>=4){socket.destroy();return;}connections.add(socket);
 socket.on('error',()=>{});socket.on('close',()=>connections.delete(socket));
 let input='',lastSeq=0,busy=false;
 const reply=q=>{if(socket.writableLength>4096){socket.destroy();return;}socket.write(JSON.stringify(q)+'\n');};
 reply({ready:true});
 socket.on('data',chunk=>{
  input+=chunk.toString('utf8');if(input.length>512){socket.destroy();return;}
  let index;while((index=input.indexOf('\n'))>=0){
   const line=input.slice(0,index);input=input.slice(index+1);
   let q;try{q=validateWheel(JSON.parse(line));if(q.seq<=lastSeq)throw Error('Sequence');}catch{socket.destroy();return;}
   lastSeq=q.seq;
   const now=performance.now();if(now-windowStart>=1000){windowStart=now;requests=0;}
   if(++requests>180||busy){socket.destroy();return;}
   if(active){reply({seq:q.seq,ok:false});continue;}
   active=true;busy=true;
   dispatch(q,()=>!socket.destroyed&&performance.now()-now<=250).then(()=>reply({seq:q.seq,ok:true}),error=>{if(process.env.LH_VISUAL_TEST_DEBUG==='1')console.error('Scroll fixture:',error.message);reply({seq:q.seq,ok:false});}).finally(()=>{active=false;busy=false;});
  }
 });
});
const path='/browser-ipc/scroll.sock';
if(fs.existsSync(path)){if(!fs.lstatSync(path).isSocket())throw Error('Unexpected scroll path');fs.unlinkSync(path);}
server.listen(path,()=>fs.chmodSync(path,0o600));server.on('error',()=>shutdown(1));
function shutdown(code){
 if(closing)return;closing=true;
 for(const c of calls.values()){clearTimeout(c.timer);c.reject(Error('Browser closed'));}calls.clear();
 for(const s of connections)s.destroy();server.close();browser.kill('SIGTERM');
 setTimeout(()=>process.exit(code),250).unref();
}
process.on('SIGTERM',()=>shutdown(0));process.on('SIGINT',()=>shutdown(0));
