/** Preferences conversations are private to one course, even when applied guidance is global. */
export interface PreferenceChatMessage { id: string; role: "user" | "assistant" | "notice"; text: string; at: string }
export interface PreferenceProposal { text: string; summary: string; baseRevision: string }
export interface PreferenceConversation { version: 1; messages: PreferenceChatMessage[]; proposal: PreferenceProposal | null }
export interface PreferenceConversationView extends PreferenceConversation { revision: string }
export interface PreferenceChatView {
 text: string; revision: string; scope: string; canUndo: boolean; enabled: boolean;
 conversation: PreferenceConversationView;
}
export interface PreferenceChatContext { messages: Pick<PreferenceChatMessage, "role" | "text">[]; pendingAddition?: string }
/** Only a bounded recent conversation enters inference. The full saved log is retained. */
export function preferenceChatContext(chat: PreferenceConversation, currentRevision: string): PreferenceChatContext {
 const messages: PreferenceChatContext["messages"] = []; let remaining = 12000;
 for (const message of chat.messages.slice(-20).reverse()) {
  if (message.text.length > remaining) break;
  messages.unshift({ role: message.role, text: message.text }); remaining -= message.text.length;
 }
 return { messages, ...(chat.proposal?.baseRevision === currentRevision ? { pendingAddition: chat.proposal.text } : {}) };
}
