/** Application-side replacement for upstream in-process page tests. Native
 * sandbox, LAN/file denial and kill/recovery remain tested by security/render-worker/test-worker.mjs. */
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { realHeadless, browserServiceBinary, resolveChromeExecutablePath } from "../src/agent/subagents/headless.ts";
import { isolatedRenderFixture, tick } from "./helpers/isolated-render-fixture.ts";

test("untrusted demo markup goes only to fixed isolated IPC, never a local browser or process", async t => {
 const calls = isolatedRenderFixture(t);
 t.mock.method(childProcess, "spawn", () => { throw new Error("must not launch a host process"); });
 syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
 assert.equal(browserServiceBinary(), null); assert.equal(resolveChromeExecutablePath(), null);
 const html = '<script>fetch("http://127.0.0.1/private");fetch("file:///etc/passwd")</script>';
 const pending = realHeadless.runDemo(html, { probe: "location.href", settleMs: 0 });
 await tick(); assert.equal(calls.length, 1);
 assert.equal(calls[0]!.payload.op, "demo"); assert.equal(calls[0]!.payload.html, html);
 const result = { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true };
 calls[0]!.complete(result); assert.deepEqual(await pending, result);
});

test("without isolated renderer, untrusted demo fails closed without IPC", async t => {
 const calls = isolatedRenderFixture(t); delete process.env.LH_ISOLATED_RENDERER;
 assert.equal(realHeadless.available(), false);
 await assert.rejects(realHeadless.runDemo('<img src="file:///private">'), /disabled/);
 assert.equal(calls.length, 0);
});
