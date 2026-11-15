import { randomUUID } from "node:crypto";
import { preferenceChatContext, type PreferenceChatView, type PreferenceChatMessage } from "./contracts.ts";
import { createConversationStore, PreferenceConversationConflict } from "./store.ts";
import type { PluginBackendContext } from "../.sdk/index.d.ts";
import { draftPreferences } from "./draft.ts";
import { validatePreferenceDraft } from "./draft.ts";


export { PreferenceConversationConflict };
export function createPreferenceConversation(ctx: PluginBackendContext) {
 if (!ctx.promptEditor || !ctx.configuration) throw new Error("Host prompt editor unavailable");
 const { read: preferenceView, apply: applyPreferences, undo: undoPreferences } = ctx.promptEditor;
 const { readPreferenceConversation, writePreferenceConversation } = createConversationStore(ctx.dataDirectory, ctx.learning.directory, ctx.course?.id ?? "legacy");
 let running = 0;
 const proposePreferences = async (current: string, message: string, signal: AbortSignal, conversation?: import("./contracts.ts").PreferenceChatContext) => {
  if (current.length > 16000) throw new Error("Existing preferences exceed the editor limit.");
  const spec = ctx.configuration!.read().models.teacher; if (!spec) throw new Error("Choose a teaching model in Settings first.");
  if (running >= 2) throw new Error("A preference request is already in progress.");
  running++;
  try { return { ...await draftPreferences(ctx.inference, spec, current, message, signal, conversation), model: spec.id }; } finally { running--; }
 };
 function preferenceChatView(): PreferenceChatView { return { ...preferenceView(), conversation: readPreferenceConversation() }; }
function checked(expected: string, conversationRevision: string) {
 const view = preferenceChatView();
 if (view.revision !== expected || view.conversation.revision !== conversationRevision) throw new PreferenceConversationConflict("Preferences or this conversation changed. Reload before continuing.");
 return view;
}
const message = (role: PreferenceChatMessage["role"], text: string): PreferenceChatMessage => ({ id: randomUUID(), role, text, at: new Date().toISOString() });
async function sendPreferenceMessage(expected: string, conversationRevision: string, request: string, signal: AbortSignal, propose = proposePreferences, workingDraft?: string) {
 if (typeof request !== "string" || !request.trim() || request.length > 4000) throw new Error("Use a message of 1 to 4,000 characters.");
 const before = checked(expected, conversationRevision);
 if (before.conversation.messages.length > 998) throw new Error("This preference conversation has reached its storage limit. Your saved conversation and preferences are unchanged.");
 const context = preferenceChatContext(before.conversation, before.revision);
 if (workingDraft !== undefined) {
  validatePreferenceDraft({ text: workingDraft, summary: "" });
  // Manual review edits are the current working copy, but never revive a draft against changed guidance.
  if (before.conversation.proposal?.baseRevision === before.revision) context.pendingAddition = workingDraft;
 }
 const proposal = await propose(before.text, request, signal, context);
 signal.throwIfAborted();
 // Both namespaces are checked after inference. A late answer cannot replace a newer proposal or apply against changed global guidance.
 checked(expected, conversationRevision);
 writePreferenceConversation(conversationRevision, { version: 1, messages: [...before.conversation.messages, message("user", request), message("assistant", proposal.summary)], proposal: { text: proposal.text, summary: proposal.summary, baseRevision: before.revision } });
 return preferenceChatView();
}
function applyPreferenceConversation(expected: string, conversationRevision: string, text: string) {
 const before = checked(expected, conversationRevision);
 if (!before.conversation.proposal || before.conversation.proposal.baseRevision !== expected) throw new PreferenceConversationConflict("The proposal is outdated. Send a follow-up to draft against the current preferences.");
 applyPreferences(expected, text);
 // Existing apply/undo recovery remains authoritative if this auxiliary log write fails.
 writePreferenceConversation(conversationRevision, { version: 1, messages: before.conversation.messages.length < 1000 ? [...before.conversation.messages, message("notice", "Applied and enabled the reviewed preferences.")] : before.conversation.messages, proposal: null });
 return preferenceChatView();
}
function undoPreferenceConversation(expected: string, conversationRevision: string) {
 const before = checked(expected, conversationRevision);
 undoPreferences(expected);
 writePreferenceConversation(conversationRevision, { version: 1, messages: before.conversation.messages.length < 1000 ? [...before.conversation.messages, message("notice", "Undid the last preference change.")] : before.conversation.messages, proposal: null });
 return preferenceChatView();
}

 return { preferenceChatView, sendPreferenceMessage, applyPreferenceConversation, undoPreferenceConversation, proposePreferences };
}
