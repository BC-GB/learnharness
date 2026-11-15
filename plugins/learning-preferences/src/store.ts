import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";


import type { PreferenceConversation, PreferenceConversationView } from "./contracts.ts";
import { safePath, atomicWrite } from "./storage.ts";


export class PreferenceConversationConflict extends Error {}
export function createConversationStore(directory: string, legacyDirectory: string, courseId: string) {
 const file = () => safePath(directory, "conversation.json");
const hash = (chat: PreferenceConversation) => createHash("sha256").update(JSON.stringify({ course: courseId, chat })).digest("hex");
function validate(value: unknown): PreferenceConversation {
 const c = value as PreferenceConversation;
 if (!c || c.version !== 1 || !Array.isArray(c.messages) || c.messages.length > 1000) throw new Error("Preference conversation unavailable");
 for (const m of c.messages) {
  if (!m || typeof m.id !== "string" || m.id.length > 100 || !["user", "assistant", "notice"].includes(m.role) || typeof m.text !== "string" || m.text.length > 4000 || typeof m.at !== "string" || m.at.length > 40) throw new Error("Preference conversation unavailable");
 }
 if (c.proposal !== null && (!c.proposal || typeof c.proposal.text !== "string" || c.proposal.text.length > 16000 || c.proposal.text.includes("\u0000") || typeof c.proposal.summary !== "string" || c.proposal.summary.length > 1000 || typeof c.proposal.baseRevision !== "string" || c.proposal.baseRevision.length > 100)) throw new Error("Preference conversation unavailable");
 return { version: 1, messages: c.messages.map(({ id, role, text, at }) => ({ id, role, text, at })), proposal: c.proposal && { text: c.proposal.text, summary: c.proposal.summary, baseRevision: c.proposal.baseRevision } };
}
function readPreferenceConversation(): PreferenceConversationView {
 let chat: PreferenceConversation;
 try {
  let location = file();
  if (!fs.existsSync(location)) location = safePath(legacyDirectory, "preference-conversation.json");
  if (fs.statSync(location).size > 16 * 1024 * 1024) throw new Error("Preference conversation exceeds the storage limit");
  chat = validate(JSON.parse(fs.readFileSync(location, "utf8")));
 } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  chat = { version: 1, messages: [], proposal: null };
 }
 return { ...chat, revision: hash(chat) };
}
function writePreferenceConversation(expected: string, value: PreferenceConversation): PreferenceConversationView {
 if (readPreferenceConversation().revision !== expected) throw new PreferenceConversationConflict("This conversation changed in another window. Reload before continuing.");
 const chat = validate(value); const location = file();
 const encoded = JSON.stringify(chat);
 if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error("Preference conversation exceeds the storage limit");
 fs.mkdirSync(path.dirname(location), { recursive: true });
 atomicWrite(location, encoded);
 return { ...chat, revision: hash(chat) };
}

return { readPreferenceConversation, writePreferenceConversation };
}
