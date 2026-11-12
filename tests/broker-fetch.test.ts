import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { normalizeContext, fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { brokerFetch } from "../src/agent/broker-fetch.ts";
import { BROKER_REQUEST_MAX_BYTES, prepareBrokerRequestBody } from "../src/agent/broker-request-body.ts";
import { resizeImageInProcess } from "../src/agent/image-processing/resize-core.mjs";
import { piEngineForSpec } from "../src/agent/models.ts";

const endpoint = "https://api.openai.com/v1/responses";
const post = (body: string, signal?: AbortSignal) => brokerFetch(endpoint, { method: "POST", body, signal });

function imageData(encodedBytes: number): string {
	const canvas = createCanvas(320, 240);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "white"; ctx.fillRect(0, 0, 320, 240);
	ctx.fillStyle = "black"; ctx.fillRect(25, 40, 260, 6); ctx.fillRect(80, 80, 6, 100);
	const original = canvas.toBuffer("image/png");
	// Exact synthetic reproduction of three retained image payload sizes.
	const padded = Buffer.alloc(encodedBytes / 4 * 3);
	original.copy(padded);
	return padded.toString("base64");
}
const originalImages = [353052, 391632, 681248].map(imageData);
const image = (data: string) => ({ type: "input_image", detail: "auto", image_url: `data:image/png;base64,${data}` });
const bodyWithImages = () => JSON.stringify({ model: "gpt-5", instructions: "Explain λ and β accurately.", tools: [{ type: "function", name: "read", parameters: { type: "object" } }], input: [
	{ role: "user", content: [{ type: "input_text", text: "Synthetic exercise" }, image(originalImages[0]!)] },
	...originalImages.slice(1).map((data, i) => ({ type: "function_call_output", call_id: `read${i}`, output: [{ type: "input_text", text: "Figure" }, image(data)] })),
] });

function trapSocket(t: TestContext, respond = true) {
	const sent: { body: Buffer; options: http.RequestOptions }[] = [];
	t.mock.method(http, "request", ((options: http.RequestOptions, callback: (response: unknown) => void) => {
		assert.equal(options.socketPath, "/broker/request.sock");
		assert.equal(options.path, "/v1/responses");
		const req = Object.assign(new EventEmitter(), {
			setTimeout() {},
			end(body: Buffer) {
				sent.push({ body: Buffer.from(body), options });
				assert.ok(respond, "invalid/cancelled requests must never open the broker socket");
				const reply = Object.assign(new PassThrough(), { statusCode: 400, headers: { "content-type": "application/json" } });
				callback(reply);
				reply.end(JSON.stringify({ error: { message: "Synthetic broker response", type: "invalid_request_error" } }));
			},
		});
		return req;
	}) as unknown as typeof http.request);
	t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access"); });
	return sent;
}

test("three historical-sized image copies fit the entire UTF-8 request without changing sources", async t => {
	const sent = trapSocket(t);
	const body = bodyWithImages();
	assert.ok(Buffer.byteLength(body) > BROKER_REQUEST_MAX_BYTES);
	const before = JSON.parse(body);
	const response = await post(body);
	assert.equal(response.status, 400, "mock broker, not a local rejection");
	assert.equal(sent.length, 1);
	const output = sent[0]!;
	assert.ok(output.body.length <= BROKER_REQUEST_MAX_BYTES);
	assert.equal(output.options.headers?.["content-length" as keyof typeof output.options.headers], output.body.length);
	assert.deepEqual(output.options.headers, { "content-type": "application/json", "content-length": output.body.length });
	const payload = JSON.parse(output.body.toString());
	assert.equal(payload.input.length, before.input.length);
	assert.deepEqual(payload.tools, before.tools);
	assert.equal(payload.instructions, before.instructions);
	assert.equal(payload.input[0].content[0].text, "Synthetic exercise");
	assert.equal(payload.input[1].call_id, "read0");
	assert.equal(payload.input.flatMap((item: { content?: unknown[]; output?: unknown[] }) => item.content ?? item.output).filter((part: { type: string }) => part.type === "input_image").length, 3);
	assert.equal(body, bodyWithImages());
	assert.deepEqual(originalImages.map(data => data.length), [353052, 391632, 681248]);
});

test("unchanged requests pass at exactly 1 MiB and reject the next UTF-8 byte", async t => {
	const sent = trapSocket(t);
	const overhead = Buffer.byteLength(JSON.stringify({ input: "λ" }));
	const exact = JSON.stringify({ input: "λ" + "x".repeat(BROKER_REQUEST_MAX_BYTES - overhead) });
	assert.equal(Buffer.byteLength(exact), BROKER_REQUEST_MAX_BYTES);
	await post(exact);
	assert.equal(sent[0]!.body.toString(), exact);
	const rejected = await post(exact.replace("λ", "λx"));
	assert.equal(rejected.status, 413);
	assert.match(await rejected.text(), /1 MiB request limit/);
	assert.equal(sent.length, 1);
});

test("all nonimage instructions, tool schemas and Unicode count against the image budget", async t => {
	const sent = trapSocket(t, false);
	const payload = JSON.parse(bodyWithImages());
	payload.instructions = "漢".repeat(Math.ceil(BROKER_REQUEST_MAX_BYTES / 3));
	const response = await post(JSON.stringify(payload));
	assert.equal(response.status, 413);
	assert.match(await response.text(), /saved conversation and original images are unchanged/);
	assert.equal(sent.length, 0);
});

test("malformed JSON, invalid endpoint and unsupported input are explicit nonretryable errors", async t => {
	const sent = trapSocket(t, false);
	for (const body of ["{", "null", "[]"]) assert.equal((await post(body)).status, 400);
	assert.equal((await brokerFetch("https://other.invalid/", { method: "POST", body: "{}" })).status, 400);
	assert.equal((await brokerFetch(endpoint, { method: "GET" })).status, 400);
	assert.equal(sent.length, 0);
});

test("invalid base64, wrong MIME and oversized headers fail without dropping images or opening sockets", async t => {
	const sent = trapSocket(t, false);
	for (const imageUrl of ["data:image/png;base64,!!!!", `data:image/jpeg;base64,${originalImages[0]}`, "data:image/png;base64,aGVsbG8="]) {
		const payload = JSON.parse(bodyWithImages()); payload.input[0].content[1].image_url = imageUrl;
		const response = await post(JSON.stringify(payload));
		assert.equal(response.status, 400);
		assert.match(await response.text(), /image/i);
	}
	const invalid = Buffer.from(originalImages[0]!, "base64"); invalid.writeUInt32BE(999999, 16);
	const payload = JSON.parse(bodyWithImages()); payload.input[0].content[1] = image(invalid.toString("base64"));
	assert.equal((await post(JSON.stringify(payload))).status, 400);
	assert.equal(sent.length, 0);
});

test("remote URLs and image-shaped tool arguments are never fetched or rewritten", async t => {
	const sent = trapSocket(t, false);
	const body = JSON.stringify({ input: [{ type: "function_call", arguments: bodyWithImages() }, { role: "user", content: [{ type: "input_image", image_url: "https://images.invalid/private" }] }] });
	assert.equal((await post(body)).status, 413);
	assert.equal(sent.length, 0);
});

test("abort before and during worker preparation dispatches nothing", async t => {
	const sent = trapSocket(t, false);
	const already = new AbortController(); already.abort();
	await assert.rejects(post(bodyWithImages(), already.signal), { name: "AbortError" });
	const during = new AbortController();
	const pending = post(bodyWithImages(), during.signal);
	during.abort();
	await assert.rejects(pending, { name: "AbortError" });
	assert.equal(sent.length, 0);
});

test("worker preparation has one total deadline and never dispatches after timeout", async t => {
	const sent = trapSocket(t, false);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const pending = post(bodyWithImages());
	t.mock.timers.tick(15_000);
	const response = await pending;
	assert.equal(response.status, 413);
	assert.match(await response.text(), /timed out/);
	assert.equal(sent.length, 0);
});

test("missing worker fails clearly without in-process fallback", async t => {
	const sent = trapSocket(t, false);
	t.mock.method(process, "cwd", () => "/no-such-broker-worker-directory");
	const response = await post(bodyWithImages());
	assert.equal(response.status, 413);
	assert.match(await response.text(), /processing failed/);
	assert.equal(sent.length, 0);
});

test("request preparation bounds total source size and image count", async t => {
	const sent = trapSocket(t, false);
	assert.equal((await post(JSON.stringify({ input: "x".repeat(32 * BROKER_REQUEST_MAX_BYTES) }))).status, 413);
	assert.equal((await post(JSON.stringify({ input: [{ role: "user", content: Array.from({ length: 65 }, () => image(originalImages[0]!)) }] }))).status, 413);
	assert.equal(sent.length, 0);
});

test("request quality floors refuse microscopic fitting while native defaults still work", async () => {
	const bytes = Buffer.from(originalImages[0]!, "base64");
	assert.equal(await resizeImageInProcess(bytes, "image/png", { maxBytes: 100, minScale: 0.5, minJpegQuality: 70 }), null);
	const fitted = await prepareBrokerRequestBody(bodyWithImages());
	assert.ok(fitted.length <= BROKER_REQUEST_MAX_BYTES);
});

test("large compressible copies release budget for an already-minimal tiny image", async () => {
	const tiny = createCanvas(1, 1).toBuffer("image/png").toString("base64");
	const payload = JSON.parse(bodyWithImages());
	payload.input[0].content.unshift(image(tiny));
	const fitted = JSON.parse((await prepareBrokerRequestBody(JSON.stringify(payload))).toString());
	assert.equal(fitted.input[0].content[0].image_url, `data:image/png;base64,${tiny}`);
});

test("real SDK preserves the size error and makes no broker request or retry", async t => {
	const sent = trapSocket(t, false);
	const old = process.env.LH_BROKER_MODE; process.env.LH_BROKER_MODE = "1";
	t.after(() => { if (old === undefined) delete process.env.LH_BROKER_MODE; else process.env.LH_BROKER_MODE = old; });
	const engine = piEngineForSpec({ provider: "openai", id: "gpt-5", thinkingLevel: "off" });
	const result = await engine.streamFn(engine.model, normalizeContext({ messages: [{ role: "user", content: "x".repeat(BROKER_REQUEST_MAX_BYTES), timestamp: 0 }] })).result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage!, /1 MiB request limit/);
	assert.doesNotMatch(result.errorMessage!, /Connection error/);
	assert.equal(sent.length, 0);
});

