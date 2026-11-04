import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runPdfReaderAgent } from "../src/agent/subagents/pdf-reader.ts";
test("PDF jobs check source admission and fail closed without the isolated parser", async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-pdf-admission-"));
 const priorRoot = process.env.LH_SOURCE_ROOT;
 const priorRenderer = process.env.LH_ISOLATED_RENDERER;
 process.env.LH_SOURCE_ROOT = root;
 delete process.env.LH_ISOLATED_RENDERER;
 let calls = 0;
 try {
  for (const [file, expected] of [[path.join(root, "unopened.pdf"), /PDF processing is disabled/], [path.join(root, "..", "unapproved.pdf"), /Access denied/]] as const) {
   const result = await runPdfReaderAgent({ path: file, question: "read" }, { onUsage: () => { calls++; } });
   assert.match(result.brief, expected);
   assert.deepEqual(result.pagesConsulted, []);
   assert.deepEqual(result.pagesRead, []);
  }
  assert.equal(calls, 0);
 } finally {
  if (priorRoot === undefined) delete process.env.LH_SOURCE_ROOT; else process.env.LH_SOURCE_ROOT = priorRoot;
  if (priorRenderer === undefined) delete process.env.LH_ISOLATED_RENDERER; else process.env.LH_ISOLATED_RENDERER = priorRenderer;
  fs.rmSync(root, { recursive: true });
 }
});
