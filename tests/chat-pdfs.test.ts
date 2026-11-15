import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { after, mock, test } from "node:test";
import { runInCourse, type CourseScope } from "../src/runtime/course-context.ts";
import { chatPdfPath, readChatPdf, storeChatPdf, MAX_CHAT_PDF_BYTES } from "../src/runtime/chat-pdfs.ts";
import { resolvePdfPath } from "../src/agent/tools/pdf-path.ts";
import { resolveSourcePath } from "../src/agent/tools/fs-shared.ts";
import { createReadTool } from "../src/agent/tools/read.ts";
import { approvedPdfBytes } from "../src/agent/subagents/pdf-ops.ts";
import { runPdfReaderAgent } from "../src/agent/subagents/pdf-reader.ts";
import { uploadChatPdf, chatPdfResponse } from "../src/server/chat-pdfs.ts";
import { CourseError } from "../src/store/courses.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-pdfs-")));
const scopes: CourseScope[] = ["a", "b"].map(id => {
	const dataRoot = path.join(root, id); const sourceRoot = path.join(root, id + "-materials");
	fs.mkdirSync(dataRoot); fs.mkdirSync(sourceRoot);
	return { id: "chat-pdf-test-" + id, name: id, dataRoot, sourceRoot };
});
const bytes = tinyPdf([{ runs: [{ text: "Question 1: show your working", x: 50, y: 700 }] }, { image: true }]);
after(() => fs.rmSync(root, { recursive: true, force: true }));
function request(body: Uint8Array = bytes, init: RequestInit = {}) {
	return new Request("http://localhost/api/chat-pdfs?filename=My%20working.pdf", { method: "POST", body: new Uint8Array(body), ...init });
}

test("PDFs remain immutable in the selected course; only the PDF reader gets the narrow capability", async () => {
	await runInCourse(scopes[0]!, async () => {
		const saved = storeChatPdf(bytes, "My working.pdf", 2);
		assert.match(saved.name, /^[a-f0-9]{64}\.pdf$/);
		assert.equal(saved.filename, "My working.pdf");
		assert.equal(resolvePdfPath(saved.path), saved.path);
		assert.throws(() => resolveSourcePath(saved.path), /Access denied/);
		assert.deepEqual(readChatPdf(saved.name).bytes, Buffer.from(bytes));
		assert.deepEqual(fs.readdirSync(scopes[0]!.sourceRoot!), [], "official materials stay untouched");
		assert.deepEqual(storeChatPdf(bytes, "renamed.pdf", 2), saved);
		const read = await createReadTool().execute("read-pdf", { path: saved.path });
		assert.match(JSON.stringify(read), /Use the pdf tool/);
		assert.doesNotMatch(JSON.stringify(read), /Question 1/, "the generic read tool never interprets PDF bytes as text");
		const previous = process.env.LH_ISOLATED_RENDERER; process.env.LH_ISOLATED_RENDERER = "1";
		try { assert.equal(await approvedPdfBytes(saved.path), Buffer.from(bytes).toString("base64")); }
		finally { if (previous === undefined) delete process.env.LH_ISOLATED_RENDERER; else process.env.LH_ISOLATED_RENDERER = previous; }
		await runInCourse(scopes[1]!, async () => {
			assert.equal(chatPdfPath(saved.path), undefined);
			assert.throws(() => resolvePdfPath(saved.path), /Access denied/);
			assert.throws(() => readChatPdf(saved.name));
			await assert.rejects(() => createReadTool().execute("foreign", { path: saved.path }));
			const result = await runPdfReaderAgent({ path: saved.path, question: "Find my mistakes" });
			assert.match(result.brief, /Access denied/); assert.deepEqual(result.pagesConsulted, []);
		});
		const metadata = chatPdfResponse(new Request(`http://localhost/api/chat-pdfs?name=${saved.name}&metadata=1`));
		assert.equal((await metadata.json()).pages, 2);
		const download = chatPdfResponse(new Request(`http://localhost/api/chat-pdfs?name=${saved.name}`));
		assert.match(download.headers.get("content-disposition")!, /^attachment/);
		assert.match(download.headers.get("content-security-policy")!, /sandbox/);
		assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(bytes));
		for (const name of ["../settings.json", "/etc/passwd", "a.pdf", "", "a".repeat(64) + ".pdf"]) assert.throws(() => readChatPdf(name));
		assert.throws(() => chatPdfResponse(new Request("http://localhost/api/chat-pdfs?name=a&name=b")), CourseError);
		fs.writeFileSync(saved.path, "%PDF-tampered");
		assert.throws(() => resolvePdfPath(saved.path), /changed/);
		assert.throws(() => storeChatPdf(bytes, "new.pdf", 2), /changed/);
	});
});

