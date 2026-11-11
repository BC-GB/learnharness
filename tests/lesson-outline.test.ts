import assert from "node:assert/strict";
import { test, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { validateOutlineSubmission, type OutlineSource } from "../src/core/lesson-outline.ts";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-outline-")));
process.env.LH_DATA_DIR = path.join(scratch, "state"); process.env.LH_SOURCE_ROOT = path.join(scratch, "source"); process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
fs.mkdirSync(process.env.LH_DATA_DIR); fs.mkdirSync(process.env.LH_SOURCE_ROOT); fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { chatStore } = await import("../src/store/chats.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { refreshLessonOutline, lessonOutlineView, outlineRunningCount, outlinePassages, selectOutlinePassages } = await import("../src/server/lesson-outline.ts");
const { readLessonOutline, writeLessonOutline, readLegacyLessonOutline } = await import("../src/store/lesson-outline.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const { addCourse, resolveCourse } = await import("../src/store/courses.ts");
const { outlineMaterials, outlineMaterialPack } = await import("../src/server/outline-materials.ts");
const { toLlmMessages } = await import("../src/core/native-messages.ts");
const { GET, POST } = await import("../app/api/chats/[id]/outline/route.ts");
const { parseGeneralSettingsBody } = await import("../src/server/settings-body.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { withWorkerRequestSlot } = await import("../src/agent/worker-request-admission.ts");
const { effectiveSettings } = await import("../src/server/stores.ts");

const tree = { nodes: [{ id: "a", title: "Panel observations" }, { id: "b", title: "Within-unit changes" }], edges: [{ from: "a", to: "b" }], version: 1 };
const sources: OutlineSource[] = [{ id: "s1", path: "lecture.md", text: "Panel data observes the same units over time. Within-unit changes compare a unit to itself.", sha256: "fixture" }];
const item = { id: "same-units", label: "Same units over time", sources: [{ sourceId: "s1", quote: "the same units over time" }], messageIds: ["m1"] };
const submission = { groups: [{ id: "structure", title: "Panel structure", nodeIds: ["a", "b"], items: [item] }], currentItem: item.id, revisionReason: null };
const passages = [{ id: "m1", nodeId: "a", text: "teacher", index: 0 }];
function fixture() {
	const record = chatStore.createChat("Panel data"); chatStore.saveTree(record.id, tree);
	const message = { ...fauxAssistantMessage([fauxText("Panel data observes the same units over time."), fauxToolCall("quiz", { nodeId: "a", type: "check" }, { id: "q1" })], { stopReason: "toolUse" }), id: "m1" };
	chatStore.saveMessages(record.id, [message]); return chatStore.getChat(record.id)!;
}
function engine(reply: unknown = submission) {
	const faux = createFauxCore({}); faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_outline", reply as Parameters<typeof fauxToolCall>[1])], { stopReason: "toolUse" })]);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

test("AI can combine nodes, split one node, rename display headings and reorder independently", () => {
	assert.deepEqual(validateOutlineSubmission(submission, sources, passages, tree), submission);
	const split = { ...submission, groups: [
		{ id: "first", title: "Changes within a person", nodeIds: ["b", "a"], items: [{ ...item, id: "within", label: "Compare a person to themself" }] },
		{ id: "second", title: "Repeated observations", nodeIds: ["a"], items: [{ ...item, id: "repeated" }] },
	], currentItem: "within" };
	assert.deepEqual(validateOutlineSubmission(split, sources, passages, tree), split);
	assert.throws(() => validateOutlineSubmission({ ...submission, groups: [{ ...submission.groups[0], nodeIds: ["a"] }] }, sources, passages, tree));
	assert.throws(() => validateOutlineSubmission({ ...submission, groups: [{ ...submission.groups[0], nodeIds: ["foreign"] }] }, sources, passages, tree));
	assert.throws(() => validateOutlineSubmission({ ...split, groups: split.groups.map(g => ({ ...g, items: [item] })) }, sources, passages, tree));
});

test("scope, exact quotes, provenance, short labels and latest current evidence are mandatory", () => {
	for (const changed of [
		{ ...item, messageIds: ["foreign"] },
		{ ...item, sources: [{ sourceId: "s1", quote: "Invented unsupported course claim" }] },
		{ ...item, sources: [{ sourceId: "s1", quote: "          " }] },
		{ ...item, label: "<script>" },
		{ ...item, label: "x".repeat(91) },
	]) assert.throws(() => validateOutlineSubmission({ ...submission, groups: [{ ...submission.groups[0], items: [changed] }] }, sources, passages, tree));
	assert.equal(validateOutlineSubmission(submission, sources, [...passages, { ...passages[0]!, id: "m2" }], tree).currentItem, null);
	const change = { ...submission, groups: [{ ...submission.groups[0]!, title: "Corrected grouping" }] };
	assert.throws(() => validateOutlineSubmission(change, sources, passages, tree, submission.groups));
	assert.equal(validateOutlineSubmission({ ...change, revisionReason: "The reading distinguishes two cases." }, sources, passages, tree, submission.groups).groups[0]!.title, "Corrected grouping");
	// Existing evidence survives a new batch, without claiming it is current.
	assert.equal(validateOutlineSubmission(submission, sources, [{ ...passages[0]!, id: "m2" }], tree, submission.groups).currentItem, null);
});

test("disabled module and GET dispatch nothing and write nothing", async () => {
	writeSettings({ version: 1 }); const record = fixture(); const bytes = fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json"));
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => { throw new Error("must not read"); } });
	assert.equal(readLessonOutline(record.id), null); assert.equal(lessonOutlineView(record.id)?.available, false);
	assert.equal((await POST(new Request("http://test/api/chats/x/outline", { method: "POST" }), { params: Promise.resolve({ id: record.id }) })).status, 409);
	assert.deepEqual(fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json")), bytes);
	assert.equal(parseGeneralSettingsBody({ lessonOutline: "true" }).ok, false);
});

test("separate observer context, prompt/history equality, duplicate prevention and original files", async () => {
	writeSettings({ version: 1 }); const teacherBefore = createTeacherAgent(undefined, { engine: engine() }).state.systemPrompt;
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	assert.equal(createTeacherAgent(undefined, { engine: engine() }).state.systemPrompt, teacherBefore);
	const original = fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json")); const teacherContext = JSON.stringify(toLlmMessages(record.messages)); let calls = 0;
	const raw = engine(); const observed = { ...raw, streamFn: ((m, c, o) => {
		calls++; const context = JSON.stringify(c); assert.ok(context.includes("UNTRUSTED DATA")); assert.ok(context.includes("NOT fixed containers")); assert.ok(context.includes("submit_outline"));
		assert.ok(!context.includes("# Teach — one step")); return raw.streamFn(m, c, o);
	}) as typeof raw.streamFn };
	await refreshLessonOutline(record.id, { engine: observed, materials: () => sources });
	assert.equal(calls, 1); assert.equal(outlineRunningCount(), 0);
	assert.equal(readLessonOutline(record.id)?.groups[0]?.title, "Panel structure");
	await refreshLessonOutline(record.id, { force: true, engine: observed, materials: () => sources }); assert.equal(calls, 1);
	assert.deepEqual(fs.readFileSync(path.join(process.env.LH_DATA_DIR!, "chats", record.id + ".json")), original);
	assert.equal(JSON.stringify(toLlmMessages(chatStore.getChat(record.id)!.messages)), teacherContext);
	assert.ok(!JSON.stringify(lessonOutlineView(record.id)).includes("sourceId"));
});

test("actual prose can select a different AI group from the stale native quiz tag", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	const split = { groups: [
		{ id: "observing", title: "Repeated observations", nodeIds: ["a"], items: [{ ...item, id: "repeated", messageIds: [] }] },
		{ id: "comparing", title: "Comparing changes", nodeIds: ["b"], items: [{ ...item, id: "within", label: "Within-unit changes" }] },
	], currentItem: "within", revisionReason: null };
	await refreshLessonOutline(record.id, { engine: engine(split), materials: () => sources });
	assert.equal(readLessonOutline(record.id)?.nativeNode, "a");
	assert.equal(lessonOutlineView(record.id)?.currentGroup, "comparing");
	const text = { ...fauxAssistantMessage([fauxText("An untagged follow-up about another case.")]), id: "m2" };
	chatStore.saveMessages(record.id, [...record.messages, text]);
	assert.equal(outlinePassages(chatStore.getChat(record.id)!).at(-1)?.id, "m2");
	assert.equal(lessonOutlineView(record.id)?.currentGroup, null, "Old evidence cannot identify a newer unreviewed passage");
});

test("course-wide backfill samples older nodes and recent untagged text within a bound", () => {
	const all = Array.from({ length: 40 }, (_, index) => ({ id: "m" + index, nodeId: index < 30 ? "a" : null, text: String(index).padEnd(4000, "x"), index }));
	const selected = selectOutlinePassages(all, 0, true);
	assert.ok(selected.reduce((n, p) => n + p.text.length, 0) <= 24000);
	assert.equal(selected.at(-1)?.id, "m39"); assert.ok(selected.some(p => p.id === "m0"));
	const batch = selectOutlinePassages(all, 5, false); assert.equal(batch[0]?.index, 5);
	assert.ok(batch.reduce((n, p) => n + p.text.length, 0) <= 24000);
	assert.ok(selectOutlinePassages(all, batch.at(-1)!.index + 1, false).every(p => p.index > batch.at(-1)!.index));
});

test("bad responses stay isolated and do not cause a retry storm", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture(); let reads = 0;
	await refreshLessonOutline(record.id, { engine: engine({ groups: [], currentItem: "unknown", revisionReason: null }), materials: () => { reads++; return sources; } });
	assert.ok(readLessonOutline(record.id)?.error); assert.equal(readLessonOutline(record.id)?.cursor, 0);
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => { reads++; return sources; } }); assert.equal(reads, 1);
});

