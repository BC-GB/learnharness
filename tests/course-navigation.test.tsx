import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseProvider } from "../components/course-navigation.tsx";
import CourseLink from "../components/course-navigation.tsx";
import { CoursePicker } from "../components/course-picker.tsx";
import { courseFetch, courseUrlForId } from "../lib/course-client.ts";
import { stashOpeningPrompt, readOpeningPrompt } from "../components/opening-prompt.ts";

const a = "legacy";
const b = "course_" + "b".repeat(32);
const c = "course_" + "c".repeat(32);

test("course selection preserves other URL parameters and rejects contradictory selections", () => {
	assert.equal(courseUrlForId("/chat/new?mode=practice", a), "/chat/new?mode=practice");
	assert.equal(courseUrlForId("/chat/new?mode=practice#question", b), `/chat/new?mode=practice&course=${b}#question`);
	assert.throws(() => courseUrlForId(`/chat/new?course=${c}`, b), /Conflicting/);
	assert.throws(() => courseUrlForId("/", "../other"), /Unknown course/);
});

test("the picker and application links render the selected course with no inference or writes", () => {
	const before = globalThis.fetch;
	globalThis.fetch = (() => assert.fail("Rendering course navigation must not fetch or infer")) as typeof fetch;
	try {
		const html = renderToStaticMarkup(<CourseProvider course={{ id: b, name: "Subject B", readOnlyLibrary: false }}><CoursePicker /><CourseLink href="/chat/new?mode=practice">Practice</CourseLink></CourseProvider>);
		assert.match(html, /aria-label="Course"/);
		assert.match(html, /aria-label="Add course"/);
		assert.match(html, /Subject B/);
		assert.match(html, /Add \/ view materials/);
		assert.ok(html.includes(`course=${b}`));
		assert.doesNotMatch(html, /Subject A|COURSE_A_PRIVATE_PROMPT/);
	} finally { globalThis.fetch = before; }
});

test("each document stamps APIs, streams and downloads with its own course", async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
	const before = globalThis.fetch;
	const calls: { url: string; course: string | null }[] = [];
	const documentStub = { documentElement: { dataset: { courseId: b } } };
	Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
	globalThis.fetch = (async (input, init) => { calls.push({ url: input instanceof Request ? input.url : String(input), course: new Headers(init?.headers).get("x-learnharness-course") }); return Response.json({}); }) as typeof fetch;
	try {
		await courseFetch("/api/chats");
		documentStub.documentElement.dataset.courseId = c;
		await courseFetch("/api/chat", { method: "POST", body: "{}" });
		assert.deepEqual(calls.map(call => call.course), [b, c]);
		assert.ok(calls[0]!.url.endsWith(`course=${b}`));
		assert.ok(calls[1]!.url.endsWith(`course=${c}`));
		assert.throws(() => courseFetch(`/api/chats?course=${b}`), /Conflicting/);
		assert.equal(calls.length, 2);
	} finally { globalThis.fetch = before; if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); }
});

test("opening-message stashes are separate even when courses have the same chat ID", () => {
	const doc = Object.getOwnPropertyDescriptor(globalThis, "document");
	const storage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
	const map = new Map<string, string>();
	const documentStub = { documentElement: { dataset: { courseId: a } } };
	Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { setItem: (key: string, value: string) => map.set(key, value), getItem: (key: string) => map.get(key) ?? null, removeItem: (key: string) => map.delete(key) } });
	try {
		assert.equal(stashOpeningPrompt("same", "Subject A draft"), true);
		documentStub.documentElement.dataset.courseId = b;
		assert.equal(readOpeningPrompt("same"), undefined);
		assert.equal(stashOpeningPrompt("same", "Subject B draft"), true);
		documentStub.documentElement.dataset.courseId = a;
		assert.equal(readOpeningPrompt("same"), "Subject A draft");
		documentStub.documentElement.dataset.courseId = b;
		assert.equal(readOpeningPrompt("same"), "Subject B draft");
	} finally { if (doc) Object.defineProperty(globalThis, "document", doc); else Reflect.deleteProperty(globalThis, "document"); if (storage) Object.defineProperty(globalThis, "sessionStorage", storage); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
});
