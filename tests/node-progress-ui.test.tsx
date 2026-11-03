import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { NodeProgress } from "../components/node-progress.tsx";
import type { PlanTree } from "../src/core/contracts/plan.ts";
import type { ProgressMessage } from "../components/node-progress-core.ts";

const tree: PlanTree = { version: 1, nodes: [{ id: "a", title: "Sampling" }, { id: "b", title: "Inference" }], edges: [] };
const messages: ProgressMessage[] = [{ id: "group", role: "assistant", parts: [
 { type: "text", id: "m /#-t0", text: "## Sampling <script>alert(1)</script>" },
 { type: "tool-quiz", input: { nodeId: "a", question: "What varies?" }, state: "output-available", output: { correct: false } },
 { type: "text", id: "m2-t0", text: "## Standard errors" },
 { type: "tool-quiz", input: { nodeId: "b", question: "What measures uncertainty?" }, state: "input-available" },
] }];

test("unstarted node has no fabricated progress panel", () => {
 assert.equal(renderToStaticMarkup(<NodeProgress tree={tree} messages={[]} />), "");
});

test("node progress is a local optional view, escaping text and using existing message anchors", async () => {
 const dom = parseHTML("<html><body><div id='test'></div></body></html>");
 const values = new Map<string, string>();
 Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) } });
 const originalFetch = globalThis.fetch;
 let requests = 0;
 globalThis.fetch = (() => { requests++; throw Error("Progress UI must never request inference or write state"); }) as typeof fetch;
 const before = JSON.stringify({ tree, messages });
 const host = document.getElementById("test")!;
 let root = createRoot(host);
 try {
  await act(async () => root.render(<NodeProgress tree={tree} messages={messages} />));
  assert.match(host.textContent!, /Current node/);
  assert.match(host.textContent!, /1 section · 0 answered checks/);
  assert.match(host.textContent!, /Awaiting answer/);
  assert.doesNotMatch(host.textContent!, /100%/);
  const select = host.querySelector("select")!;
  // Linkedom has no native select.value setter; the browser event carries it.
  Object.defineProperty(select, "value", { value: "a", configurable: true });
  await act(async () => select.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
  assert.match(host.textContent!, /Earlier node/);
  assert.match(host.textContent!, /Incorrect answer/);
  assert.equal(host.querySelector("a")!.getAttribute("href"), "#message-m%20%2F%23");
  assert.equal(host.querySelector("script"), null);
  assert.match(host.textContent!, /<script>alert\(1\)<\/script>/);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Hide node progress details"]')!.click());
  assert.equal(host.querySelector('[data-testid="node-progress-details"]'), null);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<NodeProgress tree={tree} messages={messages} />));
  assert.equal(host.querySelector('[data-testid="node-progress-details"]'), null);
  assert.equal(requests, 0);
  assert.equal(JSON.stringify({ tree, messages }), before);
 } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; }
});
