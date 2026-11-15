import React, { act } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { OutlineSettings } from "../plugins/lesson-outline/src/settings.tsx";
test("a delayed settings read cannot roll back an acknowledged outline choice, and controls never infer", async () => {
 const dom = parseHTML("<html><body><div id='root'></div></body></html>");
 const values = { React, window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, navigator: { userAgent: "" }, IS_REACT_ACT_ENVIRONMENT: true };
 const before = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])); for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
 const { createRoot } = await import("react-dom/client"); const root = createRoot(document.getElementById("root")!);
 const signal = new AbortController().signal; let reads = 0, refresh!: () => void, release!: (value: unknown) => void;
 const stale = new Promise(resolve => { release = resolve; }); const initial = { values: { lessonOutline: false, backgroundThinkingLevel: "medium" }, models: { background: { provider: "fixture", id: "original" } } };
 const calls: string[] = [];
 let pickModel!: (value: { provider: string; id: string }) => void | Promise<void>; let displayedThinking: unknown;
 const modelMount = (_target: HTMLElement, props: import("../src/core").PluginModelPickerProps) => { pickModel = props.onChange; return { update() {}, dispose() {} }; };
 const thinkingMount = (_target: HTMLElement, props: import("../src/core").PluginThinkingPickerProps) => { displayedThinking = props.value; return { update(next: Partial<import("../src/core").PluginThinkingPickerProps>) { if ("value" in next) displayedThinking = next.value; }, dispose() {} }; };
 const ctx = { ui: { mountModelPicker: modelMount, mountThinkingPicker: thinkingMount }, onNotification: (fn: () => void) => { refresh = fn; return () => {}; }, onResync: () => () => {}, onAppEvent: () => () => {}, call: async (operation: string, input?: unknown) => {
  calls.push(operation);
  if (operation === "configuration") return ++reads === 1 ? initial : stale;
  assert.equal(operation, "configure");
  if (calls.filter(call => call === "configure").length === 1) assert.deepEqual(input, { lessonOutline: true });
  else assert.deepEqual(input, { outlineModel: { model: { provider: "fixture", id: "next" }, thinkingLevel: "medium" } });
  return { ...initial, values: { ...initial.values, lessonOutline: true } };
 } } as unknown as import("../plugins/lesson-outline/.sdk/index.d.ts").PluginFrontendContext;
 try {
  await act(async () => root.render(<OutlineSettings ctx={ctx} signal={signal} />));
  const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Lesson outline"]')!; assert.equal(toggle.getAttribute("aria-checked"), "false");
  await act(async () => { refresh(); });
  await act(async () => toggle.click()); assert.equal(toggle.getAttribute("aria-checked"), "true");
  await act(async () => { release(initial); }); assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.equal(displayedThinking, "medium", "show actual native default instead of an unset dash");
  await act(async () => { await pickModel({ provider: "fixture", id: "next" }); });
  assert.deepEqual(calls, ["configuration", "configuration", "configure", "configure"]);
 } finally { await act(async () => root.unmount()); for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
