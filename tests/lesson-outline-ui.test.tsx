import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OutlinePanel } from "../components/lesson-outline.tsx";

test("outline stays a plain navigation view, with no mastery, links, questions or hidden teaching payload", () => {
	const html = renderToStaticMarkup(<OutlinePanel view={{ enabled: true, available: true, busy: false, currentNode: "within", topics: [
		{ id: "panel", title: "Same units over time", items: [] },
		{ id: "within", title: "Within-unit changes", items: [{ id: "subtract", label: "Subtract the unit average", discussed: true, current: true }] },
	] }} />);
	assert.ok(html.includes('aria-label="Lesson outline"'));
	assert.ok(html.includes('aria-current="step"'));
	assert.ok(html.includes("Subtract the unit average"));
	for (const excluded of ["<a ", "<input", "score", "mastered", "question result", "sourceId"]) assert.ok(!html.includes(excluded), excluded);
});
