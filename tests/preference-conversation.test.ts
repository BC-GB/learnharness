import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { preferenceChatContext } from "../src/core/preference-chat.ts";
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-preference-conversation-")));
process.env.LH_DATA_DIR = path.join(scratch, "data"); fs.mkdirSync(process.env.LH_DATA_DIR);
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { preferenceChatView, sendPreferenceMessage, applyPreferenceConversation, undoPreferenceConversation } = await import("../src/server/preference-conversation.ts");
const { readPreferenceConversation, writePreferenceConversation } = await import("../src/store/preference-conversation.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { initialiseGlobalPreferences } = await import("../src/store/global-preferences.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const signal = () => new AbortController().signal;

test("persistent follow-ups use only preference context and preserve explicit apply/undo", async () => {
 writeSettings({ version: 1 }); initialiseGlobalPreferences("Use examples.");
 const initial = preferenceChatView();
 assert.equal(initial.conversation.messages.length, 0);
 assert(!fs.existsSync(path.join(process.env.LH_DATA_DIR!, "preference-conversation.json")), "read does not create data");
 const first = await sendPreferenceMessage(initial.revision, initial.conversation.revision, "Short examples", signal(), async (current, request, _signal, context) => {
  assert.equal(current, "Use examples."); assert.equal(request, "Short examples"); assert.deepEqual(context, { messages: [] });
  return { text: "Use short examples.", summary: "I propose shorter examples.", model: "fake" };
 });
 assert.equal(first.text, initial.text, "chat does not apply guidance");
 assert.equal(first.conversation.messages.length, 2);
 assert.deepEqual(readPreferenceConversation(), first.conversation, "history and proposal survive reload");
 const second = await sendPreferenceMessage(first.revision, first.conversation.revision, "Also explain why", signal(), async (current, request, _signal, context) => {
  assert.equal(context?.pendingAddition, "Use short examples."); assert.equal(context?.messages.length, 2);
  assert.equal(current, initial.text); assert.equal(request, "Also explain why");
  return { text: "Use short examples and explain why.", summary: "I added the reasoning.", model: "fake" };
 });
 const applied = applyPreferenceConversation(second.revision, second.conversation.revision, second.conversation.proposal!.text);
 assert.equal(applied.text, "Use short examples and explain why."); assert.equal(applied.canUndo, true); assert.equal(applied.conversation.proposal, null);
 const undone = undoPreferenceConversation(applied.revision, applied.conversation.revision);
 assert.equal(undone.text, initial.text); assert.equal(undone.conversation.messages.length, 6);
});

test("failed, aborted, and conflicting responses cannot mutate the conversation", async () => {
 const before = preferenceChatView();
 await assert.rejects(sendPreferenceMessage(before.revision, before.conversation.revision, "Fail", signal(), async () => { throw Error("fake failure"); }));
 assert.deepEqual(preferenceChatView(), before);
 const controller = new AbortController();
 await assert.rejects(sendPreferenceMessage(before.revision, before.conversation.revision, "Abort", controller.signal, async () => { controller.abort(); return { text: "Bad", summary: "Bad", model: "fake" }; }));
 assert.deepEqual(preferenceChatView(), before);
 let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
 const pending = sendPreferenceMessage(before.revision, before.conversation.revision, "Older", signal(), async () => { await wait; return { text: "Older", summary: "Older", model: "fake" }; });
 const fresh = await sendPreferenceMessage(before.revision, before.conversation.revision, "Newer", signal(), async () => ({ text: "Newer", summary: "Newer", model: "fake" }));
 release(); await assert.rejects(pending, /changed/);
 assert.deepEqual(preferenceChatView(), fresh);
 assert.throws(() => applyPreferenceConversation(before.revision, before.conversation.revision, "stale"), /changed/);
});

test("conversation and proposal stay course-local while preference scope can be global", async () => {
 const original = preferenceChatView();
 const course = { id: "preference-chat-private", name: "Private", dataRoot: path.join(scratch, "private"), sourceRoot: undefined }; fs.mkdirSync(course.dataRoot);
 await runInCourse(course, async () => {
  const scoped = preferenceChatView(); assert.equal(scoped.text, original.text); assert.equal(scoped.scope, "global");
  assert.equal(scoped.conversation.messages.length, 0); assert.notEqual(scoped.conversation.revision, original.conversation.revision);
  assert.throws(() => writePreferenceConversation(original.conversation.revision, { version: 1, messages: [], proposal: null }), /changed/);
  await sendPreferenceMessage(scoped.revision, scoped.conversation.revision, "Only in this conversation", signal(), async () => ({ text: scoped.text, summary: "Private reply", model: "fake" }));
 });
 assert.deepEqual(preferenceChatView(), original);
});

test("inference window is bounded and does not revive stale pending guidance", () => {
 const messages = Array.from({ length: 40 }, (_, i) => ({ id: String(i), role: "user" as const, text: "x".repeat(4000), at: "now" }));
 const chat = { version: 1 as const, messages, proposal: { text: "Old draft", summary: "", baseRevision: "old" } };
 const context = preferenceChatContext(chat, "new");
 assert.equal(context.messages.length, 3); assert.equal(context.pendingAddition, undefined); assert.equal(chat.messages.length, 40);
});
