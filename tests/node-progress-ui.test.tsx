import React, { act } from "react";
(globalThis as Record<string, unknown>).React=React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { NodeProgress } from "../components/node-progress.tsx";
import type { PlanTree } from "../src/core/contracts/plan.ts";
import type { ProgressMessage } from "../components/node-progress-core.ts";
const tree:PlanTree={version:1,nodes:[{id:"a",title:"Sampling"},{id:"b",title:"Inference"}],edges:[]};
const messages:ProgressMessage[]=[{id:"group",role:"assistant",parts:[{type:"text",text:"**Sample variation** means differences between samples."},{type:"tool-quiz",input:{nodeId:"a",type:"check"}},{type:"text",text:"**Standard errors** measure uncertainty."},{type:"tool-explain",input:{nodeId:"b",type:"check"}}]}];
test("no fabricated outline before a node or named topic exists",()=>{
 assert.equal(renderToStaticMarkup(<NodeProgress tree={tree} messages={[]}/>),"");
 const unlabelled=[{id:"a",role:"assistant",parts:[{type:"tool-quiz",input:{nodeId:"a"}}]}];
 assert.equal(renderToStaticMarkup(<NodeProgress tree={tree} messages={unlabelled}/>),"");
});
test("only current-node title and topic labels appear, with no navigation or tracking clutter",()=>{
 const markup=renderToStaticMarkup(<NodeProgress tree={tree} messages={messages}/>);
 assert.match(markup,/Inference/);assert.match(markup,/Standard errors/);
 assert.doesNotMatch(markup,/Sample variation|<a\b|<select|Recent checks|reading notes|answered checks|mastery|score|%/i);
 const unsafe={...tree,nodes:[{id:"a",title:"<script>alert(1)</script>"}]};
 assert.doesNotMatch(renderToStaticMarkup(<NodeProgress tree={unsafe} messages={messages.slice(0,1)}/>),/<script>/);
});
test("hide/show is local UI state, with zero requests or storage and transcript changes",async()=>{
 const dom=parseHTML("<html><body><div id='test'></div></body></html>");
 Object.assign(globalThis,{window:dom.window,document:dom.document,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,localStorage:{getItem(){throw Error("No storage needed");},setItem(){throw Error("No storage needed");}}});
 const priorFetch=globalThis.fetch;let calls=0;globalThis.fetch=(()=>{calls++;throw Error("No model or persistence calls allowed");}) as typeof fetch;
 const host=document.getElementById("test")!;const root=createRoot(host);const before=JSON.stringify({tree,messages});
 try{await act(async()=>root.render(<NodeProgress tree={tree} messages={messages}/>));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Hide covered ideas"]')!.click());assert.equal(host.querySelector("ol"),null);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Show covered ideas"]')!.click());assert.match(host.textContent!,/Standard errors/);
 assert.equal(calls,0);assert.equal(JSON.stringify({tree,messages}),before);
 }finally{await act(async()=>root.unmount());globalThis.fetch=priorFetch;}
});

test("saved concept reads use GET only and never dispatch extraction or inference",async()=>{
 const dom=parseHTML("<html><body><div id='read-test'></div></body></html>");
 Object.assign(globalThis,{window:dom.window,document:dom.document,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const priorFetch=globalThis.fetch;const calls:string[]=[];
 globalThis.fetch=(async(url,init)=>{assert.equal(url,"/api/graph");assert.ok(!init?.method||init.method==="GET");calls.push(String(url));return new Response(JSON.stringify({propositions:[{name:"Sampling uncertainty",provenance:[{chatId:"fixture",messageId:"m"}]}]}),{status:200});}) as typeof fetch;
 const host=document.getElementById("read-test")!;const root=createRoot(host);
 const record:ProgressMessage[]=[{id:"g",role:"assistant",parts:[{id:"m-t0",type:"text",text:"The existing explanation."},{type:"tool-quiz",input:{nodeId:"b"}}]}];
 try{await act(async()=>root.render(<NodeProgress tree={tree} messages={record} chatId="fixture"/>));assert.match(host.textContent!,/Sampling uncertainty/);
 const before=calls.length;await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Hide covered ideas"]')!.click());assert.equal(calls.length,before);assert.deepEqual(calls,["/api/graph"]);
 }finally{await act(async()=>root.unmount());globalThis.fetch=priorFetch;}
});
