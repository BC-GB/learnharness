import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { QuestionDock } from "../components/question-dock.tsx";
import { forwardDockWheel } from "../components/dock-height.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document,
	HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

function wheel(target: Element, deltaY: number, timeStamp: number, extra = {}) {
	const event = new dom.window.Event("wheel", { bubbles: true, cancelable: true });
	Object.assign(event, { deltaY, deltaX: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
	Object.defineProperty(event, "timeStamp", { value: timeStamp });
	target.dispatchEvent(event);
	return event;
}

test("confidence wheel changes discrete stops only over its enabled row", async () => {
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	const transcript = document.createElement("div"); transcript.scrollTop = 100;
	Object.assign(globalThis, { getComputedStyle: () => ({ overflowY: "visible" }) });
	let bubbled = 0;
	host.addEventListener("wheel", (event) => { bubbled++; forwardDockWheel(event as WheelEvent, host, transcript); });
	try {
		await act(async () => root.render(<QuestionDock toolName="probe" toolCallId="wheel-q"
			input={{ question: "Choose", options: [{ label: "A" }, { label: "B" }], correctAnswer: "A", explanation: "A" }}
			expanded dictationClaim={false} onExpand={() => {}} onSubmit={() => {}} />));
		const row = host.querySelector('[data-testid="confidence-wheel-region"]')!;
		const slider = host.querySelector('[data-testid="confidence-slider"]')!;
		const value = () => host.querySelector('[data-testid="confidence-value"]')!.textContent;
		assert.equal(value(), "50%");
		await act(async () => { assert.equal(wheel(slider, -100, 1000).defaultPrevented, true); });
		assert.equal(value(), "70%"); assert.equal(bubbled, 0);
		assert.equal(transcript.scrollTop, 100, "confidence wheel does not move the transcript");
		await act(async () => { wheel(row, -1, 1010); });
		assert.equal(value(), "70%", "dense trackpad events do not race through stops");
		await act(async () => { wheel(row, 1, 1020); });
		assert.equal(value(), "50%", "direction reversal responds immediately");
		await act(async () => { for (let i = 0; i < 8; i++) wheel(row, -100, 1200 + i * 120); });
		assert.equal(value(), "100%", "upper limit clamps rather than wraps");
		await act(async () => { for (let i = 0; i < 8; i++) wheel(row, 100, 2400 + i * 120); });
		assert.equal(value(), "0%", "lower limit clamps rather than wraps");
		for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaX: 200 }]) {
			assert.equal(wheel(row, -100, 4000, extra).defaultPrevented, false);
		}
		assert.equal(value(), "0%");
		assert.equal(transcript.scrollTop, 100, "parent preserves zoom and horizontal gestures too");
		wheel(host, -20, 5000);
		assert.equal(transcript.scrollTop, 80, "outside keeps the normal dock scroll forwarding");
		const dontKnow = Array.from(host.querySelectorAll("button")).find(b => /don't know/i.test(b.textContent ?? ""));
		assert.ok(dontKnow);
		await act(async () => { dontKnow.click(); });
		wheel(row, -20, 6000);
		assert.equal(transcript.scrollTop, 60, "disabled confidence keeps normal scrolling");
		assert.equal(value(), "—");
		await act(async () => root.unmount());
		assert.equal(wheel(row, -100, 7000).defaultPrevented, false, "unmount removes listener");
	} finally { host.remove(); }
});