test("upload waits for isolated validation, preserves bytes, and fails closed on cancellation and bad documents", async () => {
	const previous = process.env.LH_ISOLATED_RENDERER; process.env.LH_ISOLATED_RENDERER = "1";
	let calls = 0; let valid = true; let release: (() => void) | undefined;
	const stub = mock.method(http, "request", (_options: unknown, callback: (res: EventEmitter & { statusCode: number }) => void) => {
		const req = new EventEmitter() as EventEmitter & { setTimeout(): void; end(data: Buffer): void };
		req.setTimeout = () => {};
		req.end = data => {
			calls++; const payload = JSON.parse(data.toString());
			assert.equal(payload.op, "info"); assert.equal(payload.pdf, Buffer.from(bytes).toString("base64"));
			release = () => {
				const res = Object.assign(new EventEmitter(), { statusCode: valid ? 200 : 500 });
				callback(res); res.emit("data", Buffer.from(JSON.stringify({ page_count: 2 }))); res.emit("end");
			};
		};
		return req;
	});
	try {
		await runInCourse(scopes[1]!, async () => {
			const pending = uploadChatPdf(request());
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(fs.existsSync(path.join(scopes[1]!.dataRoot, "chat-pdfs")), false);
			release!(); const response = await pending; assert.equal(response.status, 201);
			const saved = await response.json(); assert.equal(saved.pages, 2);
			assert.deepEqual(fs.readFileSync(saved.path), Buffer.from(bytes));
			valid = false; const invalid = uploadChatPdf(request());
			await new Promise(resolve => setImmediate(resolve)); release!();
			await assert.rejects(() => invalid, CourseError);
			valid = true; const controller = new AbortController();
			const cancelled = uploadChatPdf(request(bytes, { signal: controller.signal }));
			await new Promise(resolve => setImmediate(resolve)); controller.abort(); release!();
			await assert.rejects(() => cancelled, CourseError);
			const before = calls;
			for (const text of ["not a PDF", "<svg onload='x' />", "http://192.168.1.1/file.pdf"]) await assert.rejects(() => uploadChatPdf(request(Buffer.from(text))), CourseError);
			assert.equal(calls, before, "spoofed MIME/URLs cannot invoke a parser or fetch");
			await assert.rejects(() => uploadChatPdf(request(bytes, { headers: { "Content-Length": String(MAX_CHAT_PDF_BYTES + 1) } })), error => error instanceof CourseError && error.status === 413);
			const chunked = new Request("http://localhost/api/chat-pdfs?filename=x.pdf", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_CHAT_PDF_BYTES + 1)); c.close(); } }), duplex: "half" } as RequestInit);
			await assert.rejects(() => uploadChatPdf(chunked), error => error instanceof CourseError && error.status === 413);
		});
	} finally { stub.restore(); if (previous === undefined) delete process.env.LH_ISOLATED_RENDERER; else process.env.LH_ISOLATED_RENDERER = previous; }
});

test("storage rejects invalid counts, oversize PDFs, symlinks and disguised metadata", () => {
	runInCourse(scopes[1]!, () => {
		for (const pages of [0, -1, 201, NaN, 1.5]) assert.throws(() => storeChatPdf(bytes, "x.pdf", pages));
		assert.throws(() => storeChatPdf(new Uint8Array(MAX_CHAT_PDF_BYTES + 1), "x.pdf", 1));
		const saved = storeChatPdf(bytes, "x.pdf", 2);
		fs.writeFileSync(saved.path + ".json", JSON.stringify({ name: saved.name, filename: "../settings.json", pages: 2 }));
		assert.throws(() => readChatPdf(saved.name));
		if (process.platform !== "win32") {
			fs.unlinkSync(saved.path); fs.symlinkSync(path.join(scopes[0]!.dataRoot, "settings.json"), saved.path);
			assert.throws(() => resolvePdfPath(saved.path));
		}
	});
});
