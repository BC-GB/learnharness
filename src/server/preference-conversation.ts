import { randomUUID } from "node:crypto";
import { preferenceChatContext, type PreferenceChatView, type PreferenceChatMessage } from "../core/preference-chat.ts";
import { readPreferenceConversation, writePreferenceConversation, PreferenceConversationConflict } from "../store/preference-conversation.ts";
import { preferenceView, proposePreferences, applyPreferences, undoPreferences } from "./preference-editor.ts";

export { PreferenceConversationConflict };
export function preferenceChatView(): PreferenceChatView { return { ...preferenceView(), conversation: readPreferenceConversation() }; }
function checked(expected: string, conversationRevision: string) {
 const view = preferenceChatView();
 if (view.revision !== expected || view.conversation.revision !== conversationRevision) throw new PreferenceConversationConflict("Preferences or this conversation changed. Reload before continuing.");
 return view;
}
const message = (role: PreferenceChatMessage["role"], text: string): PreferenceChatMessage => ({ id: randomUUID(), role, text, at: new Date().toISOString() });
export async function sendPreferenceMessage(expected: string, conversationRevision: string, request: string, signal: AbortSignal, propose = proposePreferences) {
 if (typeof request !== "string" || !request.trim() || request.length > 4000) throw new Error("Use a message of 1 to 4,000 characters.");
 const before = checked(expected, conversationRevision);
 if (before.conversation.messages.length > 998) throw new Error("This preference conversation has reached its storage limit. Your saved conversation and preferences are unchanged.");
 const proposal = await propose(before.text, request, signal, preferenceChatContext(before.conversation, before.revision));
 signal.throwIfAborted();
 // Both namespaces are checked after inference. A late answer cannot replace a newer proposal or apply against changed global guidance.
 checked(expected, conversationRevision);
 writePreferenceConversation(conversationRevision, { version: 1, messages: [...before.conversation.messages, message("user", request), message("assistant", proposal.summary)], proposal: { text: proposal.text, summary: proposal.summary, baseRevision: before.revision } });
 return preferenceChatView();
}
export function applyPreferenceConversation(expected: string, conversationRevision: string, text: string) {
 const before = checked(expected, conversationRevision);
 if (!before.conversation.proposal || before.conversation.proposal.baseRevision !== expected) throw new PreferenceConversationConflict("The proposal is outdated. Send a follow-up to draft against the current preferences.");
 applyPreferences(expected, text);
 // Existing apply/undo recovery remains authoritative if this auxiliary log write fails.
 writePreferenceConversation(conversationRevision, { version: 1, messages: before.conversation.messages.length < 1000 ? [...before.conversation.messages, message("notice", "Applied and enabled the reviewed preferences.")] : before.conversation.messages, proposal: null });
 return preferenceChatView();
}
export function undoPreferenceConversation(expected: string, conversationRevision: string) {
 const before = checked(expected, conversationRevision);
 undoPreferences(expected);
 writePreferenceConversation(conversationRevision, { version: 1, messages: before.conversation.messages.length < 1000 ? [...before.conversation.messages, message("notice", "Undid the last preference change.")] : before.conversation.messages, proposal: null });
 return preferenceChatView();
}
