import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";
import { isolatedRender } from "../src/agent/subagents/render-client.ts";

test("isolated IPC cancellation never dispatches cancelled queued work or releases active capacity early", async t => {
 const previous = process.env.LH_ISOLATED_RENDERER;
 process.env.LH_ISOLATED_RENDERER = "1";
 t.after(() => { if (previous === undefined) delete process.env.LH_ISOLATED_RENDERER; else process.env.LH_ISOLATED_RENDERER = previous; });
 const completions: Array<() => void> = [];
 t.mock.method(http, "request", ((_options: unknown, callback: (response: unknown) => void) => {
  const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void };
  req.setTimeout = () => {};
  req.end = () => {};
  completions.push(() => {
   const response = Object.assign(new EventEmitter(), { statusCode: 200 });
   callback(response);
   response.emit("data", Buffer.from('{"ok":true}'));
   response.emit("end");
  });
  return req;
 }) as unknown as typeof http.request);
 const already = new AbortController(); already.abort();
 await assert.rejects(isolatedRender({ op: "convert" }, { signal: already.signal }), { name: "AbortError" });
 assert.equal(completions.length, 0);
 const active = new AbortController();
 const queued = new AbortController();
 const first = isolatedRender({ op: "convert" }, { signal: active.signal });
 const second = isolatedRender({ op: "convert" }, { signal: queued.signal });
 const firstRejected = assert.rejects(first, { name: "AbortError" });
 const secondRejected = assert.rejects(second, { name: "AbortError" });
 let settled = false; void first.then(() => { settled = true; }, () => { settled = true; });
 await new Promise<void>(resolve => setImmediate(resolve));
 assert.equal(completions.length, 1);
 active.abort(); queued.abort();
 await new Promise<void>(resolve => setImmediate(resolve));
 assert.equal(settled, false, "active request owns capacity until native IPC settles");
 assert.equal(completions.length, 1);
 completions[0]!();
 await Promise.all([firstRejected, secondRejected]);
 assert.equal(completions.length, 1, "queued cancelled work was never sent");
 const next = isolatedRender({ op: "convert" });
 await new Promise<void>(resolve => setImmediate(resolve));
 assert.equal(completions.length, 2);
 completions[1]!();
 assert.deepEqual(await next, { ok: true });
});
