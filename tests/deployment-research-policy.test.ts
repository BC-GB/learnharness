import assert from "node:assert/strict";
import test from "node:test";
import { createWebTools } from "../src/agent/tools/web.ts";
import { createPdfReadTools } from "../src/agent/tools/pdf-read.ts";
import { jobTools, type JobToolContext } from "../src/agent/tools/jobs.ts";
import { runResearcherAgent } from "../src/agent/subagents/researcher.ts";

test("research policy blocks dispatch and pre-created tools before network or provider access",async()=>{
 const previous=process.env.LH_DISABLE_RESEARCH;const original=globalThis.fetch;
 let network=0,provider=0,store=0;
 globalThis.fetch=(async()=>{network++;throw new Error("unexpected network");}) as typeof fetch;
 const web=createWebTools(()=>{provider++;throw new Error("unexpected search lookup");});
 const pdf=createPdfReadTools("unused-synthetic-directory");
 const jobs=jobTools({chatId:"synthetic",jobStore:new Proxy({},{get(){store++;throw new Error("unexpected job mutation");}}),spawn(){throw new Error("unexpected job spawn");}} as unknown as JobToolContext);
 process.env.LH_DISABLE_RESEARCH="1";
 try {
  for(const [tool,args] of [[web.web_search!,{query:"example"}],[web.web_fetch!,{url:"http://127.0.0.1/example"}],[pdf.web_fetch_pdf!,{url:"http://127.0.0.1/example.pdf"}],[jobs.research!,{question:"example"}]] as const){const result=await tool.execute("test",args);assert.match(JSON.stringify(result),/disabled by deployment policy/);}
  await assert.rejects(runResearcherAgent("example"),/disabled by deployment policy/);
  assert.equal(network,0);assert.equal(provider,0);assert.equal(store,0);
 }finally{globalThis.fetch=original;if(previous===undefined)delete process.env.LH_DISABLE_RESEARCH;else process.env.LH_DISABLE_RESEARCH=previous;}
});