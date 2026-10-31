import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePageSpec, pdfExtract, pdfInfo, pdfProbe, pdfSearch } from "../src/agent/subagents/pdf-ops.ts";
describe("PDF policy", () => {
 it("rejects every parser entry before opening a document", async () => {
  for (const operation of [() => pdfProbe("missing.pdf"), () => pdfInfo("missing.pdf"), () => pdfExtract("missing.pdf", "all"), () => pdfSearch("missing.pdf", "(a+)+$")]) {
   await assert.rejects(operation(), /PDF processing is disabled/);
  }
 });
	it("parsePageSpec: all / ranges / lists / clamping", () => {
		assert.deepEqual(parsePageSpec("all", 3), [1, 2, 3]);
		assert.deepEqual(parsePageSpec("1-5", 3), [1, 2, 3]);
		assert.deepEqual(parsePageSpec("1,3,7", 3), [1, 3]);
		assert.deepEqual(parsePageSpec("3", 3), [3]);
		assert.deepEqual(parsePageSpec(" 2 , 1 ", 3), [1, 2]);
	});
});


it("upstream upload converter remains disabled", async () => {
	const { convertPdf } = await import("../src/agent/subagents/pdf-ops.ts");
	await assert.rejects(convertPdf(new Uint8Array([37, 80, 68, 70, 45]), 1000), /disabled/);
});
