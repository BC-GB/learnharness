import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { PracticeDock } from "../components/practice-dock.tsx";
import { CourseProvider } from "../components/course-navigation.tsx";
import { readPathInput, restorePathSelection } from "../components/path-input-dom.ts";
import { quoteFilePath } from "../src/core/file-paths.ts";
import type { PrepareThinkingSubmission } from "../components/plugin-submission-adapters.ts";

// DOM-only event tests with an injected upload response. No browser, live
// server, filesystem image reads, provider calls or clipboard permission.
const imagePath = `/state/courses/algebra/pasted-images/${"a".repeat(64)}.png`;
const image = () => new File(["synthetic raster"], "working.png", { type: "image/png" });
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function fixture(options: { prepare?: PrepareThinkingSubmission; custom?: boolean } = {}) {
	const { window: win, document: doc } = parseHTML("<html><body><div id='root'></div></body></html>");
	doc.documentElement.dataset.courseId = "algebra";
	const location = { href: "http://localhost/chat/practice?course=algebra", origin: "http://localhost" };
	Object.defineProperty(win, "location", { configurable: true, value: location });
	Object.defineProperty(win, "lh", { configurable: true, value: undefined });
	let active: Element = doc.body;
	Object.defineProperty(doc, "activeElement", { get: () => active });
	const selection = {
		anchorNode: null as Node | null, anchorOffset: 0, focusNode: null as Node | null, focusOffset: 0,
		setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) {
			Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset });
		},
	};
	Object.assign(doc, { getSelection: () => selection, oninput: null });
	win.HTMLElement.prototype.focus = function () { active = this; };
	const uploads: { url: string; init?: RequestInit; resolve(response: Response): void }[] = [];
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, value] of Object.entries({
		React, window: win, document: doc, location, Node: win.Node, HTMLElement: win.HTMLElement, Element: win.Element,
		Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
		fetch: (url: string, init?: RequestInit) => new Promise<Response>(resolve => uploads.push({ url, init, resolve })),
	})) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(doc.getElementById("root")!);
	let expanded = true, preparing = false, compacting = false, customThinking = "", customReady = true;
	const submissions: string[] = [];
	const accepted = (capture: () => string, clear: (captured: string) => void) => { const value = capture(); submissions.push(value); clear(value); };
	function draw() {
		root.render(<CourseProvider course={{ id: "algebra", name: "Algebra", readOnlyLibrary: true }}>
			<PracticeDock problemCallId="problem-1" input={{ statement: "Show your working." }} expanded={expanded} onExpand={() => { expanded = true; draw(); }}
				onSubmit={value => submissions.push(value)} onPrepareSubmission={options.prepare ?? accepted} preparing={preparing} compactionRunning={compacting}
				customInput={options.custom ? { thinking: customThinking, onThinkingChange(value) { customThinking = value; draw(); },
					ready: customReady, prepare: options.prepare ?? accepted, editor: <div>Custom editor</div> } : undefined} />
		</CourseProvider>);
	}
	await act(async () => { draw(); });
	const editor = doc.querySelector<HTMLElement>("[data-file-path-input]")!;
	const picker = doc.querySelector<HTMLInputElement>('[data-testid="attach-files-input"]')!;
	let pickerClicks = 0;
	picker.click = () => { pickerClicks++; };
	let mounted = true;
	async function unmount() { if (mounted) { await act(async () => root.unmount()); mounted = false; } }
	cleanup = async () => {
		await unmount();
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete (globalThis as Record<string, unknown>)[name];
		}
	};
	return {
		doc, editor, uploads, submissions, location, picker, unmount,
		get pickerClicks() { return pickerClicks; },
		get value() { return readPathInput(editor); },
		get send() { return doc.querySelector<HTMLButtonElement>('[data-testid="practice-send"]')!; },
		async update(state: { expanded?: boolean; preparing?: boolean; compacting?: boolean; customReady?: boolean }) {
			expanded = state.expanded ?? expanded; preparing = state.preparing ?? preparing;
			compacting = state.compacting ?? compacting; customReady = state.customReady ?? customReady;
			await act(async () => { draw(); });
		},
		async text(value: string) { await act(async () => { editor.textContent = value; editor.dispatchEvent(new win.Event("input", { bubbles: true })); }); },
		caret(offset: number) { editor.focus(); restorePathSelection(editor, { anchor: offset, focus: offset }); doc.dispatchEvent(new win.Event("selectionchange")); },
		async paste(files: File[] = [], text = "") {
			const event = Object.assign(new win.Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { files, getData: () => text } });
			await act(async () => { editor.dispatchEvent(event); });
			return event;
		},
		async pick(files: File[]) {
			Object.defineProperty(picker, "files", { configurable: true, value: files });
			await act(async () => { picker.dispatchEvent(new win.Event("change", { bubbles: true })); });
		},
		async resolve(index = 0, status = 200) {
			await act(async () => uploads[index]!.resolve(Response.json(status === 200 ? { path: imagePath } : { error: "Image upload refused" }, { status })));
		},
		async enter(outside = false) {
			const event = Object.assign(new win.Event("keydown", { bubbles: true, cancelable: true }), { key: "Enter" });
			await act(async () => { (outside ? win : editor).dispatchEvent(event); });
		},
	};
}

