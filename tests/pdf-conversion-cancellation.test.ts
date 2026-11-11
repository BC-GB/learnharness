import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { convertPdf } from "../src/agent/subagents/pdf-ops.ts";
import { documentToMarkdown } from "../src/agent/subagents/pdf-markdown.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";
import { isolatedRenderFixture, tick } from "./helpers/isolated-render-fixture.ts";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function observed(promise: Promise<unknown>) {
	let settled = false;
	void promise.then(() => { settled = true; }, () => { settled = true; });
	return () => settled;
}

// Flush only promise continuations; tests use explicit gates, never timing races.
async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

function fakeDoc(getPage: (n: number) => Promise<PDFPageProxy>, numPages = 2): PDFDocumentProxy {
	return { numPages, getPage } as PDFDocumentProxy;
}

function assertNoListener(signal: AbortSignal) {
	assert.equal(getEventListeners(signal, "abort").length, 0);
}

describe("isolated PDF conversion cancellation and bounds", () => {
 it("pre-aborted conversion preserves exact reason without dispatch or transferring bytes", async t => {
  const calls = isolatedRenderFixture(t), controller = new AbortController();
  const reason = { cancelled: "before dispatch" }; controller.abort(reason);
  const bytes = tinyPdf([{}]), length = bytes.length;
  await assert.rejects(convertPdf(bytes, 1000, { signal: controller.signal }), e => e === reason);
  assert.equal(bytes.length, length); assert.equal(calls.length, 0); assertNoListener(controller.signal);
 });
 it("active cancellation waits for isolated teardown and cancelled queued conversion never dispatches", async t => {
  const calls = isolatedRenderFixture(t), active = new AbortController(), queued = new AbortController();
  const bytes = tinyPdf([{}]);
  const first = convertPdf(bytes, 1000, { signal: active.signal });
  const second = convertPdf(bytes, 1000, { signal: queued.signal });
  const a = assert.rejects(first, e => e === active.signal.reason), b = assert.rejects(second, e => e === queued.signal.reason);
  const settled = observed(first); await tick(); assert.equal(calls.length, 1);
  active.abort(); queued.abort(); await tick(); assert.equal(settled(), false);
  calls[0]!.complete({ kind: "converted", pages: [] }); await Promise.all([a, b]);
  assert.equal(calls.length, 1); assertNoListener(active.signal); assertNoListener(queued.signal);
 });
 it("transport failure during abort reports cancellation and frees capacity for the next conversion", async t => {
  const calls = isolatedRenderFixture(t), controller = new AbortController();
  const work = convertPdf(tinyPdf([{}]), 10, { signal: controller.signal });
  const rejected = assert.rejects(work, e => e === controller.signal.reason);
  await tick(); controller.abort(); calls[0]!.fail(); await rejected;
  const next = convertPdf(tinyPdf([{}]), 10); await tick(); calls[1]!.complete({ kind: "unreadable" });
  assert.deepEqual(await next, { kind: "unreadable" }); assertNoListener(controller.signal);
 });
 it("normal results preserve two-argument callers and clamp new callers to the isolated page ceiling", async t => {
  const calls = isolatedRenderFixture(t), bytes = tinyPdf([{}]);
  const expected = { kind: "converted", pages: [{ kind: "empty", number: 1 }] };
  const first = convertPdf(bytes, 1000); await tick();
  assert.equal(calls[0]!.payload.maxPages, 200); assert.equal(calls[0]!.payload.op, "convert");
  assert.deepEqual(Buffer.from(calls[0]!.payload.pdf as string, "base64"), Buffer.from(bytes));
  calls[0]!.complete(expected); assert.deepEqual(await first, expected);
  const limited = convertPdf(bytes, 1); await tick(); assert.equal(calls[1]!.payload.maxPages, 1);
  calls[1]!.complete({ kind: "too-long", pageCount: 2 }); assert.deepEqual(await limited, { kind: "too-long", pageCount: 2 });
  await assert.rejects(convertPdf(new Uint8Array(20 * 1024 * 1024 + 1), 200), /too large/);
  for (const limit of [0, -1, NaN, Infinity]) await assert.rejects(convertPdf(bytes, limit), /page limit/);
  assert.equal(calls.length, 2);
 });
});

describe("documentToMarkdown cancellation checkpoints", () => {
	it("does not access a pre-aborted document", async () => {
		const controller = new AbortController();
		controller.abort();
		const doc = new Proxy({} as PDFDocumentProxy, { get() { assert.fail("must not access document"); } });
		await assert.rejects(documentToMarkdown(doc, undefined, controller.signal), (error) => error === controller.signal.reason);
	});

	it("checks after getPage before extracting text or requesting another page", async () => {
		const controller = new AbortController();
		const page = deferred<PDFPageProxy>();
		const started = deferred<void>();
		const requested: number[] = [];
		const doc = fakeDoc((n) => { requested.push(n); started.resolve(); return page.promise; });
		const result = documentToMarkdown(doc, undefined, controller.signal);
		const settled = observed(result);
		await started.promise;
		controller.abort("stop pages");
		await flush();
		assert.equal(settled(), false);
		page.resolve(new Proxy({} as PDFPageProxy, { get(_target, key) {
			if (key === "then") return undefined; // Promise resolution probes thenables.
			assert.fail("must not access aborted page");
		} }));
		await assert.rejects(result, (error) => error === "stop pages");
		assert.deepEqual(requested, [1]);
	});

	it("checks between pages when the completed text call triggers abort", async () => {
		const controller = new AbortController();
		const requested: number[] = [];
		const doc = fakeDoc(async (n) => {
			requested.push(n);
			return { pageNumber: n, getTextContent: async () => { controller.abort(); return { items: [] }; } } as unknown as PDFPageProxy;
		});
		await assert.rejects(documentToMarkdown(doc, undefined, controller.signal), (error) => error === controller.signal.reason);
		assert.deepEqual(requested, [1]);
	});

	it("waits for an in-flight image operator list and checks abort before another page's operators", async () => {
		const controller = new AbortController();
		const operators = deferred<Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>>();
		const started = deferred<void>();
		const requested: number[] = [];
		const doc = fakeDoc(async (n) => ({
			pageNumber: n,
			getTextContent: async () => ({ items: [] }),
			getOperatorList: () => { requested.push(n); started.resolve(); return operators.promise; },
		}) as unknown as PDFPageProxy);
		const result = documentToMarkdown(doc, undefined, controller.signal);
		const settled = observed(result);
		await started.promise;
		controller.abort();
		await flush();
		assert.equal(settled(), false);
		operators.resolve({ fnArray: [], argsArray: [] });
		await assert.rejects(result, (error) => error === controller.signal.reason);
		assert.deepEqual(requested, [1]);
	});
});
