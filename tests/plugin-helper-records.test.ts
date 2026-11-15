import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createConversationStore } from "../plugins/learning-preferences/src/store.ts";
import { createOutlineStore } from "../plugins/lesson-outline/src/store.ts";
test("plugin records read legacy data without writes, retain exact original bytes and prefer new owned records across restart", t => {
 const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-helper-records-"))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const legacy = path.join(root, "course"), own = path.join(legacy, "core-plugin-data", "learning-preferences"), outlineOwn = path.join(legacy, "core-plugin-data", "lesson-outline"); fs.mkdirSync(own, { recursive: true }); fs.mkdirSync(outlineOwn, { recursive: true });
 const original = JSON.stringify({ version: 1, messages: [{ id: "one", role: "user", text: "Preserved private preference", at: "now" }], proposal: { text: "Working copy", summary: "Draft only", baseRevision: "old" } });
 const originalFile = path.join(legacy, "preference-conversation.json"); fs.writeFileSync(originalFile, original);
 const api = createConversationStore(own, legacy, "course-a"), read = api.readPreferenceConversation(); assert.equal(read.messages[0]!.text, "Preserved private preference"); assert.equal(fs.readdirSync(own).length, 0);
 assert.notEqual(createConversationStore(own, legacy, "course-b").readPreferenceConversation().revision, read.revision);
 api.writePreferenceConversation(read.revision, { ...read, proposal: null }); assert.equal(fs.readFileSync(originalFile, "utf8"), original);
 assert.equal(createConversationStore(own, legacy, "course-a").readPreferenceConversation().proposal, null);
 assert.throws(() => api.writePreferenceConversation(read.revision, { version: 1, messages: [], proposal: null }), /changed/);
 const outline = { version: 2 as const, chatId: "native", groups: [], currentItem: null, revisionReason: null, planKey: "plan", cursor: 1, prefixKey: "prefix", nativeNode: null, updatedAt: "now", sources: [] };
 const oldOutline = path.join(legacy, "lesson-outlines-v2", "native.json"); fs.mkdirSync(path.dirname(oldOutline)); const bytes = JSON.stringify(outline); fs.writeFileSync(oldOutline, bytes);
 const outlines = createOutlineStore(outlineOwn, legacy); assert.deepEqual(outlines.readLessonOutline("native"), outline); assert.equal(fs.readdirSync(outlineOwn).length, 0);
 outlines.writeLessonOutline({ ...outline, cursor: 2 }); assert.equal(fs.readFileSync(oldOutline, "utf8"), bytes); assert.equal(createOutlineStore(outlineOwn, legacy).readLessonOutline("native")!.cursor, 2);
 if (process.platform !== "win32") {
  const file = path.join(own, "conversation.json"); fs.unlinkSync(file); fs.symlinkSync(path.join(root, "missing"), file);
  assert.throws(() => api.readPreferenceConversation(), /Aliased/); assert.throws(() => api.writePreferenceConversation("bad", read), /Aliased/);
 }
});
