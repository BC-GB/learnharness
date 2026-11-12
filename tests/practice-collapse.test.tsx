import React, { act, useState } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PracticeDock } from "../components/practice-dock.tsx";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });

test("collapse and reopen stay available while submission is busy and retain typed thinking", async () => {
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	let busy = false, submitted = 0;
	function Fixture() {
		const [expanded, setExpanded] = useState(true);
		return <PracticeDock problemCallId="problem" input={{ statement: "Practice problem" }} expanded={expanded}
			onExpand={() => setExpanded(true)} onCollapse={() => setExpanded(false)} preparing={busy}
			onSubmit={() => { submitted++; }} />;
	}
	try {
		await act(async () => root.render(<Fixture />));
		await act(async () => {
			const input = host.querySelector<HTMLElement>("[data-file-path-input]")!;
			input.textContent = "Unsubmitted working";
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		busy = true; await act(async () => root.render(<Fixture />));
		assert.ok(host.querySelector('[data-testid="practice-send"]')!.hasAttribute("disabled"));
		for (let count = 0; count < 2; count++) {
			const collapse = host.querySelector<HTMLButtonElement>('[data-testid="practice-collapse"]')!;
			assert.equal(collapse.hasAttribute("disabled"), false);
			assert.equal(collapse.closest("[data-dock-scroll-area]"), null, "long statements cannot hide the control in their inner scroll area");
			await act(async () => collapse.click());
			assert.ok(host.querySelector('[data-testid="practice-dock-bar"]'));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="practice-dock-bar"]')!.click());
			assert.equal(host.querySelector("[data-file-path-input]")!.textContent, "Unsubmitted working");
		}
		assert.equal(submitted, 0, "collapse is not a submission or abort");
	} finally { await act(async () => root.unmount()); host.remove(); }
});
