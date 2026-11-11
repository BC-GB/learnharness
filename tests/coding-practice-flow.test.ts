import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";
import { Type } from "typebox";
import type { LhMessage } from "../src/core/native-messages.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-coding-practice-flow-"));
process.env.LH_DATA_DIR = path.join(root, "data");
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw Error("Unexpected external network"); };
const pluginId = "coding-questions-fixture";
const marker = path.join(root, "unexpected-backend-evaluation");
const dist = path.join(root, "data", "plugins", pluginId, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify({ apiVersion: 1, id: pluginId, name: "Coding questions", version: "0.1.0", minAppVersion: "0.4.1", backend: "backend.cjs" }));
// Any evaluation, not just activation/runner use, is observable. This file must
// remain inert even if an old preference says the community package was enabled.
fs.writeFileSync(path.join(dist, "backend.cjs"), `require('node:fs').writeFileSync(${JSON.stringify(marker)},'evaluated'); exports.activate = ctx => ctx.handle('run', () => 'executed');`);
fs.writeFileSync(path.join(root, "data", "global-plugins.json"), JSON.stringify({ version: 1, enabled: { [pluginId]: true, "coding-questions": true } }));
const { getPluginHost } = await import("../src/server/plugins.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { activeProblemOf } = await import("../src/core/native-messages.ts");
const { preparePluginProblemSubmission, pluginProblemAvailabilityOf } = await import("../src/server/plugin-problems.ts");
const host = await getPluginHost();
after(async () => { await host.dispose(); globalThis.fetch = realFetch; fs.rmSync(root, { recursive: true, force: true }); });
const denied = (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 409;

test("production host never evaluates community coding code, including previously enabled startup state", async () => {
  assert.equal(fs.existsSync(marker), false);
  await assert.rejects(host.setEnabled(pluginId, true), denied);
  await assert.rejects(host.call(pluginId, "run"), denied);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(networkCalls, 0);
});

test("production core coding execution remains disabled and contributes no problem tools", async () => {
  await assert.rejects(host.setEnabled("coding-questions", true), denied);
  assert.equal(host.resolveProblemType("coding-questions", "code", 1).status, "unavailable");
  const contributions = host.agentContributions({ chatId: "historical-chat", agent: "practice" }, ["problem", "conclude"]);
  assert.equal(contributions.problemTypes?.some(type => type.pluginId === "coding-questions" || type.pluginId === pluginId) ?? false, false);
  assert.equal(fs.existsSync(marker), false);
});

test("historical coding practice stays readable but cannot process a saved executable payload", () => {
  for (const id of ["coding-questions", pluginId]) {
    const chat = chatStore.createChat("Historical coding practice", "practice");
    const input = { statement: "Implement square", mode: "composition", modelSolution: "Historical solution", payload: { tests: { program: process.execPath, args: ["-e", "throw Error('must never run')"] } } };
    const snapshot = { protocolVersion: 1, problemId: "historical-problem", pluginId: id, typeId: "code", label: "Coding problem", contractVersion: 1,
      input, problemSchema: Type.Object({ tests: Type.Unknown() }), submissionSchema: Type.String(), requiresSubmissionRefinement: false, requiresProcessing: true };
    const occurrence = { messageId: "historical-pose", contentIndex: 0, toolCallId: "historical-call", toolName: "coding_problem" };
    const messages = [
      { id: occurrence.messageId, role: "assistant", content: [{ type: "toolCall", id: occurrence.toolCallId, name: occurrence.toolName, arguments: input }] },
      { id: "historical-ack", role: "toolResult", toolCallId: occurrence.toolCallId, toolName: occurrence.toolName, content: [{ type: "text", text: "Problem posed" }], isError: false, details: { pluginProblem: snapshot } },
    ] as unknown as LhMessage[];
    chatStore.saveMessages(chat.id, messages);
    const record = chatStore.getChat(chat.id)!;
    assert.equal(activeProblemOf(record.messages)?.pluginProblem?.problemId, snapshot.problemId);
    const resolve = host.resolveProblemType.bind(host);
    assert.deepEqual(pluginProblemAvailabilityOf(record, resolve), { problemId: snapshot.problemId, status: "unavailable" });
    assert.throws(() => preparePluginProblemSubmission(record, { type: "plugin-problem-submission", problemId: snapshot.problemId, occurrence, submission: "function square(x) { return x*x; }" }, resolve), /Problem unavailable/);
    assert.deepEqual(chatStore.getChat(chat.id)!.messages, record.messages, "Unavailable historical work must not be rewritten or continued");
  }
  assert.equal(fs.existsSync(marker), false);
  assert.equal(networkCalls, 0);
});
// Generic coding processing remains covered by plugins/coding-questions/tests/
// backend-practice.test.ts and injected createPluginHost problem registration tests.
// Production tests must never add a test-mode exception to deployment policy.