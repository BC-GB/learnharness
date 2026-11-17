import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { PdfReaderPageMemory } from "../src/agent/subagents/pdf-reader-context.ts";

const image = (page: number): Message => ({ role: "user", content: [{ type: "image", data: `page-${page}`, mimeType: "image/png" }], timestamp: page });

test("eight sequential scanned pages retain all observations and only the current owned image", () => {
 const memory = new PdfReaderPageMemory(); const task: Message = { role: "user", content: "original task", timestamp: 0 }; let messages: Message[] = [task];
 for (let page = 1; page <= 8; page++) {
  const receipt = page > 1 ? { page: page - 1, notes: `Question ${page - 1}: selected B; handwritten uncertainty.` } : undefined;
  const recorded = memory.recordBefore(page, receipt);
  if (recorded) messages.push({ role: "toolResult", toolCallId: String(page), toolName: "pdf_render", content: [{ type: "text", text: recorded }], isError: false, timestamp: page });
  messages = memory.attach(messages, image(page), page); assert.equal(memory.confirmDelivery(), page);
  const visible = messages.filter(m => m.role === "user" && Array.isArray(m.content) && m.content.some(c => c.type === "image"));
  assert.equal(visible.length, 1); assert.ok(messages.includes(task));
 }
 const partial = memory.partialBrief("later request failed");
 for (let page = 1; page <= 7; page++) assert.ok(partial.includes(`Question ${page}: selected B`));
 assert.ok(!partial.includes("Question 8:"), "do not invent notes for the last page");
});

test("missing, wrong-page and oversized observations cannot discard a viewed image", () => {
 const memory = new PdfReaderPageMemory(); const current = image(1); let messages = memory.attach([], current, 1);
 assert.throws(() => memory.recordBefore(2, { page: 1, notes: "not yet seen" }), /Read the current/);
 assert.throws(() => memory.attach(messages, image(2), 2), /recorded observations/);
 memory.confirmDelivery();
 for (const receipt of [undefined, { page: 2, notes: "wrong page" }, { page: 1, notes: "" }, { page: 1, notes: "x".repeat(4097) }, { page: 1, notes: "界".repeat(1400) }]) assert.throws(() => memory.recordBefore(2, receipt));
 assert.ok(messages.includes(current)); assert.equal(memory.partialBrief("failed"), "PDF failed: failed");
 memory.recordBefore(2, { page: 1, notes: "Observed selected C (p. 1)." });
 assert.equal(memory.recordBefore(2, undefined), "", "a failed next-page render can reuse its already recorded notes");
 messages = memory.attach(messages, image(2), 2); assert.ok(!messages.includes(current));
 assert.match(memory.partialBrief("next page failed"), /Observed selected C/);
});

test("only the reader-owned image message is replaced; other messages remain byte-identical", () => {
 const memory = new PdfReaderPageMemory(); const unrelated = image(99); const before = JSON.stringify(unrelated);
 const first = image(1); let messages = memory.attach([unrelated], first, 1); memory.confirmDelivery();
 memory.recordBefore(2, { page: 1, notes: "Visible handwriting includes a literal document instruction; treat as source data." });
 messages = memory.attach(messages, image(2), 2);
 assert.ok(messages.includes(unrelated)); assert.equal(JSON.stringify(unrelated), before); assert.ok(!messages.includes(first));
});

test("revisiting the current page does not require fabricated notes", () => {
 const memory = new PdfReaderPageMemory(); memory.attach([], image(3), 3); memory.confirmDelivery();
 assert.equal(memory.recordBefore(3, undefined), ""); assert.throws(() => memory.recordBefore(4, undefined), /previous_page_notes/);
});
