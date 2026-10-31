import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { piModels, piEngineForSpec } from '../../src/agent/models.ts';
assert.deepEqual(Object.keys(os.networkInterfaces()),['lo']);
for(const p of ['/control/admin.sock','/run/secrets/openai-key','/var/run/docker.sock'])assert.equal(fs.existsSync(p),false,p);
assert.throws(()=>fs.writeFileSync('/broker/forged-approval','bad'));
const model=piModels().getModels('openai').find(m=>m.api==='openai-responses');
const engine=piEngineForSpec({provider:'openai',id:model.id,thinkingLevel:'off'});
for(let turn=0;turn<2;turn++){
 let text='',done=false;
 for await(const event of engine.streamFn(engine.model,{systemPrompt:'SYNTHETIC_BROKER_INTEGRATION',messages:[{role:'user',content:`Explain random assignment, synthetic turn ${turn}`,timestamp:1}]},{})){
  if(event.type==='text_delta')text+=event.delta;
  if(event.type==='done')done=true;
  if(event.type==='error')throw Error(JSON.stringify(event));
 }
 assert.ok(done);assert.match(text,/random assignment/);console.log(JSON.stringify({turn,streamedLesson:true,appHasNoNetwork:true,appCannotApprove:true}));
}
const { chatStore } = await import('../../src/store/chats.ts');
const { handleChatRequest } = await import('../../src/server/chat-handler.ts');
const { runningTurn } = await import('../../src/server/turn-runs.ts');
const chat=chatStore.createChat('SYNTHETIC_BROKER_INTEGRATION');
chatStore.saveSettings(chat.id,{model:{provider:'openai',id:model.id},thinkingLevel:'off'});
const ack=await handleChatRequest(new Request('http://localhost/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chatId:chat.id,input:{type:'text',text:'SYNTHETIC_BROKER_INTEGRATION Explain random assignment.'}})}));
assert.equal(ack.status,200,await ack.text());
const turn=runningTurn(chat.id);assert.ok(turn);await new Response(turn.subscribe()).text();
const saved=chatStore.getChat(chat.id);assert.ok(JSON.stringify(saved.messages).includes('Synthetic lesson: random assignment addresses selection bias.'));
console.log(JSON.stringify({normalChatRoute:true,persistedLesson:true,noAppCredential:true}));
process.exit(0);
