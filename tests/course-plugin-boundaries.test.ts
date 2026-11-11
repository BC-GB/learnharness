import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createCorePluginPreferences } from "../src/server/plugin-preferences.ts";
import { runInCourse, currentCourseId, type CourseScope } from "../src/runtime/course-context.ts";
import { registerPluginWorkerActivity, pluginWorkerActivities, abortPluginWorkerActivity } from "../src/server/plugin-worker-activity.ts";
import { createPluginAgentRecordStore } from "../src/store/plugin-agent-records.ts";
import { createPluginTaskRecordStore } from "../src/store/plugin-task-records.ts";

test("plugin activity and cancellation remain course-local across delayed callbacks", async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-courses-"));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const a: CourseScope = { id: `a-${path.basename(root)}`, name: "A", dataRoot: path.join(root, "a"), sourceRoot: undefined };
 const b: CourseScope = { ...a, id: `b-${path.basename(root)}`, name: "B", dataRoot: path.join(root, "b") };
 const controllerA = new AbortController(), controllerB = new AbortController();
 t.after(() => { runInCourse(a, () => controllerA.abort()); runInCourse(b, () => controllerB.abort()); });
 let cancelledA = 0, cancelledB = 0;
 const metadata = { id: "same-task", status: "running" as const, definitionId: "generate", model: { provider: "fixture", id: "fixture" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
 await Promise.all([
  runInCourse(a, async () => { const update = registerPluginWorkerActivity({ pluginId: "flashcards", pluginName: "A only", signal: controllerA.signal, cancel: () => { cancelledA++; } }); await Promise.resolve(); update(metadata); }),
  runInCourse(b, async () => { const update = registerPluginWorkerActivity({ pluginId: "flashcards", pluginName: "B only", signal: controllerB.signal, cancel: () => { cancelledB++; } }); await Promise.resolve(); update(metadata); }),
 ]);
 runInCourse(a, () => { assert.equal(pluginWorkerActivities().length, 1); assert.match(pluginWorkerActivities()[0]!.title, /A only/); assert.equal(abortPluginWorkerActivity("flashcards:same-task"), true); });
 assert.equal(cancelledA, 1); assert.equal(cancelledB, 0);
 runInCourse(b, () => { assert.equal(pluginWorkerActivities().length, 1); assert.match(pluginWorkerActivities()[0]!.title, /B only/); });
});

test("retained plugin stores cannot read another course after a scope switch", t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-stores-"));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const a: CourseScope = { id: `a-${path.basename(root)}`, name: "A", dataRoot: path.join(root, "a"), sourceRoot: undefined };
 const b: CourseScope = { ...a, id: `b-${path.basename(root)}`, dataRoot: path.join(root, "b") };
 const agents = runInCourse(a, () => createPluginAgentRecordStore(path.join(a.dataRoot, "agents")));
 const tasks = runInCourse(a, () => createPluginTaskRecordStore(path.join(a.dataRoot, "tasks")));
 runInCourse(b, () => {
  assert.throws(() => agents.get("same"), /outside the selected course/);
  assert.throws(() => agents.list(), /outside the selected course/);
  assert.throws(() => tasks.get("same"), /outside the selected course/);
  assert.throws(() => tasks.list(), /outside the selected course/);
 });
});


test("core preferences are shared but notifications run in their original course", t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-prefs-"));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const a: CourseScope = { id: `a-${path.basename(root)}`, name: "A", dataRoot: path.join(root, "a"), sourceRoot: undefined };
 const b: CourseScope = { ...a, id: `b-${path.basename(root)}`, dataRoot: path.join(root, "b") };
 const first = createCorePluginPreferences("drawing-pad", root)!;
 const second = createCorePluginPreferences("drawing-pad", root)!;
 const seen: string[] = [];
 t.after(first.subscribe(() => { seen.push(currentCourseId()); }));
 t.after(runInCourse(a, () => first.subscribe(() => { seen.push(currentCourseId()); })));
 t.after(runInCourse(b, () => second.subscribe(() => { seen.push(currentCourseId()); })));
 runInCourse(a, () => first.write({ version: 1, revision: 1, imageScale: 1 }));
 assert.deepEqual(second.read(), { version: 1, revision: 1, imageScale: 1 });
 assert.deepEqual(seen, ["legacy", a.id, b.id]);
 assert.equal(createCorePluginPreferences("unreviewed", root), undefined);
 assert.throws(() => first.write({ huge: "x".repeat(17000) }), /oversized/);
 assert.equal(fs.existsSync(a.dataRoot), false);
 assert.equal(fs.existsSync(b.dataRoot), false);
});
