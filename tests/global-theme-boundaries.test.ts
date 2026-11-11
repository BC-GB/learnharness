import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { after, test } from "node:test";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-global-themes-")));
process.env.LH_DATA_DIR = root;
fs.writeFileSync(path.join(root, "global-settings.json"), JSON.stringify({ version: 1 }));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { themeStore } = await import("../src/store/themes.ts");
const { DEFAULT_THEME } = await import("../src/core/themes.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const { sharedPreferencePath, sharedPreferenceFile } = await import("../src/runtime/global-preferences-path.ts");

test("themes are shared data-only preferences without granting other shared state paths", () => {
	const scopes = ["a", "b"].map(id => ({ id, name: id, dataRoot: path.join(root, "course-profiles", id), sourceRoot: undefined }));
	for (const scope of scopes) fs.mkdirSync(scope.dataRoot, { recursive: true });
	runInCourse(scopes[0]!, () => themeStore.writeTheme("mine", { ...DEFAULT_THEME, name: "Mine" }));
	runInCourse(scopes[1]!, () => {
		assert.equal(themeStore.readTheme("mine")?.name, "Mine");
		assert.deepEqual(themeStore.listThemes().map(t => t.id), ["mine"]);
		themeStore.deleteTheme("mine");
	});
	assert.equal(themeStore.readTheme("mine"), null);
	for (const relative of ["themes/../chats/a.json", "themes/nested/a.json", "themes/a.md", "chats/a.json", "course-profiles/a/settings.json"]) {
		assert.throws(() => sharedPreferencePath(root, relative), /Invalid global preference path/);
		assert.equal(sharedPreferenceFile(root, path.join(root, relative)), undefined);
	}
});

test("theme file and directory aliases cannot read, overwrite or delete course data", () => {
	const themes = path.join(root, "themes");
	const victim = path.join(root, "course-profiles", "a", "victim.json");
	const bytes = JSON.stringify({ ...DEFAULT_THEME, name: "Private course data" });
	fs.writeFileSync(victim, bytes);
	fs.symlinkSync(victim, path.join(themes, "aliased.json"));
	assert.equal(themeStore.readTheme("aliased"), null);
	assert.throws(() => themeStore.writeTheme("aliased", DEFAULT_THEME), /aliased paths/);
	assert.throws(() => themeStore.deleteTheme("aliased"), /aliased paths/);
	assert.equal(fs.readFileSync(victim, "utf8"), bytes);
	fs.unlinkSync(path.join(themes, "aliased.json"));
	fs.rmdirSync(themes);
	fs.symlinkSync(path.dirname(victim), themes, "junction");
	assert.deepEqual(themeStore.listThemes(), []);
	assert.equal(themeStore.readTheme("victim"), null);
	assert.throws(() => themeStore.writeTheme("victim", DEFAULT_THEME), /aliased paths/);
	assert.throws(() => themeStore.deleteTheme("victim"), /aliased paths/);
	assert.equal(fs.readFileSync(victim, "utf8"), bytes);
});
