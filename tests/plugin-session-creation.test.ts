import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginSession } from "../components/plugin-session-creation.ts";

test("native plugin creation carries the selected course and stages only its created chat", async () => {
	let course = "course_" + "a".repeat(32); const writes: unknown[] = [], calls: { url: string; init: RequestInit }[] = [];
	const host = { course: () => course,
		fetch: (async (url, init) => { calls.push({ url: String(url), init: init! }); return Response.json({ id: "new_chat" }); }) as typeof fetch,
		stage: (id: string, text: string, selected: string) => { writes.push({ id, text, course: selected }); return true; },
		clear: (id: string, selected: string) => { writes.push({ clear: id, course: selected }); },
	};
	const controller = new AbortController(), created = await createPluginSession({ title: "Week 1", kind: "practice" }, controller.signal, host);
	assert.equal(new URL(calls[0]!.url, "http://local").searchParams.get("course"), course);
	assert.equal((calls[0]!.init.headers as Record<string, string>)["x-learnharness-course"], course);
	assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { title: "Week 1", kind: "practice" });
	assert.deepEqual(writes, [], "Creating never stages or dispatches content");
	assert.equal(created.stageOpeningPrompt("Explain the lecture"), true);
	const originalCourse = course; course = "legacy";
	assert.equal(created.stageOpeningPrompt("foreign draft"), false);
	controller.abort(); created.clearOpeningPrompt();
	assert.deepEqual(writes, [{ id: "new_chat", text: "Explain the lecture", course: originalCourse }, { clear: "new_chat", course: originalCourse }]);
});
test("delayed course changes and cancellation refuse a new staging handle", async () => {
	let finish!: (response: Response) => void, course = "legacy";
	const host = { course: () => course, fetch: (() => new Promise<Response>(r => { finish = r; })) as typeof fetch, stage: () => assert.fail(), clear: () => assert.fail() };
	const first = createPluginSession({ title: "A", kind: "teaching" }, new AbortController().signal, host);
	course = "course_" + "b".repeat(32); finish(Response.json({ id: "orphan" })); await assert.rejects(first, /Course changed/);
	const controller = new AbortController(); const second = createPluginSession({ title: "B", kind: "teaching" }, controller.signal, host);
	controller.abort(); finish(Response.json({ id: "cancelled" })); await assert.rejects(second);
});