test("queued disabling prevents dispatch and interrupted work resumes without changing the teacher", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	const raw = engine(); let calls = 0; let release!: () => void; const blocked = new Promise<void>(done => { release = done; });
	const holders = Array.from({ length: effectiveSettings().agent.workerRequestConcurrency }, () => withWorkerRequestSlot(undefined, () => blocked));
	const slow = { ...raw, streamFn: ((m, c, o) => { calls++; return raw.streamFn(m, c, o); }) as typeof raw.streamFn };
	const work = refreshLessonOutline(record.id, { engine: slow, materials: () => sources });
	const duplicate = refreshLessonOutline(record.id, { engine: slow, materials: () => sources });
	writeSettings({ version: 1, general: { lessonOutline: false } }); release(); await Promise.all([...holders, work, duplicate]); assert.equal(calls, 0);
	writeSettings({ version: 1, general: { lessonOutline: true } });
	await refreshLessonOutline(record.id, { engine: slow, materials: () => sources }); assert.equal(calls, 1);
	assert.ok(readLessonOutline(record.id)?.groups.length);
});

test("replan and prefix rewrites affect only the independent view, not native plan names", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources });
	chatStore.saveTree(record.id, { ...tree, nodes: [{ id: "a", title: "A revised native title" }, tree.nodes[1]!], version: 2 });
	const before = JSON.stringify(chatStore.getChat(record.id));
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources });
	assert.equal(readLessonOutline(record.id)?.groups[0]?.title, "Panel structure");
	assert.ok(readLessonOutline(record.id)?.previous?.length); assert.equal(JSON.stringify(chatStore.getChat(record.id)), before);
	chatStore.saveMessages(record.id, []);
	assert.equal(lessonOutlineView(record.id)?.groups.length, 0);
});

