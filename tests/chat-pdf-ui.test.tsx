import React, { act, useState } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { Composer } from "../components/composer.tsx";
import { CourseProvider } from "../components/course-navigation.tsx";
import { FilePathDropZone } from "../components/file-path-drop-zone.tsx";
import { readPathInput } from "../components/path-input-dom.ts";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });
async function fixture() {
	const { window: win, document: doc } = parseHTML("<html><body><div id='root'></div></body></html>");
	let active: Element = doc.body;
	Object.defineProperty(doc, "activeElement", { get: () => active });
	const selection = { anchorNode: null as Node | null, anchorOffset: 0, focusNode: null as Node | null, focusOffset: 0,
		setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); } };
	Object.assign(doc, { getSelection: () => selection, oninput: null });
	win.HTMLElement.prototype.focus = function () { active = this; };
	Object.defineProperty(win, "location", { value: { href: "http://localhost/chats/one" }, configurable: true });
	const requests: { url: string; init?: RequestInit }[] = [];
	let delayed = false; let release: (() => void) | undefined; let fail = false;
	const name = "a".repeat(64) + ".pdf";
	const saved = { name, path: "/state/chat-pdfs/" + name, filename: "My working.pdf", pages: 3 };
	const prior = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, window: win, document: doc, Node: win.Node, Element: win.Element, HTMLElement: win.HTMLElement,
		Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
		fetch: async (input: unknown, init?: RequestInit) => {
			requests.push({ url: String(input), init });
			if (delayed && init?.method === "POST") await new Promise<void>(resolve => { release = resolve; });
			return Response.json(fail ? { error: "Could not attach this PDF" } : saved, { status: fail ? 400 : 200 });
		},
	})) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import("react-dom/client"); const root = createRoot(doc.getElementById("root")!);
	let course = "legacy"; let sent = 0; let stopped = 0; let busy = false;
	function Harness() {
		const [text, setText] = useState("Please identify my weak areas.");
		return <CourseProvider course={{ id: course, name: course, readOnlyLibrary: true }}><FilePathDropZone>
			<div data-testid="transcript">Lesson</div>
			<Composer value={text} onChange={setText} canSend={!!text.trim()} busy={busy} onSend={() => { sent++; }} onStop={() => { stopped++; }} />
		</FilePathDropZone></CourseProvider>;
	}
	function draw() { doc.documentElement.dataset.courseId = course; root.render(<Harness key={course} />); }
	await act(async () => { draw(); });
	cleanup = async () => { await act(async () => root.unmount()); for (const [key, value] of prior) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as Record<string, unknown>)[key]; } };
	const file = (filename = "My working.pdf", type = "application/pdf", size = 100) => new File([new Uint8Array(size)], filename, { type });
	const editor = () => doc.querySelector<HTMLElement>('[data-file-path-input]')!;
	async function drop(files: File[], target = doc.querySelector('[data-testid="transcript"]')!) {
		const event = Object.assign(new win.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: { types: ["Files"], files } });
		await act(async () => { target.dispatchEvent(event); }); return event;
	}
	async function pick(files: File[]) {
		const input = doc.querySelector('[data-testid="attach-files-input"]')!;
		Object.defineProperty(input, "files", { value: files, configurable: true });
		await act(async () => { input.dispatchEvent(new win.Event("change", { bubbles: true })); });
	}
	return { doc, win, requests, file, editor, drop, pick, saved,
		get sent() { return sent; }, get stopped() { return stopped; },
		delay() { delayed = true; }, fail() { fail = true; },
		async release() { await act(async () => { release!(); }); },
		async switchCourse() { await act(async () => { course = "course_" + "b".repeat(32); draw(); }); },
		async busy() { await act(async () => { busy = true; draw(); }); },
	};
}

test("browser drag attaches a PDF card with page count, requires Send and supports removal and picker", async () => {
	const f = await fixture();
	assert.match(f.doc.querySelector('[data-testid="attach-files-input"]')!.getAttribute("accept")!, /application\/pdf/);
	assert.equal((await f.drop([f.file()])).defaultPrevented, true);
	assert.equal(f.requests.filter(r => r.init?.method === "POST").length, 1);
	assert.match(f.requests[0]!.url, /^\/api\/chat-pdfs\?filename=My/);
	assert.match(f.doc.querySelector('[data-testid="pdf-attachment-previews"]')!.textContent!, /My working.pdf.*3 pages/);
	assert.match(readPathInput(f.editor()), /chat-pdfs/);
	assert.equal(f.sent, 0, "uploading never sends a message or starts a model");
	await act(async () => { f.doc.querySelector<HTMLElement>('[aria-label="Remove attached PDF"]')!.click(); });
	assert.equal(f.doc.querySelector('[data-testid="pdf-attachment-previews"]'), null);
	assert.equal(readPathInput(f.editor()).trim(), "Please identify my weak areas.");
	await f.pick([f.file()]);
	assert.ok(f.doc.querySelector('[aria-label="Remove attached PDF"]'));
	await act(async () => { f.doc.querySelector('[data-testid="composer"]')!.dispatchEvent(new f.win.Event("submit", { bubbles: true, cancelable: true })); });
	assert.equal(f.sent, 1);
});

test("unsupported, oversized and rejected PDFs retain the draft; upload blocks Send while Stop still works", async () => {
	const f = await fixture();
	await f.drop([f.file("answers.docx", "application/octet-stream")]);
	assert.equal(f.requests.length, 0); assert.match(f.doc.querySelector('[role="alert"]')!.textContent!, /Use PDFs/);
	await f.pick([f.file("big.pdf", "application/pdf", 20 * 1024 * 1024 + 1)]);
	assert.equal(f.requests.length, 0);
	f.fail(); await f.drop([f.file()]);
	assert.match(f.doc.querySelector('[role="alert"]')!.textContent!, /Could not attach/);
	assert.doesNotMatch(readPathInput(f.editor()), /chat-pdfs/);
	await f.busy(); f.delay(); await f.drop([f.file()]);
	assert.ok(f.doc.querySelector('[aria-label="Stop"]'));
	await act(async () => { f.doc.querySelector('[data-testid="composer"]')!.dispatchEvent(new f.win.Event("submit", { bubbles: true, cancelable: true })); });
	assert.equal(f.stopped, 1); assert.equal(f.sent, 0); await f.release();
});

test("a PDF completing after a chat or course switch cannot enter the new draft", async () => {
	const f = await fixture(); f.delay(); await f.drop([f.file()]);
	f.win.location.href = "http://localhost/chats/two";
	await f.release(); assert.doesNotMatch(readPathInput(f.editor()), /chat-pdfs/);
	await f.drop([f.file()]); await f.switchCourse(); await f.release();
	assert.doesNotMatch(readPathInput(f.editor()), /chat-pdfs/);
	assert.equal(f.doc.querySelector('[data-testid="pdf-attachment-previews"]'), null);
	assert.equal(f.requests[0]!.init?.signal?.aborted, false);
	assert.equal(f.requests[1]!.init?.signal?.aborted, true);
});
