import type { PluginBackendContext } from "../.sdk/index.d.ts";
import { createPreferenceConversation } from "./conversation.ts";
export function activate(ctx: PluginBackendContext) {
 const api = createPreferenceConversation(ctx);
 ctx.handle("view", () => api.preferenceChatView());
 ctx.handle("edit", async input => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid request");
  const b = input as Record<string, unknown>;
  if (typeof b.revision !== "string") throw new Error("Reload preferences first");
  const current = ctx.promptEditor!.read(); if (current.revision !== b.revision) throw new Error("Preferences changed. Reload first.");
  if (b.conversationRevision === undefined) {
   if (b.action === "apply" && typeof b.text === "string") return ctx.promptEditor!.apply(b.revision, b.text);
   if (b.action === "undo") return ctx.promptEditor!.undo(b.revision);
   if (b.action === "draft" && typeof b.message === "string" && b.message.trim() && b.message.length <= 4000) return { ...await api.proposePreferences(current.text, b.message, AbortSignal.any([ctx.signal, AbortSignal.timeout(60000)])), revision: current.revision };
   throw new Error("Invalid preference request");
  }
  if (typeof b.conversationRevision !== "string") throw new Error("Reload preferences first");
  const { revision, conversationRevision } = b;
  ctx.signal.throwIfAborted();
  if (b.action === "apply" && typeof b.text === "string") return api.applyPreferenceConversation(revision, conversationRevision, b.text);
  if (b.action === "undo") return api.undoPreferenceConversation(revision, conversationRevision);
  if (b.action === "chat" && typeof b.message === "string" && (b.text === undefined || typeof b.text === "string")) return api.sendPreferenceMessage(revision, conversationRevision, b.message, AbortSignal.any([ctx.signal, AbortSignal.timeout(60000)]), undefined, b.text);
  throw new Error("Invalid preference request");
 });
}
