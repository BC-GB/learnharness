import assert from "node:assert/strict";
import { test, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { outlineTopics, validateOutlineSubmission, type OutlineSource } from "../src/core/lesson-outline.ts";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-outline-")));
process.env.LH_DATA_DIR = path.join(scratch, "state"); process.env.LH_SOURCE_ROOT = path.join(scratch, "source"); process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
fs.mkdirSync(process.env.LH_DATA_DIR); fs.mkdirSync(process.env.LH_SOURCE_ROOT); fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { chatStore } = await import("../src/store/chats.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { refreshLessonOutline, lessonOutlineView, outlineRunningCount, outlinePassages } = await import("../src/server/lesson-outline.ts");
const { readLessonOutline, writeLessonOutline } = await import("../src/store/lesson-outline.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const { addCourse, resolveCourse } = await import("../src/store/courses.ts");
const { outlineMaterials } = await import("../src/server/outline-materials.ts");
const { toLlmMessages } = await import("../src/core/native-messages.ts");
const { GET, POST } = await import("../app/api/chats/[id]/outline/route.ts");
const { parseGeneralSettingsBody } = await import("../src/server/settings-body.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { withBgLlmSlot } = await import("../src/agent/subagents/bg-llm-semaphore.ts");

const tree = { nodes: [{ id: "a", title: "Panel observations" }, { id: "b", title: "Within-unit changes" }], edges: [{ from: "a", to: "b" }], version: 1 };
const sources: OutlineSource[] = [{ id: "s1", path: "lecture.md", text: "Panel data observes the same units over time. Within-unit changes compare a unit to itself.", sha256: "fixture" }];
const submission = { items: [{ id: "same-units", label: "Same units over time", sources: [{ sourceId: "s1", quote: "the same units over time" }], messageIds: ["m1"] }], currentItem: "same-units" };
function fixture() {
	const record = chatStore.createChat("Panel data"); chatStore.saveTree(record.id, tree);
	const message = { ...fauxAssistantMessage([fauxText("Panel data observes the same units over time."), fauxToolCall("quiz", { nodeId: "a", type: "check" }, { id: "q1" })], { stopReason: "toolUse" }), id: "m1" };
	chatStore.saveMessages(record.id, [message]); return chatStore.getChat(record.id)!;
}
function engine(reply: unknown = submission) {
	const faux = createFauxCore({}); faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_outline", reply as Parameters<typeof fauxToolCall>[1])], { stopReason: "toolUse" })]);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

test("outline preserves actual plan labels, dependencies and stable node identities", () => {
	assert.deepEqual(outlineTopics({ ...tree, nodes: [...tree.nodes].reverse() }).map(n => n.id), ["a", "b"]);
	assert.throws(() => outlineTopics({ ...tree, edges: [...tree.edges, { from: "b", to: "a" }] }));
	const previous = [{ ...outlineTopics(tree)[0]!, items: submission.items, currentItem: null }];
	assert.deepEqual(outlineTopics(tree, previous)[0]!.items, submission.items);
});

test("quotes and message anchors are verified; current needs latest teacher evidence", () => {
	const passages = [{ id: "m1", nodeId: "a", text: "teacher", index: 0 }];
	assert.deepEqual(validateOutlineSubmission(submission, sources, passages), submission);
	assert.throws(() => validateOutlineSubmission({ ...submission, items: [{ ...submission.items[0], messageIds: ["foreign"] }] }, sources, passages));
	assert.throws(() => validateOutlineSubmission({ ...submission, items: [{ ...submission.items[0], sources: [{ sourceId: "s1", quote: "Invented unsupported course claim" }] }] }, sources, passages));
	assert.throws(() => validateOutlineSubmission({ ...submission, items: [{ ...submission.items[0], sources: [{ sourceId: "s1", quote: "          " }] }] }, sources, passages));
	assert.throws(() => validateOutlineSubmission({ ...submission, items: [{ ...submission.items[0], label: "<script>" }] }, sources, passages));
	assert.equal(validateOutlineSubmission(submission, sources, [...passages, { ...passages[0]!, id: "m2" }]).currentItem, null);
});

test("disabled module and read-only GET dispatch nothing and write nothing", async () => {
	writeSettings({ version: 1 }); const record = fixture(); const bytes = fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json"));
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => { throw new Error("must not read"); } });
	assert.equal(readLessonOutline(record.id), null); assert.equal(lessonOutlineView(record.id)?.available, false);
	assert.equal((await POST(new Request("http://test/api/chats/x/outline", { method: "POST" }), { params: Promise.resolve({ id: record.id }) })).status, 409);
	assert.deepEqual(fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json")), bytes);
	assert.equal(parseGeneralSettingsBody({ lessonOutline: "true" }).ok, false);
});

test("observer uses a separate context, preserves chat/plan/model history, and deduplicates restarts", async () => {
	writeSettings({ version: 1 }); const teacherBefore = createTeacherAgent(undefined, { engine: engine() }).state.systemPrompt;
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	assert.equal(createTeacherAgent(undefined, { engine: engine() }).state.systemPrompt, teacherBefore);
	const original = fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json"));
	const teacherContext = JSON.stringify(toLlmMessages(record.messages)); let calls = 0;
	const raw = engine(); const observed = { ...raw, streamFn: ((m, c, o) => {
		calls++; const context = JSON.stringify(c); assert.ok(context.includes("UNTRUSTED DATA")); assert.ok(context.includes("submit_outline"));
		assert.ok(!context.includes("# Teach — one step")); return raw.streamFn(m, c, o);
	}) as typeof raw.streamFn };
	await refreshLessonOutline(record.id, { engine: observed, materials: () => sources });
	assert.equal(calls, 1); assert.equal(outlineRunningCount(), 0);
	assert.equal(readLessonOutline(record.id)?.topics[0]?.items[0]?.label, "Same units over time");
	await refreshLessonOutline(record.id, { force: true, engine: observed, materials: () => sources }); assert.equal(calls, 1);
	assert.deepEqual(fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json")), original);
	assert.equal(JSON.stringify(toLlmMessages(chatStore.getChat(record.id)!.messages)), teacherContext);
	assert.ok(!JSON.stringify(lessonOutlineView(record.id)).includes("sourceId"));
	assert.equal(outlinePassages(record).length, 1);
});

test("bad model response fails separately and has no automatic retry storm", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture(); let reads = 0;
	await refreshLessonOutline(record.id, { engine: engine({ items: [], currentItem: "unknown" }), materials: () => { reads++; return sources; } });
	assert.ok(readLessonOutline(record.id)?.error); assert.equal(readLessonOutline(record.id)?.cursor, 0);
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => { reads++; return sources; } }); assert.equal(reads, 1);
});

test("parallel requests share one observer; delayed disabling before a provider slot prevents dispatch", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	const raw = engine(); let calls = 0; let release!: () => void;
	const blocked = new Promise<void>(done => { release = done; });
	const holders = Array.from({ length: 3 }, () => withBgLlmSlot(undefined, () => blocked));
	const slow = { ...raw, streamFn: ((m, c, o) => { calls++; return raw.streamFn(m, c, o); }) as typeof raw.streamFn };
	const work = refreshLessonOutline(record.id, { engine: slow, materials: () => sources });
	const duplicate = refreshLessonOutline(record.id, { engine: slow, materials: () => sources });
	writeSettings({ version: 1, general: { lessonOutline: false } });
	release(); await Promise.all([...holders, work, duplicate]);
	assert.equal(calls, 0); assert.ok(!readLessonOutline(record.id)?.topics[0]?.items.length);
	writeSettings({ version: 1, general: { lessonOutline: true } });
	await refreshLessonOutline(record.id, { engine: slow, materials: () => sources });
	assert.equal(calls, 1, "An interrupted observer can resume after re-enabling, without changing the teacher transcript");
	assert.ok(readLessonOutline(record.id)?.topics[0]?.items.length);
});

test("replanning preserves stable topic items and revises only the independent observer view", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources });
	chatStore.saveTree(record.id, { ...tree, nodes: [{ id: "a", title: "Repeated observations" }, tree.nodes[1]!], version: 2 });
	const before = JSON.stringify(chatStore.getChat(record.id));
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources });
	assert.equal(readLessonOutline(record.id)?.topics[0]?.id, "a");
	assert.equal(readLessonOutline(record.id)?.topics[0]?.title, "Repeated observations");
	assert.equal(readLessonOutline(record.id)?.topics[0]?.items[0]?.id, "same-units");
	assert.ok(readLessonOutline(record.id)?.previous?.length);
	assert.equal(JSON.stringify(chatStore.getChat(record.id)), before);
});

