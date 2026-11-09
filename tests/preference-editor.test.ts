import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { draftPreferences, validatePreferenceDraft } from "../src/agent/preference-editor.ts";
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-preference-editor-")));
process.env.LH_DATA_DIR = path.join(scratch, "data"); fs.mkdirSync(process.env.LH_DATA_DIR);
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { preferenceView, applyPreferences, undoPreferences, PREFERENCE_SEGMENT } = await import("../src/server/preference-editor.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const { initialiseGlobalPreferences } = await import("../src/store/global-preferences.ts");
const { globalPreferencePath } = await import("../config.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");

test("draft is bounded and accepts no tool/path fields", async () => {
 for (const v of [null, {}, {text:"x",summary:"y",path:"/etc/a"}, {text:"x".repeat(16001),summary:""}]) assert.throws(() => validatePreferenceDraft(v));
 const faux = createFauxCore({}); faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_preferences", {text:"Use examples.",summary:"Added examples."})], {stopReason:"toolUse"})]);
 assert.deepEqual(await draftPreferences({model:faux.getModel(),streamFn:faux.streamSimple}, "", "Use examples", new AbortController().signal), {text:"Use examples.",summary:"Added examples."});
});
test("global addition edits have concurrency guards and undo, without changing original guidance", () => {
 writeSettings({version:1,appearance:{readingWidth:960}}); initialiseGlobalPreferences("Connect concepts.");
 const initial=preferenceView(); assert.equal(initial.text,"Connect concepts."); assert.equal(initial.scope,"global");
 const unrelated=globalPreferencePath("global-prompts/.additions/shared/15-accuracy.md"); promptOverrides.writeOverride("shared/15-accuracy.md","Unrelated", "append"); const bytes=fs.readFileSync(unrelated);
 const next=applyPreferences(initial.revision,"Connect concepts. Use examples."); assert.equal(next.canUndo,true);
 assert.throws(()=>applyPreferences(initial.revision,"stale")); assert.deepEqual(fs.readFileSync(unrelated),bytes);
 const restored=undoPreferences(next.revision); assert.equal(restored.text,initial.text); assert.equal(restored.enabled,initial.enabled); assert.equal(restored.canUndo,false);
 const course={id:"private-test",name:"Private",dataRoot:path.join(scratch,"private"),sourceRoot:undefined};fs.mkdirSync(course.dataRoot);
 runInCourse(course,()=>{assert.equal(preferenceView().text,initial.text);assert.equal(preferenceView().scope,"global");});
 assert.throws(()=>globalPreferencePath("../escape.json")); assert.throws(()=>globalPreferencePath("unrelated.json"));
 promptOverrides.writeOverride(PREFERENCE_SEGMENT,"legacy replacement","replace"); assert.throws(()=>preferenceView());
});

test("read route never writes or infers; invalid/stale requests cannot apply", async () => {
 const { GET, POST } = await import("../app/api/settings/preference-chat/route.ts");
 promptOverrides.writeOverride(PREFERENCE_SEGMENT,"Route fixture","append");
 const before=preferenceView(); const read=await GET();
 assert.equal(read.status,200); assert.equal((await read.json()).revision,before.revision);
 const send=(body:unknown)=>POST(new Request("http://test/api/settings/preference-chat",{method:"POST",body:JSON.stringify(body)}));
 assert.equal((await send({action:"apply",revision:"stale",text:"bad"})).status,409);
 assert.equal((await send({action:"draft",revision:before.revision,message:"x".repeat(4001)})).status,400);
 assert.equal((await send({action:"draft",revision:before.revision,message:"Use short examples"})).status,400,"No configured model must fail before inference");
 assert.equal(preferenceView().revision,before.revision);
});

test("a settings-write failure leaves an undoable addition without reverting external edits", async () => {
 const { stores } = await import("../src/server/stores.ts");
 promptOverrides.writeOverride(PREFERENCE_SEGMENT,"Before failure","append");
 writeSettings({version:1,agent:{prompts:{[PREFERENCE_SEGMENT]:false}}});
 const before=preferenceView(); const original=stores.settingsStore.writeSettings;
 stores.settingsStore.writeSettings=()=>{throw new Error("Synthetic write failure");};
 try { assert.throws(()=>applyPreferences(before.revision,"After failure")); } finally { stores.settingsStore.writeSettings=original; }
 const partial=preferenceView(); assert.equal(partial.text,"After failure"); assert.equal(partial.enabled,false); assert.equal(partial.canUndo,true);
 const restored=undoPreferences(partial.revision); assert.equal(restored.text,before.text); assert.equal(restored.enabled,false);
 const applied=applyPreferences(restored.revision,"A saved revision");
 promptOverrides.writeOverride(PREFERENCE_SEGMENT,"External edit","append");
 assert.equal(preferenceView().canUndo,false); assert.throws(()=>undoPreferences(applied.revision)); assert.equal(preferenceView().text,"External edit");
});


test("failed undo can be resumed only from its journaled partial state", async () => {
 const { stores } = await import("../src/server/stores.ts");
 promptOverrides.writeOverride(PREFERENCE_SEGMENT,"Undo original","append");
 writeSettings({version:1,agent:{prompts:{[PREFERENCE_SEGMENT]:false}}});
 const before=preferenceView(); const applied=applyPreferences(before.revision,"Undo new");
 const original=stores.settingsStore.writeSettings;
 stores.settingsStore.writeSettings=()=>{throw new Error("Synthetic undo failure");};
 try { assert.throws(()=>undoPreferences(applied.revision)); } finally { stores.settingsStore.writeSettings=original; }
 const partial=preferenceView(); assert.equal(partial.text,before.text); assert.equal(partial.enabled,true); assert.equal(partial.canUndo,true);
 const restored=undoPreferences(partial.revision); assert.equal(restored.text,before.text); assert.equal(restored.enabled,false);
});

test("revision tokens bind the selected course even when global text matches", () => {
 const initial=preferenceView();
 const course={id:"revision-other",name:"Other",dataRoot:path.join(scratch,"other"),sourceRoot:undefined};fs.mkdirSync(course.dataRoot);
 runInCourse(course,()=>{
  const other=preferenceView(); assert.equal(other.text,initial.text); assert.notEqual(other.revision,initial.revision);
  assert.throws(()=>applyPreferences(initial.revision,"Wrong course"));
  assert.throws(()=>undoPreferences(initial.revision));
  assert.equal(preferenceView().text,initial.text);
 });
});
