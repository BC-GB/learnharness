// App-side IPC: no browser assets and no arbitrary proxy route.
import http from 'node:http';
import fs from 'node:fs';
import { chatStore } from '../../src/store/chats.ts';
import { modelCatalog, validateChatSettings } from '../../src/server/model-catalog.ts';
import { handleChatRequest } from '../../src/server/chat-handler.ts';
const socket='/app-ipc/app.sock';
fs.mkdirSync('/app-ipc',{recursive:true});if(fs.existsSync(socket))fs.unlinkSync(socket);
http.createServer({requestTimeout:15000,maxHeaderSize:4096},async(req,res)=>{
 try{
  if(req.method!=='POST'||req.url!=='/rpc')throw Error('Route');
  let text='';for await(const b of req){text+=b;if(text.length>65536)throw Error('Size')}
  const body=JSON.parse(text);let value;
  switch(body.op){
   case 'models':value=modelCatalog().models;break;
   case 'chats':value=chatStore.listChats();break;
   case 'chat':value=chatStore.getChat(body.id);break;
   case 'create':{
    const settings={model:{provider:'openai',id:body.model},thinkingLevel:'off'};
    if(!validateChatSettings(settings).ok)throw Error('Model');
    const chat=chatStore.createChat(String(body.title??'New lesson').slice(0,200));chatStore.saveSettings(chat.id,settings);value={id:chat.id};break;
   }
   case 'send':{
    if(typeof body.text!=='string'||body.text.length>16000)throw Error('Input');
    const response=await handleChatRequest(new Request('http://localhost/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chatId:body.id,input:{type:'text',text:body.text}})}));
    value={status:response.status,result:await response.json()};break;
   }
   default:throw Error('Operation');
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value??null));
 }catch{res.writeHead(400,{'content-type':'application/json'});res.end('{"error":"App request failed"}')}
}).listen(socket,()=>fs.chmodSync(socket,0o666));
