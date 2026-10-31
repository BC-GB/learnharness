import assert from "node:assert/strict";
import { test } from "node:test";
import { runPdfReaderAgent } from "../src/agent/subagents/pdf-reader.ts";
test("PDF jobs fail explicitly without resolving files or calling a model", async () => {
 let calls = 0;
 const result = await runPdfReaderAgent({ path: "/unapproved/secret.pdf", question: "read" }, { onUsage: () => { calls++; } });
 assert.match(result.brief, /PDF processing is disabled/);
 assert.deepEqual(result.pagesConsulted, []);
 assert.deepEqual(result.pagesRead, []);
 assert.equal(calls, 0);
});
