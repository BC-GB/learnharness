import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import type { TestContext } from "node:test";
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export function isolatedRenderFixture(t: TestContext) {
 const previous = process.env.LH_ISOLATED_RENDERER;
 process.env.LH_ISOLATED_RENDERER = "1";
 t.after(() => { if (previous === undefined) delete process.env.LH_ISOLATED_RENDERER; else process.env.LH_ISOLATED_RENDERER = previous; });
 const calls: Array<{ payload: Record<string, unknown>; complete: (value: unknown, status?: number) => void; fail: () => void }> = [];
 t.mock.method(http, "request", ((options: http.RequestOptions, callback: (response: unknown) => void) => {
  assert.equal(options.socketPath, "/render-ipc/render.sock"); assert.equal(options.path, "/render"); assert.equal(options.hostname, undefined);
  const req = Object.assign(new EventEmitter(), { setTimeout: (_ms: number, _fn: () => void) => {}, end: (data: Buffer) => {
   calls.push({ payload: JSON.parse(data.toString()), complete(value, status = 200) {
    const response = Object.assign(new EventEmitter(), { statusCode: status }); callback(response);
    response.emit("data", Buffer.from(JSON.stringify(value))); response.emit("end");
   }, fail() { req.emit("error", new Error("synthetic isolated worker failure")); } });
  } });
  return req;
 }) as typeof http.request);
 return calls;
}
