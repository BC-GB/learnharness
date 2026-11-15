import assert from "node:assert/strict";
import { test } from "node:test";
import { createPluginLearningData, type PluginLearningDeps } from "../src/server/plugin-learning.ts";
import { currentCourseId, runInCourse } from "../src/runtime/course-context.ts";
test("native learning reads keep the activation course, including an unbound legacy activation and deferred snapshots", async () => {
 let readFrom = "";
 const deps = { directory: "/synthetic", chatStore: { listChats: () => { readFrom = currentCourseId(); return []; }, getChat: () => { readFrom = currentCourseId(); return null; } }, graphStore: { readNodes: () => { readFrom = currentCourseId(); return []; } }, readMetadata: () => null, isBusy: () => false, isCompacting: () => false } as unknown as PluginLearningDeps;
 const a = { id: "binding-a", name: "A", dataRoot: "/synthetic/a", sourceRoot: undefined }, b = { id: "binding-b", name: "B", dataRoot: "/synthetic/b", sourceRoot: undefined };
 const legacy = createPluginLearningData(deps), selected = runInCourse(a, () => createPluginLearningData(deps));
 await runInCourse(b, async () => {
  await Promise.resolve(); selected.getSession("native"); assert.equal(readFrom, a.id);
  selected.getSessionSnapshot!("native"); assert.equal(readFrom, a.id);
  selected.listSessions(); assert.equal(readFrom, a.id); selected.readGraphFile("nodes.jsonl"); assert.equal(readFrom, a.id);
  legacy.getSession("native"); assert.equal(readFrom, "legacy"); legacy.getSessionSnapshot!("native"); assert.equal(readFrom, "legacy");
 });
});
