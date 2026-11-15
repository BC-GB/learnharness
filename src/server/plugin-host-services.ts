import { AsyncResource } from "node:async_hooks";
import { currentCourse, currentCourseId, forEachKnownCourse, courseLocal } from "../runtime/course-context.ts";
import type { PluginBackendContext } from "../core/plugins.ts";
import { emit } from "../core/events.ts";
import { stores } from "./stores.ts";
import { resolveModelSpec, resolveOutlineModelSpec } from "../core/settings-resolution.ts";
import { parseGeneralSettingsBody } from "./settings-body.ts";
import { DEFAULT_THINKING_ORDER } from "../core/settings.ts";
import type { PluginModelSpec } from "../core/plugin-agents.ts";
import { validateModelsSettings, clampChatLevel, modelCatalog } from "./model-catalog.ts";
import { preferenceView, applyPreferences, undoPreferences } from "./preference-editor.ts";
import { withWorkerRequestSlot } from "../agent/worker-request-admission.ts";

/** Display/first-assignment metadata uses the same supported-level preference as engines.
 * Reading the host catalog never runs or refreshes an account/model request. */
function thinkingFor(spec: PluginModelSpec | null | undefined) {
 if (!spec || spec.thinkingLevel !== undefined) return spec?.thinkingLevel;
 try {
  const model = modelCatalog().models.find(m => m.id === spec.id && m.provider === spec.provider);
  if (!model) return undefined;
  return DEFAULT_THINKING_ORDER.find(level => model.supportedLevels.includes(level)) ?? model.supportedLevels[0] ?? "off";
 } catch { return undefined; } // Unknown display metadata never changes a model or grants a fallback.

}
const activity = () => courseLocal("plugin-host-service-activity", () => ({ count: 0 }));
export const pluginHostServiceRunningCount = () => activity().count;

/** Policy belongs to the app. Packages cannot request more keys through manifests.
 * Existing global choices stay in their original stores; no migration or startup writes. */
export function createCoreHostServices(id: string, signal: AbortSignal): Pick<PluginBackendContext, "course" | "configuration" | "promptEditor" | "admission"> {
 const scope = currentCourse();
 const bound = AsyncResource.bind(<T>(work: () => T): T => { signal.throwIfAborted(); return work(); });
 const course = Object.freeze({ id: currentCourseId(), name: scope?.name ?? "Current course" });
 const services: ReturnType<typeof createCoreHostServices> = { course, admission: { run: (requestSignal, work) => bound(async () => { const live = activity(); live.count++; try { return await withWorkerRequestSlot(AbortSignal.any([signal, requestSignal]), work); } finally { live.count--; } }) } };
 if (id === "lesson-outline" || id === "learning-preferences") services.configuration = {
  read: () => bound(() => {
   const s = stores.settingsStore.readSettings();
   const background = resolveOutlineModelSpec(s);
   return { values: id === "lesson-outline" ? { lessonOutline: s?.general?.lessonOutline === true, backgroundThinkingLevel: thinkingFor(background), ...(s?.general?.outlineModel ? { outlineModel: s.general.outlineModel } : {}) } : {},
    models: { teacher: resolveModelSpec("teacher", undefined, s?.models) ?? null, background: background ?? null } };
  }),
  write: patch => bound(() => {
   if (id !== "lesson-outline" || !patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(k => !["lessonOutline", "outlineModel"].includes(k))) throw new Error("Configuration key unavailable for this plugin");
   const s = stores.settingsStore.readSettings() ?? { version: 1 as const };
   const next = { ...s.general };
   for (const [key, value] of Object.entries(patch)) { if (value === null) delete next[key as keyof typeof next]; else Object.assign(next, { [key]: value }); }
   const parsed = parseGeneralSettingsBody(next); if (!parsed.ok) throw new Error(parsed.error);
   let general = { ...next, ...parsed.settings };
   if (general.outlineModel) {
    const verdict = validateModelsSettings({ cheap: general.outlineModel }, { cheap: s.general?.outlineModel }); if (!verdict.ok) throw new Error(verdict.error);
    const requested = general.outlineModel;
    const assigned = requested.model && requested.thinkingLevel === undefined ? { ...requested, thinkingLevel: thinkingFor({ ...requested.model }) } : requested;
    general = { ...general, outlineModel: clampChatLevel(assigned, resolveOutlineModelSpec({ ...s, general }) ?? null) };
   }
   stores.settingsStore.writeSettings({ ...s, general });
   forEachKnownCourse(() => emit("settings-changed", { section: "general" }));
  }),
 };
 if (id === "learning-preferences") services.promptEditor = {
  read: () => bound(preferenceView),
  apply: (revision, text) => bound(() => { const result = applyPreferences(revision, text); forEachKnownCourse(() => emit("settings-changed", { section: "agent" })); return result; }),
  undo: revision => bound(() => { const result = undoPreferences(revision); forEachKnownCourse(() => emit("settings-changed", { section: "agent" })); return result; }),
 };
 return services;
}
