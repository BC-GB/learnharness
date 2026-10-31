import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("subscription policy denies controls, owner creation and leases while keeping explicit API-key mode",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"subscription-policy-"));
 const names=["LH_DISABLE_SUBSCRIPTION_AUTH","LH_IGNORE_ENV_KEYS","LH_AUTH_FILE","LH_DATA_DIR","OPENAI_API_KEY","LH_DESKTOP_SERVER","LH_DESKTOP_API_SECRET"] as const;
 const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const original=globalThis.fetch;let network=0,ownerReads=0;
 globalThis.fetch=(async()=>{network++;throw new Error("unexpected network");}) as typeof fetch;
 Object.assign(process.env,{LH_DISABLE_SUBSCRIPTION_AUTH:"1",LH_IGNORE_ENV_KEYS:"1",LH_AUTH_FILE:path.join(root,"auth.json"),LH_DATA_DIR:path.join(root,"data"),OPENAI_API_KEY:"synthetic-env-must-be-ignored"});
 fs.writeFileSync(process.env.LH_AUTH_FILE!,JSON.stringify({OPENAI_API_KEY:"synthetic-file-key"}),{mode:0o600});
 try {
  const runtime=await import("../src/agent/subscription-runtime.ts");
  const owner=await import("../src/server/web-subscriptions.ts");
  const http=await import("../src/server/web-subscription-http.ts");
  const chat=await import("../src/agent/chatgpt-bridge.ts");
  const native=await import("../src/agent/subscription-bridge.ts");
  const {keyValue}=await import("../src/server/keys.ts");
  assert.equal(runtime.webSubscriptionsEnabled(),false);
  const options=new Proxy({directory:root},{get(){ownerReads++;throw new Error("unexpected credential-store read");}});
  assert.throws(()=>owner.createWebSubscriptionOwner(options),/disabled by deployment policy/);
  await assert.rejects(runtime.webSubscriptionRequest("lh:chatgpt","lease",{}));
  const origin="http://127.0.0.1:3000";
  for(const provider of ["chatgpt","github-copilot","xai"])for(const op of ["login","import","select","consent","lease"]){
   const req=new Request(origin+"/api/subscriptions",{method:"POST",headers:{host:"127.0.0.1:3000",origin,"content-type":"application/json","x-learnharness-subscriptions":"1"},body:JSON.stringify({provider,op,id:"synthetic",enabled:true})});
   assert.equal((await http.subscriptionControlsResponse(req)).status,403);
  }
  assert.equal((await http.subscriptionBrowserResponse(new Request(origin+"/api/subscriptions/browser?id=00000000-0000-4000-8000-000000000001"))).status,403);
  process.env.LH_DESKTOP_SERVER="1";process.env.LH_DESKTOP_API_SECRET="x".repeat(64);
  await assert.rejects(chat.chatGPTRequest("lease"));await assert.rejects(native.subscriptionRequest("lease"));
  assert.equal(chat.chatGPTConnected(),false);assert.deepEqual(chat.chatGPTModels(),[]);assert.deepEqual(native.nativeSubscriptionModels(),[]);
  assert.equal(keyValue("OPENAI_API_KEY"),"synthetic-file-key");assert.equal(ownerReads,0);assert.equal(network,0);
 }finally{globalThis.fetch=original;for(const name of names){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}fs.rmSync(root,{recursive:true,force:true});}
});