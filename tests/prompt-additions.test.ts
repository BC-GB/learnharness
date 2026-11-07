import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import { composePromptSegment } from "../src/core/prompt-segments.ts";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-prompt-additions-")));
process.env.LH_DATA_DIR = path.join(scratch, "data");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const { promptCustomizationFile, readPromptCustomization } = await import("../src/runtime/prompt-customizations.ts");
const { effectivePromptSegments } = await import("../src/agent/prompt-segments.ts");
const { composeInstructions, createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { PUT, DELETE } = await import("../app/api/settings/prompts/[...segment]/route.ts");
const { PUT: settingsPUT } = await import("../app/api/settings/[section]/route.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const segment = "shared/15-accuracy.md";
function put(body: unknown, key = segment) { return PUT(new Request("http://test/api/settings/prompts/" + key, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ segment: key.split("/") }) }); }

test("preview and runtime retain the entire original before the addition", () => {
	const source = "original\nline two\n";
	assert.equal(composePromptSegment(source, "extra", "append"), source + "\n\nextra");
	assert.equal(composePromptSegment(source, " \n", "append"), source);
	assert.equal(composePromptSegment(source, "replacement", "replace"), "replacement");
	assert.equal(composePromptSegment("new upstream source", "extra", "append"), "new upstream source\n\nextra");
});

test("legacy replacements remain exact; additions preserve their files and switch off restores current source", () => {
	const defaults = Object.fromEntries((["teacher", "prober", "practice"] as const).map(kind => [kind, composeInstructions(kind)]));
	promptOverrides.writeOverride(segment, "LEGACY_REPLACEMENT");
	const originalFile = promptCustomizationFile(segment, "replace");
	const bytes = fs.readFileSync(originalFile);
	assert.equal(readPromptCustomization(segment)?.mode, "replace");
	assert.ok(composeInstructions("teacher", { [segment]: true }).includes("LEGACY_REPLACEMENT"));
	promptOverrides.writeOverride(segment, "APPENDED_MARKER", "append");
	assert.deepEqual(fs.readFileSync(originalFile), bytes, "Adding never edits the existing replacement or source");
	assert.deepEqual(promptOverrides.listOverrides(), [segment], "Two physical files remain one logical segment");
	for (const kind of ["teacher", "prober", "practice"] as const) {
		const part = effectivePromptSegments(kind, { [segment]: true }).find(row => row.path === segment)!;
		assert.equal(part.mode, "append");
		const composed = composeInstructions(kind, { [segment]: true });
		assert.ok(composed.includes(part.sourceText.trim()));
		assert.equal(composed.split("APPENDED_MARKER").length, 2);
		assert.ok(composed.indexOf(part.sourceText.trim()) < composed.indexOf("APPENDED_MARKER"));
		assert.ok(!composed.includes("LEGACY_REPLACEMENT"));
		assert.equal(composeInstructions(kind, {}), defaults[kind]);
	}
	const faux = createFauxCore({});
	const agent = createTeacherAgent(undefined, { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, promptSwitches: { [segment]: true } });
	assert.ok(agent.state.systemPrompt.includes("APPENDED_MARKER"));
	promptOverrides.writeOverride(segment, "EXPLICIT_REPLACEMENT", "replace");
	assert.equal(readPromptCustomization(segment)?.mode, "replace");
	assert.ok(!fs.existsSync(promptCustomizationFile(segment, "append")));
	promptOverrides.deleteOverride(segment);
});

test("routes round-trip mode, validate before writing, and clear both files and the switch on delete", async () => {
	assert.equal((await put({ text: "legacy" })).status, 200);
	assert.equal(readPromptCustomization(segment)?.mode, "replace");
	const addition = await put({ text: "extra", mode: "append" });
	assert.equal(addition.status, 200); assert.equal((await addition.json()).mode, "append");
	assert.equal(effectivePromptSegments("teacher", {}).find(row => row.path === segment)!.enabled, false);
	for (const mode of [null, "insert", "APPEND", {}, true]) assert.equal((await put({ text: "bad", mode })).status, 400);
	assert.deepEqual(readPromptCustomization(segment), { text: "extra", mode: "append" });
	for (const key of ["../system-prompt.md", "shared/%bad.md", "shared/99-no-such-source.md"]) assert.equal((await put({ text: "bad", mode: "append" }, key)).status, 400);
	const enabled = await settingsPUT(new Request("http://test/api/settings/agent", { method: "PUT", body: JSON.stringify({ prompts: { [segment]: true } }) }), { params: Promise.resolve({ section: "agent" }) });
	assert.equal(enabled.status, 200);
	const deleted = await DELETE(new Request("http://test/api/settings/prompts", { method: "DELETE" }), { params: Promise.resolve({ segment: segment.split("/") }) });
	assert.equal(deleted.status, 200); assert.equal((await deleted.json()).switchCleared, true);
	assert.equal(readPromptCustomization(segment), null); assert.deepEqual(promptOverrides.listOverrides(), []);
});

test("additions are course-scoped across delayed work and aliases fail closed", async () => {
	const a = { id: "prompt-addition-a", name: "A", dataRoot: path.join(scratch, "a"), sourceRoot: undefined };
	const b = { id: "prompt-addition-b", name: "B", dataRoot: path.join(scratch, "b"), sourceRoot: undefined };
	fs.mkdirSync(a.dataRoot); fs.mkdirSync(b.dataRoot);
	await runInCourse(a, async () => {
		promptOverrides.writeOverride(segment, "COURSE_A", "append");
		await Promise.resolve();
		assert.equal(readPromptCustomization(segment)?.text, "COURSE_A");
	});
	runInCourse(b, () => {
		assert.equal(readPromptCustomization(segment), null);
		promptOverrides.writeOverride(segment, "COURSE_B", "append");
		assert.ok(!composeInstructions("teacher", { [segment]: true }).includes("COURSE_A"));
	});
	runInCourse(a, () => assert.equal(readPromptCustomization(segment)?.text, "COURSE_A"));
	if (process.platform !== "win32") runInCourse(a, () => {
		promptOverrides.deleteOverride(segment);
		promptOverrides.writeOverride(segment, "OLD_REPLACEMENT");
		const target = promptCustomizationFile(segment, "append");
		fs.symlinkSync(path.join(b.dataRoot, "prompts", ".additions", ...segment.split("/")), target);
		assert.equal(readPromptCustomization(segment), null, "A denied addition cannot reactivate an old replacement");
		assert.ok(!composeInstructions("teacher", { [segment]: true }).includes("OLD_REPLACEMENT"));
	});
});
