import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createModels} from '@earendil-works/pi-ai';
import {openaiProvider} from './node_modules/@earendil-works/pi-ai/dist/providers/openai.js';
import {stream} from './node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js';
import {toLlmMessages} from './src/core/native-messages.ts';
import {APP_IDENTITY} from './src/agent/models.ts';
const markers={system:'AUDIT_SYSTEM',user:'AUDIT_USER',history:'AUDIT_HISTORY',course:'AUDIT_COURSE_RESULT',graph:'AUDIT_GRAPH_CONTEXT',private:'AUDIT_PRIVATE_META',unread:'AUDIT_UNREAD_FILE',env:'AUDIT_UNRELATED_ENV'};
fs.writeFileSync('/tmp/unread-canary.txt',markers.unread);process.env.AUDIT_UNRELATED_ENV=markers.env;
const models=createModels();models.setProvider(openaiProvider());const model=models.getModels('openai').find(m=>m.api==='openai-responses');assert.ok(model);
const messages=toLlmMessages([
 {role:'system',content:markers.system,toolsAdded:[{name:'read',description:'Synthetic read tool',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}],timestamp:0},
 {role:'user',content:markers.history,timestamp:1,id:markers.private},
 {role:'assistant',content:[{type:'toolCall',id:'call_audit',name:'read',arguments:{path:'/course/synthetic.md'}}],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:2},
 {role:'toolResult',toolCallId:'call_audit',toolName:'read',content:[{type:'text',text:markers.course}],isError:false,timestamp:3},
 {role:'custom',customType:'graph-context',content:markers.graph,details:{private:markers.private},timestamp:4},
 {role:'user',content:markers.user,timestamp:5,id:markers.private}
]);
let payload,networkAttempts=0;
const result=stream(model,{systemPrompt:markers.system,messages,tools:[{name:'read',description:'Synthetic read tool',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}]},{apiKey:'sk-synthetic-not-a-real-key',sessionId:'audit-synthetic-chat',identity:APP_IDENTITY,fetch:async()=>{networkAttempts++;throw new Error('NO NETWORK');},onPayload(p){payload=p;throw new Error('AUDIT_STOP_BEFORE_HTTP');}});
for await(const event of result){}
assert.ok(payload);const serialized=JSON.stringify(payload);for(const k of ['system','user','history','course','graph'])assert.ok(serialized.includes(markers[k]),k+' is intended model-visible');for(const k of ['private','unread','env'])assert.ok(!serialized.includes(markers[k]),k+' must not be added');assert.equal(networkAttempts,0);assert.equal(payload.store,false);assert.equal(payload.prompt_cache_key,'audit-synthetic-chat');
console.log(JSON.stringify({passed:true,provider:model.provider,api:model.api,payloadKeys:Object.keys(payload).sort(),sentCanaries:['system','user','history','courseToolResult','graphContext'],absentCanaries:['appOnlyMetadata','unrequestedFile','unrelatedEnv'],store:payload.store,cacheKeyIsSessionId:true,networkAttempts}));