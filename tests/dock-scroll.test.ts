import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bindDockScroll, DOCK_REVEAL_EVENT, type DockScrollState } from "../components/dock-scroll.ts";
import { RESPONSE_BOTTOM_EVENT, RESPONSE_START_EVENT } from "../components/streaming-response-anchor.tsx";

function fixture() {
	const { document, window } = parseHTML("<html><body><main></main><aside><div></div></aside></body></html>");
	Object.assign(globalThis, {
		HTMLElement: window.HTMLElement,
		getComputedStyle: (el: HTMLElement) => ({ overflowY: el.style.overflowY || "visible" }),
	});
	const scroll = document.querySelector("main")!;
	const dock = document.querySelector("aside")!;
	scroll.scrollTop = 400;
	Object.defineProperties(scroll, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 600 } });
	let time = 1000;
	const state: DockScrollState = { ownsDock: true, expanded: true, following: true,
		expandIntent: false, revealPending: false, geometryAt: time, growthAt: time };
	const changes: boolean[] = [];
	let bottomCalls = 0;
	const dispose = bindDockScroll({ scroll, dock, state: () => state,
		setExpanded: value => { state.expanded = value; changes.push(value); },
		scrollToBottom: () => { bottomCalls++; }, now: () => time });
	const fire = (target: HTMLElement, type: string, props: Record<string, unknown> = {}) => {
		const event = new window.Event(type, { bubbles: true, cancelable: true });
		Object.assign(event, props); target.dispatchEvent(event); return event;
	};
	const move = (top: number) => { scroll.scrollTop = top; fire(scroll, "scroll"); };
	const wheel = (target = scroll, deltaY = -180, props = {}) => fire(target, "wheel", { deltaX: 0, deltaY, deltaMode: 0, ...props });
	return { scroll, dock, state, changes, fire, move, wheel, dispose, bottomCalls: () => bottomCalls,
		tick: (ms: number) => { time += ms; }, grow: () => { state.growthAt = time; } };
}

test("real wheel navigation collapses during growth despite the custom-target bottom flag", () => {
	const f = fixture();
	f.wheel(); f.grow(); f.move(220);
	assert.deepEqual(f.changes, [false]);
	assert.equal(f.state.following, true, "the misleading library flag does not block user input");
	f.grow(); f.move(220);
	assert.deepEqual(f.changes, [false], "later tokens do not reopen the dock");
	f.dispose();
});

test("growth and geometry movement without input retain their flicker protection", () => {
	const f = fixture(); f.state.following = false;
	f.move(220); f.grow(); f.move(210);
	assert.deepEqual(f.changes, []);
	f.tick(501); f.move(200);
	assert.deepEqual(f.changes, [false], "normal idle fold behavior remains"); f.dispose();
});

test("forwarded dock wheel folds immediately, internal question scrolling does not", () => {
	const f = fixture(); const child = f.dock.firstElementChild as HTMLElement;
	child.style.overflowY = "auto"; child.scrollTop = 50;
	Object.defineProperties(child, { scrollHeight: { value: 400 }, clientHeight: { value: 100 } });
	f.wheel(child); assert.equal(f.scroll.scrollTop, 400); assert.deepEqual(f.changes, []);
	child.scrollTop = 0; f.wheel(child); f.fire(f.scroll, "scroll");
	assert.equal(f.scroll.scrollTop, 220); assert.deepEqual(f.changes, [false]); f.dispose();
});

test("keyboard, touch and scrollbar navigation also bypass token-growth muting", () => {
	for (const kind of ["keyboard", "touch", "scrollbar"]) {
		const f = fixture();
		if (kind === "keyboard") f.fire(f.scroll, "keydown", { key: "PageUp" });
		if (kind === "touch") { f.fire(f.scroll, "touchstart", { touches: [{ clientY: 100 }] }); f.fire(f.scroll, "touchmove", { touches: [{ clientY: 280 }] }); }
		if (kind === "scrollbar") { f.fire(f.scroll, "pointerdown"); f.tick(1000); }
		f.grow(); f.move(200); assert.deepEqual(f.changes, [false], kind); f.dispose();
	}
});

test("typing and modified wheel controls do not arm transcript navigation", () => {
	for (const kind of ["typing", "ctrl-wheel", "horizontal"]) {
		const f = fixture();
		if (kind === "typing") { const input = f.scroll.ownerDocument.createElement("input"); f.scroll.append(input); f.fire(input, "keydown", { key: "ArrowUp" }); }
		if (kind === "ctrl-wheel") f.wheel(f.scroll, -180, { ctrlKey: true });
		if (kind === "horizontal") f.wheel(f.scroll, -10, { deltaX: 100 });
		f.move(200); assert.deepEqual(f.changes, [], kind); f.dispose();
	}
});

