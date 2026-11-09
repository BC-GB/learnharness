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
	Object.defineProperty(main, "scrollHeight", { get: () => natural + (parseFloat(tail.style.height) || 0) });
	main.getBoundingClientRect = () => ({ top: 50 } as DOMRect);
	content.getBoundingClientRect = () => ({ height: natural + (parseFloat(tail.style.height) || 0) } as DOMRect);
	main.scrollTo = ((options: ScrollToOptions) => { calls++; main.scrollTop = options.top!; }) as typeof main.scrollTo;
	const context = { scrollRef: { current: main }, contentRef: { current: content }, isAtBottom: atBottom,
		escapedFromLock: !atBottom, state: { isAtBottom: atBottom }, targetScrollTop: null, stopScroll() { context.state.isAtBottom = false; context.escapedFromLock = true; } } as unknown as StickToBottomContext;
	const controller = createResponseAnchor(() => context, tail);
	const add = (id: string, text = "First line") => {
		const node = document.createElement("p"); if (text.trim()) node.dataset.responsePartId = id; node.textContent = text;
		node.getBoundingClientRect = () => ({ top: 650 - main.scrollTop + 50 } as DOMRect);
		content.insertBefore(node, tail); return node;
	};
	return { main, content, tail, context, controller, add, calls: () => calls, grow: (height: number) => { natural = height; controller.measure(); } };
}


test("explicit reply snaps once, consumes reserve, and finishes without moving", () => {
 const f = fixture(); f.controller.begin(); f.controller.update(true);
 const node=f.add("new"); f.controller.update(true);
 assert.equal(f.main.scrollTop,634); assert.equal(f.calls(),1); assert.equal(f.tail.style.height,"334px");
 node.textContent += " more";f.grow(1100);f.controller.update(true);assert.equal(f.tail.style.height,"134px");assert.equal(f.calls(),1);
 f.add("provider-followup");f.controller.update(true);assert.equal(f.calls(),1);
 f.controller.update(false);assert.equal(f.main.scrollTop,634);assert.equal(f.tail.style.height,"134px");assert.equal(f.context.targetScrollTop,null);
});

test("explicit new submissions intentionally anchor even from earlier reading positions", () => {
 const f=fixture(false);f.main.scrollTop=100;f.controller.onScroll();f.controller.begin();f.controller.update(true);f.add("new");f.controller.update(true);
 assert.equal(f.calls(),1);
 f.grow(2400);f.controller.update(false);f.controller.begin();f.controller.update(true);f.add("second");f.controller.update(true);assert.equal(f.calls(),2);
});

test("passive and reattached streams never acquire a snap without a submission", () => {
 for(const initial of [false,true]){const f=fixture();f.controller.update(initial);f.add("new");f.controller.update(true);f.controller.update(false);assert.equal(f.calls(),0);assert.equal(f.context.targetScrollTop,null);}
});

test("manual navigation after submit cancels pending snap", () => {
 for(const wheel of [false,true]){const f=fixture();f.controller.begin();f.controller.update(true);
 if(wheel)f.controller.cancelPending();else{f.main.scrollTop=100;f.controller.onScroll();}
 f.add("new");f.controller.update(true);assert.equal(f.calls(),0);}
});

test("manual reading during tokens and explicit Bottom remain available", () => {
 const f=fixture();f.controller.begin();f.add("new");f.controller.update(true);
 f.main.scrollTop=750;f.controller.onScroll();f.grow(2200);f.controller.update(true);
 assert.equal(f.calls(),1);assert.equal(f.tail.style.height,"0px");assert.equal(f.context.targetScrollTop!(1600,{scrollElement:f.main,contentElement:f.content}),750);
 f.controller.bottom();assert.equal(f.context.targetScrollTop,null);assert.equal(f.tail.style.height,"0px");f.add("later");f.controller.update(true);assert.equal(f.calls(),1);
});

test("empty source waits, then the source-ready wrapper anchors before Markdown renders", () => {
 const f=fixture();f.controller.begin();f.controller.update(true);const p=f.add("new","");f.controller.update(true);assert.equal(f.calls(),0);
 p.dataset.responsePartId="new";f.controller.update(true);assert.equal(f.calls(),1);
 p.textContent="Deferred Markdown appeared";f.controller.update(true);assert.equal(f.calls(),1);
});

test("single-chunk terminal reply consumes only its existing explicit intent", () => {
 const f=fixture();f.controller.begin();f.controller.update(true);const p=f.add("terminal","Ready source");p.textContent="";
 f.controller.update(false);assert.equal(f.calls(),1);p.textContent="Rendered later";f.controller.update(false);assert.equal(f.calls(),1);assert.equal(f.context.targetScrollTop,null);
});

test("question-to-composer bottom clamp is layout, not manual navigation", () => {
 const f=fixture();f.controller.begin();f.controller.update(true);f.grow(850);f.main.scrollTop=249;f.controller.onScroll();
 f.add("answer-reply");f.controller.update(true);assert.equal(f.calls(),1);
});

test("actual movement away from a shrunken bottom still cancels", () => {
 const f=fixture();f.controller.begin();f.controller.update(true);f.grow(850);f.main.scrollTop=180;f.controller.onScroll();
 f.add("answer-reply");f.controller.update(true);assert.equal(f.calls(),0);
});

test("fresh session explicit intent does not depend on old bottom flags", () => {
 const f=fixture(false);f.content.querySelector("p")!.remove();f.controller.begin();f.controller.update(true);f.add("opening");f.controller.update(true);assert.equal(f.calls(),1);
});

test("queued pre-submit spring motion and stale escaped flags cannot cancel explicit intent", () => {
 const f=fixture();f.context.escapedFromLock=true;f.main.scrollTop+=5;f.controller.begin();f.controller.onScroll();f.add("short");f.controller.update(false);assert.equal(f.calls(),1);
});

test("failed submissions and disposal release their hold and cannot anchor later passive text", () => {
 for(const dispose of [false,true]){const f=fixture();f.controller.begin();if(dispose)f.controller.dispose();else f.controller.cancel();f.add("late");f.controller.update(true);assert.equal(f.calls(),0);assert.equal(f.context.targetScrollTop,null);}
});
