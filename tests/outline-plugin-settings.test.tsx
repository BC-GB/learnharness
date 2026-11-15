import React, { act } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { OutlineSettings } from "../plugins/lesson-outline/src/settings.tsx";
test("a delayed settings read cannot roll back an acknowledged outline choice, and controls never infer", async () => {
 const dom = parseHTML("<html><body><div id='root'></div></body></html>");
 const values = { React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, navigator: { userAgent: "" }, IS_REACT_ACT_ENVIRONMENT: true };
 const before = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])); Object.assign(globalThis, values);
 const { createRoot } = await import("react-dom/client"); const root = createRoot(document.getElementById("root")!);
 const signal = new AbortController().signal; let reads = 0, refresh!: () => void, release!: (value: unknown) => void;
 const stale = new Promise(resolve => { release = resolve; }); const initial = { values: { lessonOutline: false }, models: { background: null } };
 const calls: string[] = [];
 const mount = () => ({ update() {}, dispose() {} });
 const ctx = { ui: { mountModelPicker: mount, mountThinkingPicker: mount }, onNotification: (fn: () => void) => { refresh = fn; return () => {}; }, onResync: () => () => {}, onAppEvent: () => () => {}, call: async (operation: string, input?: unknown) => {
  calls.push(operation);
  if (operation === "configuration") return ++reads === 1 ? initial : stale;
  assert.equal(operation, "configure"); assert.deepEqual(input, { lessonOutline: true }); return { ...initial, values: { lessonOutline: true } };
 } } as unknown as import("../plugins/lesson-outline/.sdk/index.d.ts").PluginFrontendContext;
 try {
  await act(async () => root.render(<OutlineSettings ctx={ctx} signal={signal} />));
  const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Lesson outline"]')!; assert.equal(toggle.getAttribute("aria-checked"), "false");
  await act(async () => { refresh(); });
  await act(async () => toggle.click()); assert.equal(toggle.getAttribute("aria-checked"), "true");
  await act(async () => { release(initial); }); assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.deepEqual(calls, ["configuration", "configuration", "configure"]);
 } finally { await act(async () => root.unmount()); for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
