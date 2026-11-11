/** No helper is spawned in the app: worker failure/recovery crosses fixed IPC. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { realHeadless } from "../src/agent/subagents/headless.ts";
import { isolatedRenderFixture, tick } from "./helpers/isolated-render-fixture.ts";

test("concurrent demos serialize and queued work starts fresh after failed isolated work", async t => {
 const calls = isolatedRenderFixture(t);
 const first = realHeadless.runDemo("<p>first</p>");
 const rejected = assert.rejects(first, /isolated worker failure/);
 const second = realHeadless.runDemo("<p>second</p>");
 await tick(); assert.equal(calls.length, 1);
 calls[0]!.fail(); await rejected; await tick();
 assert.equal(calls.length, 2); assert.equal(calls[1]!.payload.html, "<p>second</p>");
 const result = { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true };
 calls[1]!.complete(result); assert.deepEqual(await second, result);
});

test("a refused isolated response cannot become a successful demo or poison the next job", async t => {
 const calls = isolatedRenderFixture(t);
 const failed = realHeadless.runDemo("<p>refused</p>"); const rejected = assert.rejects(failed, /Isolated rendering failed/);
 await tick(); calls[0]!.complete({ error: "denied" }, 502); await rejected;
 const next = realHeadless.runDemo("<p>clean</p>"); await tick();
 assert.equal(calls.length, 2); const result = { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true };
 calls[1]!.complete(result); assert.deepEqual(await next, result);
});
