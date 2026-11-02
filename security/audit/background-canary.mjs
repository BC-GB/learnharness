import assert from 'node:assert/strict';
import {transcriptView} from './src/agent/subagents/extraction.ts';
import {serializeForSummary} from './src/core/compaction.ts';
import {providerEventsEnabled} from './src/agent/provider-events.ts';
const messages=[{id:'u',role:'user',content:'USER_PRIVATE_CANARY',timestamp:1},{id:'a',role:'assistant',content:[{type:'text',text:'TEACHER_PROSE_CANARY'},{type:'thinking',thinking:'THINKING_CANARY'}],timestamp:2},{id:'t',role:'toolResult',toolName:'read',toolCallId:'c',content:[{type:'text',text:'COURSE_TOOL_CANARY'}],timestamp:3}];
const graph=transcriptView({id:'audit',title:'TITLE_CANARY',messages});const summary=serializeForSummary(messages);
assert.ok(graph.includes('TITLE_CANARY'));assert.ok(graph.includes('TEACHER_PROSE_CANARY'));for(const x of ['USER_PRIVATE_CANARY','THINKING_CANARY','COURSE_TOOL_CANARY'])assert.ok(!graph.includes(x));
for(const x of ['USER_PRIVATE_CANARY','TEACHER_PROSE_CANARY','COURSE_TOOL_CANARY'])assert.ok(summary.includes(x));assert.ok(!summary.includes('THINKING_CANARY'));
const flags={};for(const value of ['', '0','false','1']){process.env.LH_PROVIDER_EVENTS=value;flags[value||'empty']=providerEventsEnabled();}
console.log(JSON.stringify({passed:true,graphIncludes:['title','teacherProse'],graphExcludes:['userText','thinking','toolResult'],summaryIncludes:['userText','teacherProse','toolResult'],summaryExcludes:['thinking'],debugFlagBehavior:flags}));