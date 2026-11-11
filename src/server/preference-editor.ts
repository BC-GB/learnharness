import type { PreferenceChatContext } from "../core/preference-chat.ts";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PATHS, globalPreferencesEnabled, globalPreferencePath } from "../../config.ts";
import { courseStatePath, courseLocal, currentCourseId } from "../runtime/course-context.ts";
import { readPromptCustomization } from "../runtime/prompt-customizations.ts";
import { promptOverrides } from "../store/prompt-overrides.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { stores } from "./stores.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { resolveModelSpec } from "../core/settings-resolution.ts";
import { draftPreferences, validatePreferenceDraft } from "../agent/preference-editor.ts";

const requests = () => courseLocal("preference-editor-runs", () => new Set<symbol>());
export const preferenceEditorRunningCount = () => requests().size;

export const PREFERENCE_SEGMENT = "shared/10-voice.md";
const historyPath = () => globalPreferencesEnabled() ? globalPreferencePath("preference-history.json") : courseStatePath(path.join(PATHS.data, "preference-history.json"));
type Snapshot = { text: string; enabled: boolean };
type Revision = { before: Snapshot; after: Snapshot; at: string; undoFrom?: Snapshot };
const snapshotHash = (v: Snapshot) => createHash("sha256").update(JSON.stringify({ text: v.text, enabled: v.enabled })).digest("hex");
const revision = (v: Snapshot) => createHash("sha256").update(JSON.stringify({ course: currentCourseId(), global: globalPreferencesEnabled(), snapshot: snapshotHash(v) })).digest("hex");
function history(): Revision[] {
 try { const v = JSON.parse(fs.readFileSync(historyPath(), "utf8")); if (!Array.isArray(v)) throw Error(); return v.slice(-20); }
 catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("Preference history unavailable"); }
}
function saveHistory(rows: Revision[]) { const f = historyPath(); fs.mkdirSync(path.dirname(f), { recursive: true }); writeFileAtomicSync(f, JSON.stringify(rows.slice(-20)), { mode: 0o600 }); }
function recoverableIndex(rows: Revision[], snapshot: Snapshot): number {
 const current = snapshotHash(snapshot);
 return rows.findLastIndex(row => {
  // A failed settings write may leave the new addition with the previous switch.
  // Recognize only exact known states; never roll back an intervening edit.
  const intermediate = { text: row.after.text, enabled: row.before.enabled };
  const undoIntermediate = row.undoFrom && { text: row.before.text, enabled: row.undoFrom.enabled };
  return current !== snapshotHash(row.before) && (current === snapshotHash(row.after) || current === snapshotHash(intermediate) || (undoIntermediate !== undefined && current === snapshotHash(undoIntermediate)));
 });
}
export function preferenceView() {
 const custom = readPromptCustomization(PREFERENCE_SEGMENT);
 if (custom?.mode === "replace") throw new Error("This prompt uses a replacement. Switch it to append mode in Agent settings first.");
 const snapshot = { text: custom?.text ?? "", enabled: stores.settingsStore.readSettings()?.agent?.prompts?.[PREFERENCE_SEGMENT] === true };
 const revisions = history();
 return { ...snapshot, revision: revision(snapshot), scope: globalPreferencesEnabled() ? "global" : "course", canUndo: recoverableIndex(revisions, snapshot) >= 0 };
}
function writeSnapshot(next: Snapshot) {
 promptOverrides.writeOverride(PREFERENCE_SEGMENT, next.text, "append");
 const record = stores.settingsStore.readSettings();
 if (!record) throw new Error("Settings unavailable");
 stores.settingsStore.writeSettings({ ...record, agent: { ...record.agent, prompts: { ...record.agent?.prompts, [PREFERENCE_SEGMENT]: next.enabled } } });
}
export function applyPreferences(expected: string, text: string) {
 validatePreferenceDraft({ text, summary: "" });
 const current = preferenceView(); if (current.revision !== expected) throw new Error("Preferences changed. Reload and draft again.");
 if (!stores.settingsStore.readSettings()) throw new Error("Settings unavailable");
 const before = { text: current.text, enabled: current.enabled }; const after = { text, enabled: true };
 // Record recovery before the two existing stores are updated. No deletion of source/legacy files.
 saveHistory([...history(), { before, after, at: new Date().toISOString() }]);
 writeSnapshot(after); return preferenceView();
}
export function undoPreferences(expected: string) {
 const current = preferenceView(); const rows = history(); const index = recoverableIndex(rows, current); const last = rows[index];
 if (current.revision !== expected || !last || !current.canUndo) throw new Error("Preferences changed. Reload before undo.");
 rows[index] = { ...last, undoFrom: { text: current.text, enabled: current.enabled } };
 saveHistory(rows); // Journal the exact undo source before either store changes.
 writeSnapshot(last.before); saveHistory(rows.slice(0, index)); return preferenceView();
}

/** Explicit user-triggered request only. No lessons, files or credentials enter its context. */
export async function proposePreferences(current: string, message: string, signal: AbortSignal, conversation?: PreferenceChatContext) {
 if (current.length > 16000) throw new Error("Existing preferences exceed the editor limit.");
 const settings = stores.settingsStore.readSettings();
 const spec = resolveModelSpec("teacher", undefined, settings?.models);
 if (!spec) throw new Error("Choose a teaching model in Settings first.");
 const active = requests(); if (active.size >= 2) throw new Error("A preference request is already in progress.");
 const id = Symbol(); active.add(id);
 try { return { ...await draftPreferences(piEngineForSpec(spec, false), current, message, signal, conversation), model: spec.id }; }
 finally { active.delete(id); }
}
