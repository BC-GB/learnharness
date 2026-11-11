import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import type { PreferenceChatView } from "../src/core/preference-chat.ts";
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });
async function fixture() {
 const dom = parseHTML("<html><body><div id='root'></div></body></html>");
 Object.defineProperty(dom.document, "oninput", { configurable: true, value: null });
 const previous = new Map<string, PropertyDescriptor | undefined>();
 const originalFetch = globalThis.fetch;
 for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, navigator: { userAgent: "", platform: "" }, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
 }
 const { createRoot } = await import("react-dom/client");
 const { PreferenceChat } = await import("../components/settings/preference-chat.tsx");
 const { InteractionLayersProvider } = await import("../components/interaction-layers.tsx");
 const root = createRoot(document.getElementById("root")!);
 let saved: PreferenceChatView = { text: "Use examples.", revision: "prefs1", scope: "global", enabled: true, canUndo: false, conversation: { version: 1, revision: "chat1", messages: [{ id: "a", role: "user", text: "Short examples", at: "now" }, { id: "b", role: "assistant", text: "I propose short examples.", at: "now" }], proposal: { text: "Use short examples.", summary: "Short examples.", baseRevision: "prefs1" } } };
 const calls: { action?: string; revision?: string; conversationRevision?: string; text?: string; message?: string }[] = [];
 let fail = false;
 globalThis.fetch = async (_url, init) => {
  if (!init?.method || init.method === "GET") return Response.json(saved);
  const body = JSON.parse(String(init.body)); calls.push(body);
  if (fail) return Response.json({ error: "Synthetic failure" }, { status: 400 });
  if (body.action === "chat") saved = { ...saved, conversation: { ...saved.conversation, revision: "chat-followup", messages: [...saved.conversation.messages, { id: "c", role: "user", text: body.message, at: "now" }, { id: "d", role: "assistant", text: "I added reasoning.", at: "now" }], proposal: { text: "Use short examples and reasoning.", summary: "I added reasoning.", baseRevision: saved.revision } } };
  if (body.action === "apply") saved = { ...saved, text: body.text, revision: "prefs2", canUndo: true, conversation: { ...saved.conversation, revision: "chat2", proposal: null } };
  if (body.action === "undo") saved = { ...saved, text: "Use examples.", revision: "prefs3", canUndo: false, conversation: { ...saved.conversation, revision: "chat3", proposal: null } };
  return Response.json(saved);
 };
 const render = async (key: string) => { await act(async () => root.render(<InteractionLayersProvider><PreferenceChat key={key} courseName="Test course" /></InteractionLayersProvider>)); };
 cleanup = async () => { await act(async () => root.unmount()); globalThis.fetch = originalFetch; for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
 await render("a");
 return { calls, render, fail: () => { fail = true; } };
}
const byTest = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === text)!;
const click = async (element: HTMLElement) => { assert(element); await act(async () => element.click()); };

test("floating chat opens without inference, preserves conversation on close/reopen and reload, and applies only explicitly", async () => {
 const f = await fixture();
 assert.equal(byTest("preference-chat").hidden, true); assert.equal(f.calls.length, 0);
 await click(byTest("preference-chat-toggle"));
 assert.equal(byTest("preference-chat").hidden, false); assert.equal(f.calls.length, 0);
 assert.match(document.body.textContent!, /Applied preferences affect all courses/);
 assert.match(document.body.textContent!, /I propose short examples/);
 assert.equal((document.querySelector('[aria-label="Proposed preference addition"]') as HTMLTextAreaElement).defaultValue, "Use short examples.");
 await click(document.querySelector('[aria-label="Close preferences chat"]') as HTMLElement);
 assert.equal(byTest("preference-chat").hidden, true);
 await click(byTest("preference-chat-toggle")); assert.match(document.body.textContent!, /I propose short examples/);
 await f.render("reloaded"); await click(byTest("preference-chat-toggle")); assert.match(document.body.textContent!, /I propose short examples/);
 await click(button("Apply and enable")); assert.deepEqual(f.calls.map(c => c.action), ["apply"]);
 assert.equal(f.calls[0]?.text, "Use short examples."); assert.equal(f.calls[0]?.conversationRevision, "chat1");
 assert(!document.querySelector('[data-testid="preference-review"]'));
 await click(button("Undo last change")); assert.deepEqual(f.calls.map(c => c.action), ["apply", "undo"]);
});

test("failed apply retains the review and provides explicit reload recovery", async () => {
 const f = await fixture(); await click(byTest("preference-chat-toggle")); f.fail();
 await click(button("Apply and enable")); assert.match(document.querySelector('[role="alert"]')!.textContent!, /Synthetic failure/);
 assert(byTest("preference-review")); assert(button("Reload saved conversation"));
});

test("typing a follow-up sends once and keeps the evolving proposal unapplied", async () => {
 const f = await fixture(); await click(byTest("preference-chat-toggle"));
 const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Learning preference request"]')!;
 await act(async () => { input.value = "Also explain why"; input.dispatchEvent(new window.Event("input", { bubbles: true })); });
 await click(button("Send"));
 assert.deepEqual(f.calls.map(c => c.action), ["chat"]); assert.equal(f.calls[0]?.message, "Also explain why");
 assert.match(document.body.textContent!, /I added reasoning/);
 assert.equal((document.querySelector('[aria-label="Proposed preference addition"]') as HTMLTextAreaElement).defaultValue, "Use short examples and reasoning.");
 assert(!button("Undo last change"), "no change was applied");
});
