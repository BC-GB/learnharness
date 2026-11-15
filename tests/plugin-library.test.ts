import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-plugin-library-")));
process.env.LH_DATA_DIR = path.join(root, "state"); process.env.LH_SOURCE_ROOT = path.join(root, "library");
fs.mkdirSync(process.env.LH_DATA_DIR); fs.mkdirSync(process.env.LH_SOURCE_ROOT);
const { createPluginLibrary } = await import("../src/server/plugin-library.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const { resolveCourse, addCourse } = await import("../src/store/courses.ts");
const { setFileAccessPolicy } = await import("../src/agent/tools/file-access.ts");
const a = resolveCourse("legacy"), b = resolveCourse(addCourse("Second subject").id);
for (const scope of [a, b]) fs.writeFileSync(path.join(scope.sourceRoot!, "Week01.md"), "CANARY_" + scope.id);
after(() => fs.rmSync(root, { recursive: true, force: true }));

test("plugin library remains bound to its activation across deferred calls and other courses", async () => {
	for (const scope of [a, b]) {
		const other = scope === a ? b : a;
		const api = runInCourse(scope, () => createPluginLibrary(new AbortController().signal));
		await runInCourse(other, async () => {
			await Promise.resolve(); const listed = await api.list({ pattern: "*.md" });
			assert.equal(listed.name, scope.name); assert.equal(listed.files[0]?.path, "Week01.md");
			const reading = api.read({ path: "Week01.md", limit: 7 }); assert.equal(reading.text, "CANARY_");
			assert.equal(api.read({ path: "Week01.md", offset: reading.nextOffset! }).text, scope.id);
			assert.throws(() => api.read({ path: path.join(other.sourceRoot!, "Week01.md") }));
			assert.throws(() => api.read({ path: "../Week01.md" }));
		});
	}
});
test("library denies leaf/parent aliases, hidden files, binary data and oversized reads", async () => runInCourse(a, async () => {
	fs.symlinkSync(b.sourceRoot!, path.join(a.sourceRoot!, "foreign"), "dir");
	fs.writeFileSync(path.join(a.sourceRoot!, ".private.md"), "hidden");
	fs.writeFileSync(path.join(a.sourceRoot!, "binary.md"), Buffer.from([65, 0, 66]));
	fs.writeFileSync(path.join(a.sourceRoot!, "large.md"), Buffer.alloc(512 * 1024 + 1, 65));
	const api = createPluginLibrary(new AbortController().signal);
	assert.throws(() => api.read({ path: "foreign/Week01.md" }));
	assert.throws(() => api.read({ path: ".private.md" }));
	assert.throws(() => api.read({ path: "binary.md" }));
	assert.throws(() => api.read({ path: "large.md" }));
	const rows = await api.list(); assert.ok(!rows.files.some(f => f.path.includes("foreign") || f.path.startsWith(".")));
	const bounded = await api.list({ limit: 1 }); assert.equal(bounded.files.length, 1); assert.equal(bounded.truncated, true);
}));
test("policy narrowing and activation cancellation still apply to captured library handles", async () => {
	const controller = new AbortController(), api = runInCourse(b, () => createPluginLibrary(controller.signal));
	setFileAccessPolicy(() => ({ restricted: true, folders: [a.sourceRoot!] }));
	try { assert.throws(() => api.read({ path: "Week01.md" })); await assert.rejects(api.list()); }
	finally { setFileAccessPolicy(() => ({ restricted: false, folders: [] })); }
	controller.abort(); assert.throws(() => api.read({ path: "Week01.md" })); assert.throws(() => api.list());
});
