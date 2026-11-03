import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveNodeCoverage, sectionHeadings, type ProgressMessage, type ProgressPart } from "../components/node-progress-core.ts";
import type { PlanTree } from "../src/core/contracts/plan.ts";
import { projectView } from "../src/core/view.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const tree: PlanTree = { version: 1, nodes: [{ id: "a", title: "Sampling" }, { id: "b", title: "Inference" }], edges: [{ from: "a", to: "b" }] };
const prose = (text: string, id = "native_a-t0"): ProgressPart => ({ type: "text", id, text });
const check = (nodeId: string, output?: unknown, type = "check"): ProgressPart => ({ type: "tool-quiz", input: { nodeId, question: "What changes?", type }, state: output === undefined ? "input-available" : "output-available", output });
const assistant = (...parts: ProgressPart[]): ProgressMessage => ({ id: "group", role: "assistant", parts });

test("empty or unknown node calls do not invent a position or syllabus", () => {
 assert.equal(deriveNodeCoverage(tree, []).current, null);
 const result = deriveNodeCoverage(tree, [assistant(prose("## Not tagged"), check("unknown"))]);
 assert.equal(result.current, null);
 assert.ok(result.nodes.every(n => !n.sections.length && !n.checks.length));
});

test("literal headings ignore code fences and generic worked-answer scaffolding", () => {
 const text = "## 1. Sampling\n### **Standard errors**\n## Given\n### 2. Solution\n~~~md\n## Not taught\n~~~\n```\n## Still code\n```\n## [Inference](https://example.invalid)\n## Sources";
 assert.deepEqual(sectionHeadings(text), ["1. Sampling", "Standard errors", "Inference"]);
});

test("checks attach preceding teaching to their node; predictions retain the previous node's prose", () => {
 const result = deriveNodeCoverage(tree, [assistant(prose("## Sample variation"), check("a", { correct: true }), prose("## More sampling", "native_b-t0"), check("b", undefined, "predict"), prose("## Standard errors", "native_c-t0"))]);
 assert.equal(result.current, "b");
 assert.deepEqual(result.nodes[0]!.sections.map(s => s.title), ["Sample variation", "More sampling"]);
 assert.deepEqual(result.nodes[1]!.sections, [{ title: "Standard errors", messageId: "native_c" }]);
});

test("user words, reasoning and file-reading results never become taught sections", () => {
 const result = deriveNodeCoverage(tree, [
  { id: "u", role: "user", parts: [prose("## My guess")] },
  assistant({ type: "tool-read", output: "## Private file" }, { type: "reasoning", text: "## Internal" }, prose("## Explanation"), check("a", { correct: false })),
 ]);
 assert.deepEqual(result.nodes[0]!.sections.map(s => s.title), ["Explanation"]);
});

test("revisiting a node deduplicates headings while retaining all checks and explicit notes", () => {
 const result = deriveNodeCoverage(tree, [assistant(prose("## 1. Sampling"), check("a", { correct: false, readingThinking: "I am unsure about the denominator" }), prose("## Inference"), check("b", { correct: true }), prose("## 2. Sampling"), check("a", { dontKnow: true }))]);
 assert.equal(result.current, "a");
 assert.equal(result.nodes[0]!.sections.length, 1);
 assert.deepEqual(result.nodes[0]!.checks.map(c => c.status), ["incorrect", "unsure"]);
 assert.equal(result.nodes[0]!.checks[0]!.note, "I am unsure about the denominator");
 assert.equal(result.nodes[1]!.checks[0]!.status, "correct");
});

test("failed, dismissed and pending checks are not counted as correct or completed", () => {
 const result = deriveNodeCoverage(tree, [assistant(check("a"), { ...check("a"), state: "output-error" }, check("a", { dismissed: true }), { ...check("a", {}), type: "tool-explain" })]);
 assert.deepEqual(result.nodes[0]!.checks.map(c => c.status), ["pending", "failed", "dismissed", "answered"]);
});

test("projection cannot write progress markers, prompts or inferred mastery into its inputs", () => {
 const messages = [assistant(prose("## Sampling"), check("a", { correct: true }))];
 const before = JSON.stringify({ tree, messages });
 function freeze(value: unknown) { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } }
 freeze(messages); freeze(tree);
 assert.equal(deriveNodeCoverage(tree, messages).nodes[0]!.checks[0]!.status, "correct");
 assert.equal(JSON.stringify({ tree, messages }), before);
});

test("native assistant grouping preserves real message links and answer outcomes", () => {
 const native = [
  { id: "native_1", role: "assistant", content: [{ type: "text", text: "## Sampling" }], stopReason: "stop" },
  { id: "native_2", role: "assistant", content: [{ type: "toolCall", id: "q1", name: "quiz", arguments: { nodeId: "a", type: "check", question: "What varies?" } }], stopReason: "toolUse" },
  { id: "result", role: "toolResult", toolCallId: "q1", toolName: "quiz", content: [{ type: "text", text: "A" }], details: { correct: true, readingThinking: "Clear now" } },
 ] as unknown as LhMessage[];
 const result = deriveNodeCoverage(tree, projectView(native));
 assert.deepEqual(result.nodes[0]!.sections, [{ title: "Sampling", messageId: "native_1" }]);
 assert.equal(result.nodes[0]!.checks[0]!.status, "correct");
 assert.equal(result.nodes[0]!.checks[0]!.note, "Clear now");
});
