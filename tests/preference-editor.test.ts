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
