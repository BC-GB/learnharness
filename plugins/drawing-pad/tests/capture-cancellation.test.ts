import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import { abortable } from "../src/abort.ts";

const require = createRequire(import.meta.url);
// Exercise the pinned library's real resource path, without a browser or network.
const { resourceToDataURL } = require("html-to-image/lib/dataurl.js");

it("passes capture cancellation into html-to-image's in-progress resource fetch", async context => {
  const source = readFileSync(new URL("../src/capture.ts", import.meta.url), "utf8");
  assert.match(source, /toSvg\(root,\s*\{[^}]*fetchRequestInit:\s*\{\s*signal\s*\}/);
  const controller = new AbortController();
  let received: AbortSignal | null | undefined;
  let cancelled = false;
  context.mock.method(console, "warn", () => {});
  context.mock.method(globalThis, "fetch", (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    received = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      received?.addEventListener("abort", () => { cancelled = true; reject(received?.reason); }, { once: true });
    });
  });
  const resource = resourceToDataURL("http://fixture.invalid/capture-cancellation.png", "image/png", {
    fetchRequestInit: { signal: controller.signal },
  });
  const capture = abortable(resource, controller.signal);
  assert.equal(received, controller.signal);
  controller.abort(new Error("Drawing surface closed"));
  await assert.rejects(capture, /Drawing surface closed/);
  await resource; // The library catches fetch failure; the wrapper still rejects cancellation.
  assert.equal(cancelled, true);
  assert.equal(controller.signal.aborted, true);
});
