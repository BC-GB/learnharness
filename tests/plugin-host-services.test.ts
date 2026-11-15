import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-plugin-services-")));
process.env.LH_DATA_DIR = path.join(root, "legacy"); fs.mkdirSync(process.env.LH_DATA_DIR);
process.env.LH_AUTH_FILE = path.join(root, "auth.json"); fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { createCoreHostServices, pluginHostServiceRunningCount } = await import("../src/server/plugin-host-services.ts");
const { runInCourse } = await import("../src/runtime/course-context.ts");
const { writeSettings, readSettings } = await import("../src/store/settings.ts");
const a = { id: "service-a", name: "Subject A", dataRoot: path.join(root, "a"), sourceRoot: undefined };
const b = { id: "service-b", name: "Subject B", dataRoot: path.join(root, "b"), sourceRoot: undefined };
for (const scope of [a, b]) fs.mkdirSync(scope.dataRoot);
test("host grants only reviewed configuration keys, captures the course and retains the real model fallback", async () => {
 const controller = new AbortController();
 const api = runInCourse(a, () => {
  writeSettings({ version: 1, general: { lessonOutline: false, autoUpdate: false }, agent: { models: { extractor: { model: { provider: "offline", id: "original-background" }, thinkingLevel: "high" } } } });
  return createCoreHostServices("lesson-outline", controller.signal);
 });
 const before = fs.readFileSync(path.join(a.dataRoot, "settings.json"));
 await runInCourse(b, async () => {
  writeSettings({ version: 1, general: { lessonOutline: false } }); await Promise.resolve();
  assert.deepEqual(api.course, { id: a.id, name: a.name });
  assert.equal(api.configuration!.read().models.background?.id, "original-background");
  assert.deepEqual(fs.readFileSync(path.join(a.dataRoot, "settings.json")), before, "reads never migrate settings");
  assert.throws(() => api.configuration!.write({ agent: { tools: {} } }), /unavailable/);
  assert.throws(() => api.configuration!.write({ lessonOutline: "yes" }), /boolean/);
  api.configuration!.write({ lessonOutline: true }); assert.equal(readSettings()?.general?.lessonOutline, false);
 });
 runInCourse(a, () => { assert.equal(readSettings()?.general?.lessonOutline, true); assert.equal(readSettings()?.general?.autoUpdate, false); assert.equal(readSettings()?.agent?.models?.extractor?.model?.id, "original-background"); });
 controller.abort(); assert.throws(() => api.configuration!.write({ lessonOutline: false }));
 runInCourse(a, () => assert.equal(readSettings()?.general?.lessonOutline, true));
 for (const id of ["learning-path", "response-notifications", "unreviewed"]) {
  const restricted = runInCourse(a, () => createCoreHostServices(id, new AbortController().signal));
  assert.equal(restricted.configuration, undefined); assert.equal(restricted.promptEditor, undefined);
 }
 const prefs = runInCourse(a, () => createCoreHostServices("learning-preferences", new AbortController().signal));
 assert(prefs.promptEditor); assert.throws(() => prefs.configuration!.write({ lessonOutline: true }), /unavailable/);
});
test("background admission remains visible to maintenance throughout deferred work and releases on failure", async () => runInCourse(a, async () => {
 const api = createCoreHostServices("lesson-outline", new AbortController().signal);
 let release!: () => void; const blocked = new Promise<void>(done => { release = done; });
 const pending = api.admission!.run(new AbortController().signal, async () => { await blocked; throw Error("synthetic failure"); });
 assert.equal(pluginHostServiceRunningCount(), 1); release(); await assert.rejects(pending, /synthetic failure/); assert.equal(pluginHostServiceRunningCount(), 0);
}));
