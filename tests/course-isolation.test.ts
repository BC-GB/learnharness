import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-course-isolation-")));
const data = path.join(fixture, "state");
const materialsA = path.join(fixture, "library-a");
fs.mkdirSync(data); fs.mkdirSync(materialsA);
process.env.LH_DATA_DIR = data;
process.env.LH_SOURCE_ROOT = materialsA;
process.env.LH_AUTH_FILE = path.join(fixture, "synthetic-auth.json");
process.env.LH_DEFAULT_COURSE_NAME = "Subject A";
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
const pin = { model: { provider: "openrouter", id: "synthetic-fixture" }, thinkingLevel: "off" };
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ version: 1, models: { strong: pin, cheap: pin, vision: pin }, appearance: { readingWidth: 960 }, agent: { prompts: { "system-prompt.md": true }, fileAccess: { restricted: false, folders: [] } } }));

const { runInCourse, currentCourse, courseStatePath } = await import("../src/runtime/course-context.ts");
const { resolveCourse, addCourse, listCourses } = await import("../src/store/courses.ts");
const { stores } = await import("../src/server/stores.ts");
const { readPromptOverride } = await import("../src/agent/prompt-segments.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const { readTool } = await import("../src/agent/tools/read.ts");
const { grepTool } = await import("../src/agent/tools/grep.ts");
const { findTool } = await import("../src/agent/tools/find.ts");
const { proberGraphTools, prepareAuditorReview } = await import("../src/agent/tools/graph.ts");
const { createProberAgent } = await import("../src/agent/teacher-agent.ts");
const { graphView } = await import("../src/server/graph.ts");
const { beginTurn, endTurn, isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { registerTurn, abortTurn, unregisterTurn, rememberTurnFailure, turnFailure } = await import("../src/server/turn-runs.ts");
const { registerJobAbort, fireJobAbort } = await import("../src/agent/subagents/aborts.ts");
const { parkDismissal, takeParkedDismissal } = await import("../src/server/dismissal-park.ts");
const { subscribe, emit } = await import("../src/core/events.ts");
const { courseRoute } = await import("../src/server/course-http.ts");
const recordRoute = await import("../app/api/chats/[id]/route.ts");
const markdownRoute = await import("../app/api/chats/[id]/markdown/route.ts");
const snapshotRoute = await import("../app/api/chats/[id]/images/[snapshotId]/route.ts");
const materialRoute = await import("../app/api/course-materials/route.ts");
const a = resolveCourse("legacy");
runInCourse(a, () => promptOverrides.writeOverride("system-prompt.md", "COURSE_A_PRIVATE_PROMPT"));
const originalSettings = fs.readFileSync(path.join(data, "settings.json"));
const b = resolveCourse(addCourse("Subject B").id);
const scopes = [a, b];
const own = (scope: typeof a) => scope.id === a.id ? "SUBJECT_A_ONLY_CANARY" : "SUBJECT_B_ONLY_CANARY";
const foreign = (scope: typeof a) => scope.id === a.id ? own(b) : own(a);
const ids = new Map<string, string>();
const shared = "chat_shared_fixture";
for (const scope of scopes) runInCourse(scope, () => {
	fs.writeFileSync(path.join(scope.sourceRoot!, "notes.md"), own(scope));
	const chat = stores.chatStore.createChat(own(scope));
	stores.chatStore.saveMessages(chat.id, [{ id: "m1", role: "user", content: own(scope), timestamp: 1 }]);
	ids.set(scope.id, chat.id);
	const record = stores.chatStore.getChat(chat.id)!;
	fs.writeFileSync(path.join(scope.dataRoot, "chats", shared + ".json"), JSON.stringify({ ...record, id: shared }));
	stores.graphStore.appendNode({ id: "node_shared", name: "Shared term " + own(scope), statement: own(scope), aliases: [], createdAt: "2026-01-01T00:00:00Z", provenance: [{ chatId: chat.id, messageId: "m1" }] });
});
const request = (course: string, tail: string, init?: RequestInit) => new Request(`http://localhost${tail}${tail.includes("?") ? "&" : "?"}course=${course}`, init);
const context = (id: string) => ({ params: Promise.resolve({ id }) });
after(() => { for (const scope of scopes) runInCourse(scope, () => { endTurn(shared); unregisterTurn(shared); }); fs.rmSync(fixture, { recursive: true, force: true }); });

test("course creation retains legacy state and copies only general preferences", () => {
	assert.deepEqual(fs.readFileSync(path.join(data, "settings.json")), originalSettings);
	assert.equal(a.dataRoot, data);
	assert.equal(listCourses().length, 2);
	runInCourse(b, () => {
		assert.equal(stores.settingsStore.readSettings()?.models?.strong?.model?.id, "synthetic-fixture");
		assert.equal(stores.settingsStore.readSettings()?.agent?.prompts, undefined);
		assert.equal(readPromptOverride("system-prompt.md"), null);
		assert.ok(!fs.existsSync(path.join(b.dataRoot, "prompts")));
	});
	assert.throws(() => addCourse("Subject A"), /already exists/);
	assert.throws(() => resolveCourse("../../legacy"), /Unknown course/);
});

test("file tools reject both directions of foreign absolute paths, traversal and aliases", async () => {
	for (const scope of scopes) await runInCourse(scope, async () => {
		const other = scope.id === a.id ? b : a;
		const text = await readTool.execute!("read", { path: "notes.md" });
		assert.match(JSON.stringify(text), new RegExp(own(scope)));
		assert.doesNotMatch(JSON.stringify(text), new RegExp(foreign(scope)));
		await assert.rejects(readTool.execute!("read", { path: path.join(other.sourceRoot!, "notes.md") }), /restricted to the course/);
		await assert.rejects(readTool.execute!("read", { path: "../notes.md" }), /restricted to the course/);
		fs.symlinkSync(other.sourceRoot!, path.join(scope.sourceRoot!, "foreign-library"), process.platform === "win32" ? "junction" : "dir");
		await assert.rejects(readTool.execute!("read", { path: "foreign-library/notes.md" }), /restricted to the course/);
		const found = await findTool.execute!("find", { pattern: "*" });
		assert.doesNotMatch(JSON.stringify(found), /foreign-library/);
		const grep = await grepTool.execute!("grep", { pattern: foreign(scope) });
		assert.match(JSON.stringify(grep), /No matches found/);
	});
});

test("chats, identical IDs, Markdown exports and graph identity candidates remain course-local", async () => {
	for (const scope of scopes) {
		const response = await recordRoute.GET(request(scope.id, `/api/chats/${shared}`), context(shared));
		assert.equal(response.status, 200);
		const body = JSON.stringify(await response.json());
		assert.ok(body.includes(own(scope)) && !body.includes(foreign(scope)));
		const otherId = ids.get(scope.id === a.id ? b.id : a.id)!;
		assert.equal((await recordRoute.GET(request(scope.id, `/api/chats/${otherId}`), context(otherId))).status, 404);
		assert.equal((await markdownRoute.GET(request(scope.id, `/api/chats/${otherId}/markdown`), context(otherId))).status, 404);
		await runInCourse(scope, async () => {
			const graph = JSON.stringify(graphView());
			assert.ok(graph.includes(own(scope)) && !graph.includes(foreign(scope)));
			const listed = await proberGraphTools(stores).list_sessions!.execute!("list", {});
			assert.ok(JSON.stringify(listed).includes(own(scope)) && !JSON.stringify(listed).includes(foreign(scope)));
			const review = prepareAuditorReview(stores, [{ id: "p1", name: "Shared term", statement: "Shared term", aliases: [] }]);
			assert.doesNotMatch(JSON.stringify(review.initialCandidates), new RegExp(foreign(scope)));
		});
	}
});

test("session image snapshots cannot be retrieved by guessing another course's snapshot ID", async () => {
	const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFcQAAAAASUVORK5CYII=";
	const id = createHash("sha256").update(Buffer.from(data, "base64")).digest("hex");
	runInCourse(a, () => stores.chatStore.saveImageSnapshot(shared, id, { mimeType: "image/png", data, width: 1, height: 1 }));
	const ctx = { params: Promise.resolve({ id: shared, snapshotId: id }) };
	assert.equal((await snapshotRoute.GET(request(a.id, "/snapshot"), ctx)).status, 200);
	assert.equal((await snapshotRoute.GET(request(b.id, "/snapshot"), ctx)).status, 404);
});

test("unknown and conflicting course requests never fall back to existing course records", async () => {
	const missing = "course_" + "0".repeat(32);
	assert.equal((await recordRoute.GET(request(missing, `/api/chats/${shared}`), context(shared))).status, 404);
	const conflict = request(a.id, "/api/chats", { headers: { "x-learnharness-course": b.id } });
	assert.equal((await recordRoute.GET(conflict, context(shared))).status, 400);
	let dispatched = false;
	const guarded = courseRoute(async () => { dispatched = true; return Response.json({}); });
	assert.equal((await (guarded as (request: Request) => Promise<Response>)(request(missing, "/api/guard"))).status, 404);
	assert.equal(dispatched, false);
});

test("live registries separate identical chat and job IDs and event streams", () => {
	const receivedA: string[] = []; const receivedB: string[] = [];
	const offA = runInCourse(a, () => subscribe(event => receivedA.push(event.type)));
	const offB = runInCourse(b, () => subscribe(event => receivedB.push(event.type)));
	let abortedA = false; let abortedB = false;
	const controllerA = new AbortController(); const controllerB = new AbortController();
	for (const scope of scopes) runInCourse(scope, () => {
		assert.equal(beginTurn(shared), true);
		registerTurn(shared, { abort: () => { if (scope.id === a.id) abortedA = true; else abortedB = true; } } as Parameters<typeof registerTurn>[1]);
		registerJobAbort("job_same", scope.id === a.id ? controllerA : controllerB);
		rememberTurnFailure(shared, own(scope));
		parkDismissal(shared, { text: own(scope) });
	});
	assert.equal(receivedA.filter(x => x === "turn-started").length, 1);
	assert.equal(receivedB.filter(x => x === "turn-started").length, 1);
	runInCourse(b, () => { abortTurn(shared); fireJobAbort("job_same"); assert.equal(turnFailure(shared), own(b)); assert.deepEqual(takeParkedDismissal(shared), { text: own(b) }); endTurn(shared); });
	assert.equal(abortedA, false); assert.equal(abortedB, true);
	assert.equal(controllerA.signal.aborted, false); assert.equal(controllerB.signal.aborted, true);
	runInCourse(a, () => { assert.equal(isTurnRunning(shared), true); assert.equal(turnFailure(shared), own(a)); assert.deepEqual(takeParkedDismissal(shared), { text: own(a) }); endTurn(shared); });
	offA(); offB();
});

test("delayed and concurrent operations retain their original binding after the caller exits", async () => {
	const values = await Promise.all(scopes.map(scope => runInCourse(scope, async () => {
		await new Promise(resolve => setTimeout(resolve, scope.id === a.id ? 30 : 1));
		assert.equal(currentCourse()?.id, scope.id);
		const source = JSON.stringify(await readTool.execute!("later", { path: "notes.md" }));
		const record = JSON.stringify(stores.chatStore.getChat(shared));
		assert.ok(source.includes(own(scope)) && record.includes(own(scope)));
		assert.ok(!source.includes(foreign(scope)) && !record.includes(foreign(scope)));
		return scope.id;
	})));
	assert.deepEqual(values, scopes.map(scope => scope.id));
});

test("state reads reject a record symlink and a folder symlink into another profile", () => {
	const alias = path.join(b.dataRoot, "chats", "chat_alias.json");
	fs.symlinkSync(path.join(a.dataRoot, "chats", shared + ".json"), alias);
	runInCourse(b, () => assert.equal(stores.chatStore.getChat("chat_alias"), null));
	fs.unlinkSync(alias);
	const link = path.join(b.dataRoot, "foreign-state");
	fs.symlinkSync(a.dataRoot, link, process.platform === "win32" ? "junction" : "dir");
	runInCourse(b, () => assert.throws(() => courseStatePath(path.join(link, "settings.json")), /escapes/));
	runInCourse(a, () => assert.throws(() => courseStatePath(path.join(b.dataRoot, "settings.json")), /outside/));
});

test("materials uploads persist only in their selected course and do not start graph extraction", async () => {
	const form = new FormData(); form.append("files", new File(["B_UPLOAD_ONLY"], "worksheet.md"));
	const result = await materialRoute.POST(request(b.id, "/api/course-materials", { method: "POST", body: form }));
	assert.equal(result.status, 201);
	assert.equal(fs.readFileSync(path.join(b.sourceRoot!, "worksheet.md"), "utf8"), "B_UPLOAD_ONLY");
	assert.equal(fs.existsSync(path.join(a.sourceRoot!, "worksheet.md")), false);
	const invalid = new FormData(); invalid.append("files", new File(["x"], ".env"));
	assert.equal((await materialRoute.POST(request(b.id, "/api/course-materials", { method: "POST", body: invalid }))).status, 400);
	const readonly = new FormData(); readonly.append("files", new File(["x"], "new.md"));
	assert.equal((await materialRoute.POST(request(a.id, "/api/course-materials", { method: "POST", body: readonly }))).status, 403);
});

test("the real agent's complete mock model context contains only its own file, history and graph", async () => {
	for (const scope of scopes) await runInCourse(scope, async () => {
		const faux = createFauxCore({}); const payloads: string[] = [];
		faux.setResponses([
			context => { payloads.push(JSON.stringify(context)); return fauxAssistantMessage([fauxToolCall("read", { path: "notes.md" }, { id: "read-one" })], { stopReason: "toolUse" }); },
			context => { payloads.push(JSON.stringify(context)); return fauxAssistantMessage([fauxToolCall("list_sessions", {}, { id: "graph-one" })], { stopReason: "toolUse" }); },
			context => { payloads.push(JSON.stringify(context)); return fauxAssistantMessage([fauxText("Fixture finished")]); },
		]);
		const chatId = ids.get(scope.id)!;
		const agent = createProberAgent({ ...stores, chatId, spawn: () => assert.fail("No background job requested"), deliver: async () => assert.fail("No background result expected") }, { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, messages: stores.chatStore.getChat(chatId)!.messages, promptSwitches: stores.settingsStore.readSettings()?.agent?.prompts ?? {} });
		await agent.prompt("Read the material and list this course's sessions.");
		assert.equal(payloads.length, 3);
		assert.ok(payloads.join().includes(own(scope)));
		assert.ok(!payloads.join().includes(foreign(scope)));
		if (scope.id === b.id) assert.ok(!payloads.join().includes("COURSE_A_PRIVATE_PROMPT"));
	});
});

test("a new process restores each course independently without inference or migrations", () => {
	const script = `const {resolveCourse}=await import('./src/store/courses.ts');const {runInCourse}=await import('./src/runtime/course-context.ts');const {chatStore}=await import('./src/store/chats.ts');console.log(JSON.stringify(${JSON.stringify(scopes.map(scope => scope.id))}.map(id=>runInCourse(resolveCourse(id),()=>chatStore.getChat('${shared}')?.title))))`;
	const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 30_000 });
	assert.equal(child.status, 0, child.stderr);
	assert.deepEqual(JSON.parse(child.stdout), scopes.map(own));
});
