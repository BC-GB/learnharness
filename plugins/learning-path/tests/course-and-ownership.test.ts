import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHost } from "./host.ts";
import { openLearningPathStore } from "../src/store.ts";

test("Architect uses the host course library and never adds native instructions", async t => {
  const host = createHost(); t.after(() => host.close());
  host.ctx.library = {
    list: async () => ({ name: "Selected course", files: [{ path: "Week01.md", name: "Week01.md", bytes: 20 }], truncated: false }),
    read: input => { assert.equal(input.path, "Week01.md"); return { path: input.path, text: "COURSE_ONLY", offset: 0, nextOffset: null, characters: 11, sha256: "a".repeat(64) }; },
  };
  await host.call("architect.create", {});
  const definition = host.definitions.get("path-architect")!;
  assert.equal(host.instructions.length, 0);
  const listing = definition.tools!.find(tool => tool.name === "list_course_materials")!;
  const reader = definition.tools!.find(tool => tool.name === "read_course_material")!;
  assert.ok("execute" in listing && typeof listing.execute === "function");
  const found = await listing.execute("list", {}, undefined); assert.match(JSON.stringify(found), /Week01.md/);
  assert.ok("execute" in reader && typeof reader.execute === "function");
  const read = await reader.execute("read", { path: "Week01.md" }, undefined); assert.match(JSON.stringify(read), /COURSE_ONLY/);
});
test("another create or send cannot change ownership while an Architect run is active", async t => {
  const host = createHost(); t.after(() => host.close());
  const a = await host.call<{ conversation: { id: string } }>("architect.create", {});
  const b = await host.call<{ conversation: { id: string } }>("architect.create", {});
  await host.call("architect.send", { id: a.conversation.id, text: "Design my path", requestId: "owner-a" });
  await assert.rejects(host.call("architect.create", {}), /running/);
  await assert.rejects(host.call("architect.send", { id: b.conversation.id, text: "Other path", requestId: "owner-b" }), /running/);
  await host.call("architect.abort", { id: b.conversation.id });
  await host.call("architect.abort", { id: a.conversation.id });
  const next = await host.call<{ conversation: { id: string } }>("architect.create", {}); assert.ok(next.conversation.id);
});
test("a symlinked sources parent is rejected before any source index or text is read", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lp-parent-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const own = path.join(root, "own"), other = path.join(root, "other"); fs.mkdirSync(own); fs.mkdirSync(other);
  fs.symlinkSync(other, path.join(own, "sources"), "dir");
  assert.throws(() => openLearningPathStore(own), /aliased/); assert.deepEqual(fs.readdirSync(other), []);
});
