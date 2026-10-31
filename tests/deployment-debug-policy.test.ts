import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { providerEventsEnabled, providerEventObserver, providerEventsDir } from "../src/agent/provider-events.ts";

test("raw provider logging requires explicit 1, not false-like environment strings",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"event-policy-"));const output=path.join(root,"events");
 const previous=process.env.LH_PROVIDER_EVENTS;const previousDir=providerEventsDir.current;
 try {
  providerEventsDir.current=output;
  for(const value of [undefined,"","0","false","true"]){if(value===undefined)delete process.env.LH_PROVIDER_EVENTS;else process.env.LH_PROVIDER_EVENTS=value;assert.equal(providerEventsEnabled(),false);assert.equal(providerEventObserver("synthetic","teacher"),undefined);}
  assert.equal(fs.existsSync(output),false);
  process.env.LH_PROVIDER_EVENTS="1";
  providerEventObserver("synthetic","teacher")!({text:"synthetic-event"},{provider:"fixture",id:"fixture"});
  assert.match(fs.readFileSync(path.join(output,"synthetic.jsonl"),"utf8"),/synthetic-event/);
 } finally {if(previous===undefined)delete process.env.LH_PROVIDER_EVENTS;else process.env.LH_PROVIDER_EVENTS=previous;providerEventsDir.current=previousDir;fs.rmSync(root,{recursive:true,force:true});}
});