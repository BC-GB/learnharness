import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { LhMessage } from "../src/core/native-messages.ts";
import { deliverResponseReady, isResponseReady, responseReadyId } from "../src/core/response-ready.ts";

const assistant = (content: Parameters<typeof fauxAssistantMessage>[0], extra: Parameters<typeof fauxAssistantMessage>[1] = {}): LhMessage => ({ ...fauxAssistantMessage(content, extra), id: "msg_ready" });
const event = { chatId: "chat_ready", messageId: "msg_ready" };
test("ready output includes prose, explicit delivery and learner question/problem tools", () => {
	for (const content of [[fauxText("A saved explanation")], [fauxToolCall("send_to_user", { message: "A saved explanation" })], ...["quiz", "probe", "ask_user_question", "explain", "recall", "problem"].map(name => [fauxToolCall(name, { question: "Choose" })])]) {
		assert.equal(responseReadyId([assistant(content)], false), "msg_ready");
	}
});
test("no ready signal for thoughts, empty output, background tools, error or abort", () => {
	for (const content of [[], [fauxThinking("private reasoning")], [fauxToolCall("read", { path: "private.md" })], [fauxToolCall("visual", { prompt: "private" })]]) assert.equal(responseReadyId([assistant(content)], false), null);
	assert.equal(responseReadyId([assistant([fauxText("partial")])], true), null);
	for (const stopReason of ["error", "aborted"] as const) assert.equal(responseReadyId([assistant([fauxText("partial")], { stopReason })], false), null);
});
test("a failed output or question tool is not a delivered response", () => {
	for (const name of ["send_to_user", "quiz"]) {
		const messages = [assistant([fauxToolCall(name, { message: "private", question: "Choose" }, { id: "failed" })]), { role: "toolResult", id: "result", toolCallId: "failed", toolName: name, isError: true, content: [], timestamp: 0 }] as LhMessage[];
		assert.equal(responseReadyId(messages, false), null);
	}
});
test("a terminal failure cannot promote an earlier intermediate response", () => {
	assert.equal(responseReadyId([assistant([fauxText("earlier")]), assistant([], { stopReason: "error" })], false), null);
});
test("notification identity validates identifiers rather than accepting paths or URLs", () => {
	assert.ok(isResponseReady(event));
	for (const chatId of ["../secrets", "https://example.test", "", "a".repeat(161)]) assert.equal(isResponseReady({ ...event, chatId }), false);
	assert.equal(isResponseReady(null), false);
});
test("away and permitted: deliver after an atomic claim", async () => {
	let delivered = 0;
	await deliverResponseReady(event, { allowed: () => true, away: () => true, claim: async () => true, show: () => delivered++ });
	assert.equal(delivered, 1);
});
test("focused, disabled, denied and malformed events do not even claim", async () => {
	for (const [allowed, away] of [[true, false], [false, true]]) await deliverResponseReady(event, { allowed: () => allowed!, away: () => away!, claim: async () => assert.fail("must not claim"), show: () => assert.fail("must not notify") });
	await deliverResponseReady({ chatId: "../x" }, { allowed: () => true, away: () => true, claim: async () => assert.fail("invalid"), show: () => assert.fail("invalid") });
});
test("an already claimed response does not notify again", async () => {
	await deliverResponseReady(event, { allowed: () => true, away: () => true, claim: async () => false, show: () => assert.fail("duplicate") });
});
for (const change of ["disabled", "focused"]) test(`delayed ${change} change blocks delivery after the claim`, async () => {
	let enabled = true, away = true;
	await deliverResponseReady(event, { allowed: () => enabled, away: () => away, claim: async () => { if (change === "disabled") enabled = false; else away = false; return true; }, show: () => assert.fail("late change must block dispatch") });
});
