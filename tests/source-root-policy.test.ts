import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { resolveSourcePath, sourceSearchRoots } from "../src/agent/tools/fs-shared.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-source-boundary-"));
const course = path.join(root, "course-a");
const other = path.join(root, "course-b");
fs.mkdirSync(course); fs.mkdirSync(other);
fs.writeFileSync(path.join(course, "notes.md"), "COURSE_A_ONLY");
fs.writeFileSync(path.join(other, "notes.md"), "COURSE_B_NEVER_READ");
fs.symlinkSync(other, path.join(course, "escape"), process.platform === "win32" ? "junction" : "dir");
const prior = process.env.LH_SOURCE_ROOT;
process.env.LH_SOURCE_ROOT = course;
after(() => { if (prior === undefined) delete process.env.LH_SOURCE_ROOT; else process.env.LH_SOURCE_ROOT = prior; fs.rmSync(root, { recursive: true }); });
const open = { restricted: false, folders: [], unavailable: [] };

test("source access is closed without an explicit deployment library", () => {
	delete process.env.LH_SOURCE_ROOT;
	try { assert.throws(() => resolveSourcePath(path.join(course, "notes.md"), open), /LH_SOURCE_ROOT/); }
	finally { process.env.LH_SOURCE_ROOT = course; }
});

test("optional user-wide folders cannot widen the course boundary", () => {
	const broad = { restricted: true, folders: [root, other], unavailable: [] };
	assert.deepEqual(sourceSearchRoots(undefined, broad).roots, [fs.realpathSync(course)]);
	assert.equal(resolveSourcePath("notes.md", broad), path.join(fs.realpathSync(course), "notes.md"));
	for (const value of [path.join(other, "notes.md"), "../course-b/notes.md", "escape/notes.md", "~/.codex/auth.json"]) {
		assert.throws(() => resolveSourcePath(value, broad));
	}
});

test("another-course-only or empty folder policy denies rather than falling back", () => {
	assert.throws(() => sourceSearchRoots(undefined, { restricted: true, folders: [other], unavailable: [] }), /no accessible/);
	assert.throws(() => sourceSearchRoots(undefined, { restricted: true, folders: [], unavailable: [] }), /no accessible/);
});
