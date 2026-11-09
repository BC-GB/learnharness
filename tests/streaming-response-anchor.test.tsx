import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { createResponseAnchor } from "../components/streaming-response-anchor.tsx";

function fixture(atBottom = true) {
	const { document } = parseHTML("<html><body><main><article><p data-response-part-id='old'>Old lesson</p><div id='tail'></div></article></main></body></html>");
	const main = document.querySelector("main")!;
	const content = document.querySelector("article")!;
	const tail = document.getElementById("tail")!;
	let natural = 900;
	let calls = 0;
	main.scrollTop = 300;
	Object.defineProperty(main, "clientHeight", { value: 600 });
	main.getBoundingClientRect = () => ({ top: 50 } as DOMRect);
	content.getBoundingClientRect = () => ({ height: natural + (parseFloat(tail.style.height) || 0) } as DOMRect);
	main.scrollTo = ((options: ScrollToOptions) => { calls++; main.scrollTop = options.top!; }) as typeof main.scrollTo;
	const context = { scrollRef: { current: main }, contentRef: { current: content }, isAtBottom: atBottom,
		escapedFromLock: !atBottom, targetScrollTop: null, stopScroll() {} } as unknown as StickToBottomContext;
	const controller = createResponseAnchor(() => context, tail);
	const add = (id: string, text = "First line") => {
		const node = document.createElement("p"); node.dataset.responsePartId = id; node.textContent = text;
		node.getBoundingClientRect = () => ({ top: 650 - main.scrollTop + 50 } as DOMRect);
		content.insertBefore(node, tail); return node;
	};
	return { main, content, tail, context, controller, add, calls: () => calls, grow: (height: number) => { natural = height; controller.measure(); } };
}

test("fresh response snaps once, tokens consume tail, finish never jumps", () => {
	const f = fixture(); f.controller.update(false); f.controller.update(true);
	assert.ok(f.context.targetScrollTop, "hold begins before first token");
	const node = f.add("new"); f.controller.update(true);
	assert.equal(f.main.scrollTop, 634); assert.equal(f.calls(), 1);
	assert.equal(f.tail.style.height, "334px");
	node.textContent += " more tokens"; f.grow(1100); f.controller.update(true);
	assert.equal(f.tail.style.height, "134px"); assert.equal(f.main.scrollTop, 634);
	f.add("tool-followup"); f.controller.update(true); assert.equal(f.calls(), 1);
	f.controller.update(false); assert.equal(f.calls(), 1); assert.equal(f.context.targetScrollTop, null);
	assert.equal(f.tail.style.height, "134px", "short answer completion retains room instead of clamping");
	f.controller.bottom(); assert.equal(f.tail.style.height, "0px");
});

test("long response and user scrolling stay put while streaming", () => {
	const f = fixture(); f.controller.update(false); f.controller.update(true); f.add("new"); f.controller.update(true);
	f.main.scrollTop = 750; f.grow(2200); f.controller.update(true);
	assert.equal(f.tail.style.height, "0px"); assert.equal(f.calls(), 1);
	assert.equal(f.context.targetScrollTop!(1600, { scrollElement: f.main, contentElement: f.content }), 750);
	f.controller.bottom(); assert.equal(f.context.targetScrollTop, null);
	f.add("later"); f.controller.update(true); assert.equal(f.calls(), 1);
});

test("reading history, pre-token navigation, and live reattachment are never stolen", () => {
	for (const mode of ["history", "wheel", "reattach"]) {
		const f = fixture(mode !== "history");
		f.controller.update(mode === "reattach"); f.controller.update(true);
		if (mode === "wheel") f.controller.cancelPending();
		f.add("new"); f.controller.update(true); assert.equal(f.calls(), 0, mode);
		f.controller.dispose(); assert.equal(f.context.targetScrollTop, null);
	}
});

test("empty text waits, next turn can anchor inside the same assistant group", () => {
	const f = fixture(); f.controller.update(false); f.controller.update(true);
	const first = f.add("one", ""); f.controller.update(true); assert.equal(f.calls(), 0);
	first.textContent = "Now visible"; f.controller.update(true); assert.equal(f.calls(), 1);
	f.controller.update(false); f.controller.update(true); f.add("two"); f.controller.update(true);
	assert.equal(f.calls(), 2);
});

test("a new empty session holds its opening response instead of following tokens", () => {
 const f = fixture(); f.content.querySelector("p")!.remove();
 f.controller.update(true); f.add("opening"); f.controller.update(true);
 assert.equal(f.calls(), 1);
 f.grow(2400); f.controller.update(true); assert.equal(f.calls(), 1);
});
test("consecutive long replies anchor even while the previous reply is not at bottom", () => {
 const f = fixture(); f.controller.update(false); f.controller.update(true); f.add("one"); f.controller.update(true);
 f.grow(2400); f.context.isAtBottom = false; f.context.escapedFromLock = true;
 f.controller.onScroll(); // delayed event for our own snap must not cancel the next one
 f.controller.update(false); f.controller.update(true); f.add("two"); f.controller.update(true);
 assert.equal(f.calls(), 2);
});

test("actual scrolling while waiting or between replies suppresses the next snap", () => {
 for (const between of [false, true]) {
  const f = fixture(); f.controller.update(false); f.controller.update(true);
  if (between) { f.add("one"); f.controller.update(true); f.controller.update(false); }
  f.main.scrollTop = 100; f.controller.onScroll(); f.context.isAtBottom = false; f.context.escapedFromLock = true;
  f.controller.update(true); f.add("two"); f.controller.update(true);
  assert.equal(f.calls(), between ? 1 : 0);
 }
});


test("delayed Markdown DOM text anchors without needing another stream revision", () => {
 const f = fixture(); f.controller.update(false); f.controller.update(true);
 const passage = f.add("delayed", ""); f.controller.update(true); assert.equal(f.calls(), 0);
 passage.textContent = "Visible after the parent effect"; f.controller.refresh(); assert.equal(f.calls(), 1);
 f.controller.refresh(); assert.equal(f.calls(), 1);
});
