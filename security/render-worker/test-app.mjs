// Disposable app fixture only: synthetic.pdf must be its only course document.
import assert from 'node:assert/strict';import fs from 'node:fs';
import {createFauxCore,fauxAssistantMessage,fauxText,fauxToolCall} from '@earendil-works/pi-ai';
import {pdfInfo,pdfSearch} from '../../src/agent/subagents/pdf-ops.ts';
import {runPdfReaderAgent} from '../../src/agent/subagents/pdf-reader.ts';
assert.deepEqual(fs.readdirSync('/course'),['synthetic.pdf']);
const batches=await Promise.all([1,2,3].map(()=>pdfInfo('/course/synthetic.pdf')));assert.ok(batches.every(x=>x.page_count===3));console.log('PASS serialized concurrent PDF requests');
assert.ok((await pdfSearch('/course/synthetic.pdf','w.ter',{literal:false})).hits.length);
assert.equal((await pdfSearch('/course/synthetic.pdf','w.ter',{literal:true})).hits.length,0);console.log('PASS regex and literal PDF search');
const faux=createFauxCore({tokenSize:{min:64,max:64}});
faux.setResponses([
 fauxAssistantMessage([fauxToolCall('pdf_info',{}, {id:'info'})],{stopReason:'toolUse'}),
 fauxAssistantMessage([fauxToolCall('pdf_extract',{pages:'all'},{id:'extract'})],{stopReason:'toolUse'}),
 fauxAssistantMessage([fauxToolCall('pdf_render',{pages:'2',dpi:100},{id:'render'})],{stopReason:'toolUse'}),
 fauxAssistantMessage([fauxText('The synthetic document covers physics (p. 2). Pages consulted: 1, 2, 3.')])
]);
let calls=0,sawText=false,sawImage=false;
const engine={model:{...faux.getModel(),input:['text','image']},streamFn:(model,context,options)=>{calls++;const raw=JSON.stringify(context);sawText ||= raw.includes('Physics');sawImage ||= raw.includes('"mimeType":"image/png"');return faux.streamSimple(model,context,options)}};
const result=await runPdfReaderAgent({path:'/course/synthetic.pdf',question:'Read the synthetic physics page.'},{engine});
assert.equal(calls,4);assert.ok(sawText&&sawImage);assert.deepEqual(result.pagesRead,[1,2,3]);assert.deepEqual(result.pagesConsulted,[1,2,3]);assert.match(result.brief,/physics/);
console.log('PASS concurrent PDF work, regex/literal search, and original PDF reader with text, page image and citations; mock provider only');
