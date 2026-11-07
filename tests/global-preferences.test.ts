import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { after, test } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-global-prefs-")));
const root = path.join(scratch, "state"); const source = path.join(scratch, "source");
fs.mkdirSync(root); fs.mkdirSync(source);
process.env.LH_DATA_DIR = root; process.env.LH_SOURCE_ROOT = source;
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { addCourse, resolveCourse } = await import("../src/store/courses.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const { writeSettings, readSettings } = await import("../src/store/settings.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { initialiseGlobalPreferences } = await import("../src/store/global-preferences.ts");
const { GET: getSettings } = await import("../app/api/settings/route.ts");
const { GET: getPrompts } = await import("../app/api/settings/prompts/route.ts");
const { PUT: putSettings } = await import("../app/api/settings/[section]/route.ts");
const { readTool } = await import("../src/agent/tools/read.ts");
const { globalPreferencePath, globalPreferencesEnabled } = await import("../config.ts");
const { writeFileAtomicSync } = await import("../src/store/atomic-write.ts");

test("one global record, original prompt additions, and retained course guidance have separate boundaries", async () => {
	const segment = "shared/15-accuracy.md";
	writeSettings({ version: 1, appearance: { readingWidth: 960 }, general: { quizMechanics: { explain: false } }, agent: { prompts: { [segment]: true } }, privateCourseMarker: "DO_NOT_SHARE_UNKNOWN_DATA" });
	promptOverrides.writeOverride(segment, "LEGACY_COURSE_GUIDANCE");
	const courses = [resolveCourse(addCourse("Subject A").id), resolveCourse(addCourse("Subject B").id)];
	for (const [i, course] of courses.entries()) runInCourse(course, () => {
		writeSettings({ version: 1, appearance: { readingWidth: 720 + i * 40 }, agent: { prompts: { [segment]: true } } });
		promptOverrides.writeOverride(segment, `PRIVATE_COURSE_${i}`);
		fs.writeFileSync(path.join(course.sourceRoot!, "canary.md"), `MATERIAL_${i}`);
	});
	const originals = [path.join(root, "settings.json"), path.join(root, "prompts", ...segment.split("/")), ...courses.flatMap(c => [path.join(c.dataRoot, "settings.json"), path.join(c.dataRoot, "prompts", ...segment.split("/")), path.join(c.sourceRoot!, "canary.md")])];
	const bytes = originals.map(f => fs.readFileSync(f));
	assert.equal(globalPreferencesEnabled(), false);
	const migration = initialiseGlobalPreferences("GLOBAL_TEACHING_RULE");
	assert.equal(migration.created, true); assert.equal(migration.files.length, 2);
	assert.equal(globalPreferencesEnabled(), true);
	const record = readSettings()!;
	assert.equal(record.appearance?.readingWidth, 960);
	assert.equal(record.privateCourseMarker, undefined);
	assert.deepEqual(record.agent?.prompts, { "shared/10-voice.md": true });
	assert.equal(initialiseGlobalPreferences("DO_NOT_OVERWRITE").created, false);
	let previousSettings: unknown; let previousPromptView: unknown;
	const faux = createFauxCore({}); const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	for (const [i, course] of courses.entries()) {
		const response = await getSettings(new Request("http://test/api/settings?course=" + course.id));
		assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.scope, "global");
		if (previousSettings) assert.deepEqual(body, previousSettings); previousSettings = body;
		const promptView = await (await getPrompts(new Request("http://test/api/settings/prompts?course=" + course.id))).json();
		assert.ok(!JSON.stringify(promptView).includes("PRIVATE_COURSE"));
		assert.ok(!JSON.stringify(promptView).includes("LEGACY_COURSE_GUIDANCE"));
		if (previousPromptView) assert.deepEqual(promptView, previousPromptView); previousPromptView = promptView;
		await runInCourse(course, async () => {
			const teacher = createTeacherAgent(undefined, { engine });
			assert.ok(teacher.state.systemPrompt.includes("GLOBAL_TEACHING_RULE"));
			assert.ok(teacher.state.systemPrompt.includes(`PRIVATE_COURSE_${i}`));
			assert.ok(!teacher.state.systemPrompt.includes(`PRIVATE_COURSE_${1 - i}`));
			assert.ok(!teacher.state.systemPrompt.includes("LEGACY_COURSE_GUIDANCE"));
			await assert.rejects(() => readTool.execute("foreign", { path: path.join(courses[1 - i]!.sourceRoot!, "canary.md") }));
			const own = await readTool.execute("own", { path: "canary.md" });
			assert.ok(JSON.stringify(own).includes(`MATERIAL_${i}`));
		});
	}
	const changed = await putSettings(new Request("http://test/api/settings/appearance?course=" + courses[0]!.id, { method: "PUT", body: JSON.stringify({ readingWidth: 1040 }) }), { params: Promise.resolve({ section: "appearance" }) });
	assert.equal(changed.status, 200);
	runInCourse(courses[1]!, () => assert.equal(readSettings()?.appearance?.readingWidth, 1040));
	runInCourse(courses[1]!, () => {
		assert.throws(() => writeFileAtomicSync(path.join(courses[0]!.dataRoot, "chats", "foreign.json"), "bad"), /outside/);
		assert.throws(() => writeFileAtomicSync(path.join(root, "arbitrary.json"), "bad"), /outside/);
	});
	const added = resolveCourse(addCourse("New subject after migration").id);
	runInCourse(added, () => { assert.equal(readSettings()?.appearance?.readingWidth, 1040); assert.ok(!fs.existsSync(path.join(added.dataRoot, "settings.json"))); });
	for (const [i, file] of originals.entries()) assert.deepEqual(fs.readFileSync(file), bytes[i], "A global edit cannot rewrite old course data/guidance");
	assert.equal((await getSettings(new Request("http://test/api/settings?course=unknown"))).status, 404);
	for (const relative of ["../settings.json", "course-profiles/other/chats/x.json", "global-prompts/../../settings.json"]) assert.throws(() => globalPreferencePath(relative));
	if (process.platform !== "win32") {
		const file = globalPreferencePath("global-prompts/.additions/shared/10-voice.md");
		fs.unlinkSync(file); fs.symlinkSync(path.join(courses[0]!.dataRoot, "prompts", ...segment.split("/")), file);
		assert.throws(() => globalPreferencePath("global-prompts/.additions/shared/10-voice.md"));
	}
});