test("manual navigation can interrupt an explicit reveal, and stale input expires", () => {
	const f = fixture(); f.state.expandIntent = true;
	f.wheel(); f.move(200); assert.deepEqual(f.changes, [false]);
	f.state.expanded = true; f.tick(501); f.grow(); f.move(180);
	assert.deepEqual(f.changes, [false]); f.dispose();
});

test("explicit reveal and new submission discard earlier wheel intent", () => {
	for (const event of [RESPONSE_BOTTOM_EVENT, RESPONSE_START_EVENT, DOCK_REVEAL_EVENT]) {
		const f = fixture(); f.move(200); f.wheel(f.scroll, 100); f.move(250);
		assert.deepEqual(f.changes, [false]);
		f.fire(f.scroll, event); f.state.expanded = true; f.state.expandIntent = true;
		f.move(270); assert.deepEqual(f.changes, [false], "same-direction programmatic reveal does not fold again");
		f.wheel(); f.move(100); assert.deepEqual(f.changes, [false, false], "new input can still interrupt");
		f.dispose();
	}
});

test("wheel at the bottom and nested transcript wheel cannot authorize token catch-up", () => {
	for (const nested of [false, true]) {
		const f = fixture();
		if (nested) {
			const code = f.scroll.ownerDocument.createElement("pre"); f.scroll.append(code);
			code.style.overflowY = "auto"; code.scrollTop = 50;
			Object.defineProperties(code, { scrollHeight: { value: 400 }, clientHeight: { value: 100 } });
			f.move(200); f.wheel(code, 100);
		} else { f.wheel(f.scroll, 100); }
		Object.defineProperty(f.scroll, "scrollHeight", { value: 1400 }); f.grow();
		f.move(nested ? 220 : 420); assert.deepEqual(f.changes, [], nested ? "nested wheel" : "bottom wheel");
		f.dispose();
	}
});

test("plain-text contenteditable navigation keys do not arm scrolling", () => {
	const f = fixture(); const editor = f.scroll.ownerDocument.createElement("div");
	editor.setAttribute("contenteditable", "plaintext-only"); f.scroll.append(editor);
	f.fire(editor, "keydown", { key: "PageUp" }); f.move(200); assert.deepEqual(f.changes, []); f.dispose();
});

test("nested transcript key and touch scrolling cannot arm the transcript", () => {
	for (const kind of ["keyboard", "touch"]) {
		const f = fixture(); const code = f.scroll.ownerDocument.createElement("pre"); f.scroll.append(code);
		code.style.overflowY = "auto"; code.scrollTop = 50;
		Object.defineProperties(code, { scrollHeight: { value: 400 }, clientHeight: { value: 100 } });
		f.move(200);
		if (kind === "keyboard") f.fire(code, "keydown", { key: "PageDown" });
		else { f.fire(code, "touchstart", { touches: [{ clientY: 100 }] }); f.fire(code, "touchmove", { touches: [{ clientY: 50 }] }); }
		Object.defineProperty(f.scroll, "scrollHeight", { value: 1400 }); f.grow(); f.move(220);
		assert.deepEqual(f.changes, [], kind); f.dispose();
	}
});

test("manual bottom navigation reopens a revealed dock during growth, preserving invitation gates", () => {
	for (const revealPending of [false, true]) {
		const f = fixture(); f.state.expanded = false; f.state.revealPending = revealPending; f.move(200);
		f.wheel(f.scroll, 200); f.grow(); f.move(400);
		assert.deepEqual(f.changes, revealPending ? [] : [true]);
		assert.equal(f.bottomCalls(), revealPending ? 0 : 1); f.dispose();
	}
});

test("small peeks and non-dock sessions do not collapse", () => {
	const f = fixture(); f.wheel(); f.move(350); assert.deepEqual(f.changes, []);
	f.state.ownsDock = false; f.move(100); assert.deepEqual(f.changes, []); f.dispose();
});

test("cleanup removes scroll, input and forwarded-wheel handlers", () => {
	const f = fixture(); f.dispose(); f.wheel(); f.move(100); f.wheel(f.dock);
	assert.deepEqual(f.changes, []); assert.equal(f.scroll.scrollTop, 100);
});

test("practice reopening uses the same hold-releasing reveal handler as questions", () => {
	const source = readFileSync(new URL("../components/chat.tsx", import.meta.url), "utf8");
	assert.match(source, /<PracticeDock[\s\S]*?onExpand=\{expandAndReveal\}/);
	assert.match(source, /<PluginProblemDock[^>]*onExpand=\{expandAndReveal\}/);
	assert.match(source, /const suppressFoldDuringReveal = \(\) => \{\s*scrollRef\.current\?\.dispatchEvent\(new Event\(DOCK_REVEAL_EVENT\)\)/);
	assert.match(source, /const expandAndReveal = \(\) => \{\s*scrollRef\.current\?\.dispatchEvent\(new Event\(RESPONSE_BOTTOM_EVENT\)\)/);
});