test("real SDK serializes historical tool-result images, fits them once and preserves context", async t => {
	const sent = trapSocket(t);
	const old = process.env.LH_BROKER_MODE; process.env.LH_BROKER_MODE = "1";
	t.after(() => { if (old === undefined) delete process.env.LH_BROKER_MODE; else process.env.LH_BROKER_MODE = old; });
	const engine = piEngineForSpec({ provider: "openai", id: "gpt-5", thinkingLevel: "off" });
	const messages: Message[] = [{ role: "user", content: "Read three figures.", timestamp: 0 }];
	for (const [i, data] of originalImages.entries()) {
		messages.push(fauxAssistantMessage(engine.model, { content: [fauxToolCall(`read${i}`, "read", { path: `figure${i}.png` })], stopReason: "toolUse" }));
		messages.push({ role: "toolResult", toolCallId: `read${i}`, toolName: "read", content: [{ type: "image", mimeType: "image/png", data }], isError: false, timestamp: i + 1 });
	}
	const context = normalizeContext({ messages });
	const original = JSON.stringify(context);
	const result = await engine.streamFn(engine.model, context).result();
	assert.match(result.errorMessage!, /Synthetic broker response/);
	assert.equal(sent.length, 1);
	assert.ok(sent[0]!.body.length <= BROKER_REQUEST_MAX_BYTES);
	const payload = JSON.parse(sent[0]!.body.toString());
	assert.equal(payload.input.filter((item: { type: string }) => item.type === "function_call_output").length, 3);
	assert.equal(JSON.stringify(context), original);
});