test("thinking image paste creates a course-scoped removable preview and only explicit Submit sends", async () => {
	const f = await fixture();
	assert.equal(f.send.disabled, true);
	assert.equal((await f.paste([image()])).defaultPrevented, true);
	assert.equal(f.uploads.length, 1);
	assert.equal(f.uploads[0]!.url, "/api/pasted-images?course=algebra");
	assert.equal(new Headers(f.uploads[0]!.init?.headers).get("x-learnharness-course"), "algebra");
	assert.equal(f.submissions.length, 0);
	await f.resolve();
	assert.equal(f.value.trim(), quoteFilePath(imagePath));
	assert.equal(f.doc.querySelector("img")?.getAttribute("src"), `/api/pasted-images?name=${"a".repeat(64)}.png&course=algebra`);
	assert.equal(f.send.disabled, false);
	assert.equal(f.submissions.length, 0);
	await act(async () => f.send.click());
	assert.deepEqual(f.submissions, [quoteFilePath(imagePath)]);
	assert.equal(f.value, "");
	assert.equal(f.doc.querySelector("img"), null);
});

test("thinking picker and preview removal keep ordinary text and its paste behavior", async () => {
	const f = await fixture();
	await f.paste([], "My working");
	f.caret(f.value.length);
	await act(async () => f.doc.querySelector<HTMLButtonElement>('[data-testid="attach-files"]')!.click());
	assert.equal(f.pickerClicks, 1);
	assert.match(f.picker.accept, /image\/png/);
	await f.pick([image()]); await f.resolve();
	assert.match(f.value, /^My working/);
	await act(async () => f.doc.querySelector<HTMLButtonElement>('[aria-label="Remove attached image"]')!.click());
	assert.equal(f.value.trim(), "My working");
	assert.equal(f.doc.querySelector("img"), null);
	assert.equal(f.submissions.length, 0);
});

test("pending upload blocks button and both Enter paths, survives collapse, and preserves newer typing", async () => {
	const f = await fixture();
	await f.text("Start"); f.caret(f.value.length);
	await f.paste([image()]);
	assert.equal(f.send.disabled, true);
	assert.match(f.doc.querySelector('[role="status"]')?.textContent ?? "", /Attaching/);
	await act(async () => f.send.click()); await f.enter(); await f.enter(true);
	assert.equal(f.submissions.length, 0);
	await f.text("Newer reasoning"); f.caret(f.value.length);
	await f.update({ expanded: false });
	assert.equal(f.doc.querySelector("[data-file-path-input]"), f.editor, "The upload retains its original connected editor");
	assert.equal(f.editor.closest("[hidden]") !== null, true);
	await f.resolve();
	await f.update({ expanded: true });
	assert.equal(f.value.trim(), `Newer reasoning ${quoteFilePath(imagePath)}`);
	await f.enter();
	assert.deepEqual(f.submissions, [`Newer reasoning ${quoteFilePath(imagePath)}`]);
});

test("invalid or excessive attachments and upload errors retain draft without submission", async () => {
	const f = await fixture(); await f.text("Keep this");
	await f.pick([new File(["document"], "no.pdf", { type: "application/pdf" })]);
	assert.equal(f.uploads.length, 0);
	assert.match(f.doc.querySelector('[role="alert"]')?.textContent ?? "", /Use PNG/);
	await f.pick(Array.from({ length: 5 }, image));
	assert.equal(f.uploads.length, 0);
	assert.match(f.doc.querySelector('[role="alert"]')?.textContent ?? "", /four images/);
	await f.pick([image()]); await f.resolve(0, 400);
	assert.equal(f.value, "Keep this");
	assert.equal(f.send.disabled, false);
	assert.match(f.doc.querySelector('[role="alert"]')?.textContent ?? "", /Image upload refused/);
	assert.equal(f.submissions.length, 0);
});

test("a delayed upload cannot insert after course or chat navigation, and unmount aborts it", async () => {
	const f = await fixture(); await f.text("Original draft");
	await f.paste([image()]);
	f.doc.documentElement.dataset.courseId = "geometry";
	await f.resolve();
	assert.equal(f.value, "Original draft");
	assert.equal(f.doc.querySelector("img"), null);
	f.doc.documentElement.dataset.courseId = "algebra";
	await f.paste([image()]);
	f.location.href = "http://localhost/chat/other?course=algebra";
	await f.resolve(1);
	assert.equal(f.value, "Original draft");
	await f.paste([image()]);
	const signal = f.uploads[2]!.init?.signal;
	await f.unmount();
	assert.equal(signal?.aborted, true);
	await f.resolve(2);
	assert.equal(f.submissions.length, 0);
});

test("accepted asynchronous thinking submission cannot clear edits made after capture", async () => {
	let accept: (() => void) | undefined;
	const f = await fixture({ prepare(capture, clear) { const captured = capture(); accept = () => clear(captured); } });
	await f.paste([image()]); await f.resolve();
	await act(async () => f.send.click());
	assert.ok(accept);
	await f.text("More working after submit");
	await act(async () => accept!());
	assert.equal(f.value, "More working after submit");
});

test("custom thinking uses the shared attachment flow while keeping its readiness and preparation gates", async () => {
	const f = await fixture({ custom: true });
	await f.update({ customReady: false });
	await f.paste([image()]); await f.resolve();
	assert.equal(f.send.disabled, true);
	await f.enter(); assert.equal(f.submissions.length, 0);
	await f.update({ customReady: true, preparing: true });
	await f.paste([image()]);
	assert.equal(f.uploads.length, 1, "An occupied submission cannot accept a new upload");
	await f.enter(); assert.equal(f.submissions.length, 0);
	await f.update({ preparing: false, compacting: true });
	await f.enter(); assert.equal(f.submissions.length, 0);
	await f.update({ compacting: false });
	await act(async () => f.send.click());
	assert.deepEqual(f.submissions, [quoteFilePath(imagePath) + " "]);
	assert.equal(f.value, "");
});