test("version-one metadata is not rewritten or misrepresented as an AI-designed outline", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture();
	const dir = path.join(process.env.LH_DATA_DIR!, "lesson-outlines"); fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, record.id + ".json"); const bytes = JSON.stringify({ version: 1, chatId: record.id, topics: [{ id: "a", title: "Old native title", items: [item] }], sources: [{ id: "s1", path: "lecture.md", sha256: "fixture" }] });
	fs.writeFileSync(file, bytes);
	assert.ok(readLegacyLessonOutline(record.id)); assert.equal(readLessonOutline(record.id), null);
	await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources });
	assert.equal(readLessonOutline(record.id)?.version, 2); assert.equal(fs.readFileSync(file, "utf8"), bytes);
});

test("readings and records stay course-scoped, prefer revised sources and reject aliases", async () => {
	writeSettings({ version: 1, general: { lessonOutline: true } });
	const a = resolveCourse(addCourse("Outline A").id); const b = resolveCourse(addCourse("Outline B").id);
	for (const [scope, text] of [[a, "Panel CANARY_A same units"], [b, "Panel CANARY_B same units"]] as const) fs.writeFileSync(path.join(scope.sourceRoot!, "lecture.md"), text);
	let aId = "";
	await runInCourse(a, async () => {
		writeSettings({ version: 1, general: { lessonOutline: true } }); const record = fixture(); aId = record.id;
		assert.ok(JSON.stringify(outlineMaterials("Panel same units")).includes("CANARY_A")); assert.ok(!JSON.stringify(outlineMaterials("Panel same units")).includes("CANARY_B"));
		fs.writeFileSync(path.join(a.sourceRoot!, "lecture (v2).md"), "Panel same units CURRENT_READING");
		assert.ok(outlineMaterials("Panel same units").some(s => s.path === "lecture (v2).md")); assert.ok(!outlineMaterials("Panel same units").some(s => s.path === "lecture.md"));
		const pack = outlineMaterialPack(tree, "Panel");
		assert.equal(pack.sourceCoverage.length, 2); assert.ok(JSON.stringify(pack).includes("CURRENT_READING")); assert.ok(!JSON.stringify(pack).includes("CANARY_B"));
		fs.writeFileSync(path.join(a.sourceRoot!, "lecture.md"), "retiredsubject appears only in the obsolete reading"); fs.writeFileSync(path.join(a.sourceRoot!, "lecture (v2).md"), "Updated content with different scope.");
		assert.deepEqual(outlineMaterials("retiredsubject"), []);
		assert.deepEqual(outlineMaterialPack(tree, "retiredsubject").sourceCoverage.map(x => x.sourceIds), [[], []]);
		await refreshLessonOutline(record.id, { engine: engine(), materials: () => sources }); assert.ok(readLessonOutline(record.id));
	});
	await runInCourse(b, async () => {
		writeSettings({ version: 1, general: { lessonOutline: true } }); assert.equal(readLessonOutline(aId), null);
		assert.equal((await GET(new Request("http://test/api/chats/foreign/outline?course=" + b.id), { params: Promise.resolve({ id: aId }) })).status, 404);
		assert.throws(() => readLessonOutline("../chats/foreign"));
	});
	if (process.platform !== "win32") runInCourse(a, () => {
		const target = path.join(a.dataRoot, "lesson-outlines-v2", aId + ".json"); fs.unlinkSync(target);
		const chat = path.join(a.dataRoot, "chats", aId + ".json"); const bytes = fs.readFileSync(chat); fs.symlinkSync(chat, target);
		assert.throws(() => readLessonOutline(aId));
		assert.throws(() => writeLessonOutline({ version: 2, chatId: aId, groups: [], currentItem: null, revisionReason: null, planKey: "", cursor: 0, prefixKey: "", nativeNode: null, updatedAt: "", sources: [] }));
		assert.deepEqual(fs.readFileSync(chat), bytes);
	});
});

test("broad material pack retains prior supporting quotes beyond the former single-excerpt limit", () => runInCourse(resolveCourse("legacy"), () => {
	const quotes = Array.from({ length: 18 }, (_, n) => ("Evidence passage " + n + ": ").padEnd(300, String.fromCharCode(97 + n)));
	fs.writeFileSync(path.join(process.env.LH_SOURCE_ROOT!, "panel-evidence.md"), "# Panel observations\n" + quotes.join("\n"));
	const refs = quotes.map(quote => ({ path: "panel-evidence.md", quote }));
	const pack = outlineMaterialPack(tree, "Panel observations", refs);
	const source = pack.sources.find(s => s.path === "panel-evidence.md"); assert.ok(source);
	assert.ok(quotes.every(q => source.text.includes(q)));
	assert.ok(pack.sources.reduce((n, s) => n + s.text.length, 0) < 80000);
}));