test("course files, observer records and delayed output remain course-scoped; aliases cannot modify chats", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } });
	const a = resolveCourse(addCourse("Outline A").id); const b = resolveCourse(addCourse("Outline B").id);
	for (const [scope, text] of [[a, "Panel CANARY_A same units"], [b, "Panel CANARY_B same units"]] as const) fs.writeFileSync(path.join(scope.sourceRoot!, "lecture.md"), text);
	let aId = "";
	await runInCourse(a, async () => {
		writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture(); aId = record.id;
		assert.ok(JSON.stringify(outlineMaterials("Panel same units")).includes("CANARY_A"));
		assert.ok(!JSON.stringify(outlineMaterials("Panel same units")).includes("CANARY_B"));
		fs.writeFileSync(path.join(a.sourceRoot!, "lecture (v2).md"), "Panel same units CURRENT_READING");
		const readings = outlineMaterials("Panel same units");
		assert.ok(readings.some(s => s.path === "lecture (v2).md"));
		assert.ok(!readings.some(s => s.path === "lecture.md"), "Retained earlier editions cannot outrank their revision");
		fs.writeFileSync(path.join(a.sourceRoot!, "lecture.md"), "retiredsubject appears only in the obsolete reading");
		fs.writeFileSync(path.join(a.sourceRoot!, "lecture (v2).md"), "Updated content with different scope.");
		assert.deepEqual(outlineMaterials("retiredsubject"), [], "An obsolete edition cannot re-enter because its removed content matches the query");
		await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources }); assert.ok(readLessonOutline(record.id));
	});
	await runInCourse(b, async () => {
		writeSettings({ version: 1, general: { lessonOutline: true } });
		assert.equal(readLessonOutline(aId), null);
		assert.equal((await GET(new Request("http://test/api/chats/foreign/outline?course=" + b.id), { params: Promise.resolve({ id: aId }) })).status, 404);
		assert.throws(() => readLessonOutline("../chats/foreign"));
	});
	if (process.platform !== "win32") runInCourse(a, () => {
		const target = path.join(a.dataRoot, "lesson-outlines", aId + ".json"); fs.unlinkSync(target);
		const chat = path.join(a.dataRoot, "chats", aId + ".json"); const bytes = fs.readFileSync(chat); fs.symlinkSync(chat, target);
		assert.throws(() => readLessonOutline(aId));
		assert.throws(() => writeLessonOutline({ version: 1, chatId: aId, topics: [], planKey: "", cursor: 0, prefixKey: "", currentNode: null, updatedAt: "", sources: [] }));
		assert.deepEqual(fs.readFileSync(chat), bytes);
	});
});
