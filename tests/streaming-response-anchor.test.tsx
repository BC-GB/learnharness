import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { createResponseAnchor, bindResponseAnchorEvents, RESPONSE_START_EVENT, RESPONSE_NAVIGATE_EVENT } from "../components/streaming-response-anchor.tsx";
import { bindDockScroll } from "../components/dock-scroll.ts";
import { scrollSessionTarget } from "../components/session-navigation.tsx";

function fixture(atBottom = true) {
	const { document, window } = parseHTML("<html><body><main><article><p data-response-part-id='old'>Old lesson</p><div id='tail'></div></article></main><aside></aside></body></html>");
	Object.assign(globalThis, { Event: window.Event, HTMLElement: window.HTMLElement, getComputedStyle: (el: HTMLElement) => ({ overflowY: el.style.overflowY || "visible" }) });
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
	const unbind = bindResponseAnchorEvents(main, controller);
	const unbindDock = bindDockScroll({ scroll: main, dock: document.querySelector("aside")!,
		state: () => ({ ownsDock: true, expanded: true, following: true, expandIntent: false, revealPending: false, geometryAt: Date.now(), growthAt: Date.now() }),
		setExpanded() {}, scrollToBottom() {},
	});
	const fire = (type: string, props: Record<string, unknown> = {}, target: HTMLElement = main) => {
		const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, props); target.dispatchEvent(event);
	};
	const move = (top: number) => { main.scrollTop = top; fire("scroll"); };
	const add = (id: string, text = "First line") => {
		const node = document.createElement("p"); if (text.trim()) node.dataset.responsePartId = id; node.textContent = text;
		node.getBoundingClientRect = () => ({ top: 650 - main.scrollTop + 50 } as DOMRect);
		content.insertBefore(node, tail); return node;
	};
	return { main, content, tail, context, controller, add, fire, move, dispose: () => { unbind(); unbindDock(); controller.dispose(); }, calls: () => calls, grow: (height: number) => { natural = height; controller.measure(); } };
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
 const f=fixture(false);f.move(100);f.controller.begin();f.controller.update(true);f.add("new");f.controller.update(true);
 assert.equal(f.calls(),1);
 f.grow(2400);f.controller.update(false);f.controller.begin();f.controller.update(true);f.add("second");f.controller.update(true);assert.equal(f.calls(),2);
});

test("passive and reattached streams never acquire a snap without a submission", () => {
 for(const initial of [false,true]){const f=fixture();f.controller.update(initial);f.add("new");f.controller.update(true);f.controller.update(false);assert.equal(f.calls(),0);assert.equal(f.context.targetScrollTop,null);}
});

test("actual wheel, keyboard, touch, scrollbar and source navigation cancel pending snap", () => {
 for(const kind of ["wheel", "keyboard", "body-keyboard", "touch", "scrollbar", "middle", "selection", "source", "dock-wheel"]){const f=fixture();f.fire(RESPONSE_START_EVENT);f.controller.update(true);
 if(kind === "wheel") f.fire("wheel", { deltaY: -100, deltaX: 0 });
 if(kind === "keyboard" || kind === "body-keyboard") f.fire("keydown", { key: "PageUp" }, kind === "body-keyboard" ? f.main.ownerDocument.body : f.main);
 if(kind === "touch") { f.fire("touchstart", { touches: [{ clientY: 100 }] }); f.fire("touchmove", { touches: [{ clientY: 200 }] }); }
 if(kind === "scrollbar") f.fire("pointerdown");
 if(kind === "middle") f.fire("pointerdown", { button: 1 }, f.content);
 if(kind === "selection") {
  Object.defineProperty(f.main.ownerDocument, "getSelection", { value: () => ({ isCollapsed: false, anchorNode: f.content.firstChild }) });
  f.fire("pointermove", { buttons: 1 }, f.content);
 }
 if(kind === "source") f.fire(RESPONSE_NAVIGATE_EVENT);
 if(kind === "dock-wheel") f.fire("wheel", { deltaY: -100, deltaX: 0, deltaMode: 0 }, f.main.ownerDocument.querySelector("aside")!);
 f.move(100);f.add("new");f.controller.update(true);assert.equal(f.calls(),0,kind);f.dispose();}
});

test("manual reading during tokens and explicit Bottom remain available", () => {
 const f=fixture();f.controller.begin();f.add("new");f.controller.update(true);
 f.move(750);f.grow(2200);f.controller.update(true);
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
 const f=fixture();f.controller.begin();f.controller.update(true);f.grow(850);f.move(249);
 f.add("answer-reply");f.controller.update(true);assert.equal(f.calls(),1);
});

test("layout movement away from the bottom cannot consume response intent", () => {
 for (const top of [180, 340]) {
  const f=fixture();f.fire(RESPONSE_START_EVENT);f.controller.update(true);f.grow(1100);f.move(top);
  f.add("answer-reply");f.controller.update(true);assert.equal(f.calls(),1);assert.equal(f.main.scrollTop,634);f.dispose();
 }
});

test("fresh session explicit intent does not depend on old bottom flags", () => {
 const f=fixture(false);f.content.querySelector("p")!.remove();f.controller.begin();f.controller.update(true);f.add("opening");f.controller.update(true);assert.equal(f.calls(),1);
});

test("queued pre-submit spring motion and stale escaped flags cannot cancel explicit intent", () => {
 const f=fixture();f.context.escapedFromLock=true;f.main.scrollTop+=5;f.controller.begin();f.move(f.main.scrollTop+5);f.add("short");f.controller.update(false);assert.equal(f.calls(),1);
});

test("failed submissions and disposal release their hold and cannot anchor later passive text", () => {
 for(const dispose of [false,true]){const f=fixture();f.controller.begin();if(dispose)f.controller.dispose();else f.controller.cancel();f.add("late");f.controller.update(true);assert.equal(f.calls(),0);assert.equal(f.context.targetScrollTop,null);}
});

test("nested scrolling, editable keys and modified wheel do not cancel a pending response", () => {
	for (const kind of ["nested", "editable", "modified", "outside"]) {
		const f=fixture();f.fire(RESPONSE_START_EVENT);f.controller.update(true);
		const target=f.main.ownerDocument.createElement("div");f.main.append(target);
		if(kind === "nested") {
			target.style.overflowY="auto";target.scrollTop=50;
			Object.defineProperties(target,{scrollHeight:{value:500},clientHeight:{value:100}});
			f.fire("wheel",{deltaY:-50,deltaX:0},target);
		} else if(kind === "editable") {
			target.setAttribute("contenteditable","plaintext-only");f.fire("keydown",{key:"ArrowUp"},target);
		} else if(kind === "outside") {
			f.main.ownerDocument.body.append(target);f.fire("keydown",{key:"PageUp"},target);
		} else f.fire("wheel",{deltaY:-50,deltaX:0,ctrlKey:true});
		f.move(200);f.add("response");f.controller.update(true);assert.equal(f.calls(),1,kind);f.dispose();
	}
});

test("source and find navigation cancel the pending snap explicitly", () => {
	const f=fixture();f.fire(RESPONSE_START_EVENT);const target=f.add("older-source");
	scrollSessionTarget(target,f.main,f.context);f.add("response");f.controller.update(true);
	assert.equal(f.calls(),1,"only the requested source jump runs");f.dispose();
});

test("event cleanup prevents a later submission from acquiring an anchor", () => {
	const f=fixture();f.dispose();f.fire(RESPONSE_START_EVENT);f.add("response");f.controller.update(true);
	assert.equal(f.calls(),0);
});
