import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OutlinePanel } from "../components/lesson-outline.tsx";

test("floating outline shows AI headings, current group and distinguishable encounter states", () => {
	const html = renderToStaticMarkup(<OutlinePanel view={{ enabled: true, available: true, busy: false, currentGroup: "models", focusGroup: "models", groups: [
		{ id: "basics", title: "Repeated observations", items: [{ id: "obs", label: "Same units", state: "discussed" }] },
		{ id: "models", title: "Comparing within a unit", items: [{ id: "subtract", label: "Subtract the unit average", state: "current" }, { id: "estimate", label: "Estimate using changes", state: "upcoming" }] },
	] }} />);
	assert.ok(html.includes('data-floating="true"')); assert.ok(html.includes("fixed")); assert.ok(!html.includes("shrink-0 overflow-y-auto border-l"));
	assert.ok(html.includes('aria-current="step"')); assert.ok(html.includes('data-state="upcoming"')); assert.ok(html.includes("Comparing within a unit"));
	assert.ok(html.includes("Minimize outline")); assert.ok(html.includes("Move outline")); assert.ok(html.includes("Subtract the unit average")); assert.ok(!html.includes(">Same units<"), "Other groups stay compact");
	for (const excluded of ["<a ", "<input", "score", "mastered", "question result", "sourceId"]) assert.ok(!html.includes(excluded), excluded);
});
