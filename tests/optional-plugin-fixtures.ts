/** Synthetic host adapters for the unchanged functional regression suites. */
import fs from "node:fs";
import path from "node:path";
import type { PluginBackendContext } from "../src/core/plugins.ts";
import type { PiEngine } from "../src/agent/models.ts";
import { PATHS } from "../config.ts";
import { stores } from "../src/server/stores.ts";
import { courseLocal } from "../src/runtime/course-context.ts";
import { createCoreHostServices } from "../src/server/plugin-host-services.ts";
import { createPluginLearningData } from "../src/server/plugin-learning.ts";
import { createPluginLibrary } from "../src/server/plugin-library.ts";
import { createOutlineService } from "../plugins/lesson-outline/src/service.ts";
import { createOutlineStore } from "../plugins/lesson-outline/src/store.ts";
import { outlineMaterials as materials, outlineMaterialPack as pack } from "../plugins/lesson-outline/src/materials.ts";
import { createPreferenceConversation } from "../plugins/learning-preferences/src/conversation.ts";
import { createConversationStore } from "../plugins/learning-preferences/src/store.ts";
import { inferenceFor } from "./plugin-inference-fixture.ts";
function context(id: string): PluginBackendContext {
 const signal = new AbortController().signal, dataDirectory = path.join(PATHS.data, "core-plugin-data", id); fs.mkdirSync(dataDirectory, { recursive: true });
 const services = createCoreHostServices(id, signal); const configuration = services.configuration!;
 return { signal, dataDirectory, ...services, configuration: { ...configuration, read: () => { const result = configuration.read(); return { ...result, models: { ...result.models, background: result.models.background ?? { provider: "fixture", id: "fixture" } } }; } },
  learning: createPluginLearningData({ directory: PATHS.data, chatStore: stores.chatStore, graphStore: stores.graphStore, isBusy: () => false, isCompacting: () => false, readMetadata: () => null }), library: createPluginLibrary(signal),
  inference: { complete: async () => { throw Error("Unexpected real inference in fixture"); } },
 } as PluginBackendContext;
}
const outline = () => courseLocal("outline-plugin-fixture", () => { const ctx = context("lesson-outline"); return { ctx, api: createOutlineService(ctx), store: createOutlineStore(ctx.dataDirectory, ctx.learning.directory) }; });
export const lessonOutlineView = (id: string) => outline().api.lessonOutlineView(id);
export const refreshLessonOutline = (id: string, options: { force?: boolean; engine?: Pick<PiEngine, "model" | "streamFn">; materials?: (query: string) => import("../plugins/lesson-outline/src/contracts.ts").OutlineSource[] } = {}) => outline().api.refreshLessonOutline(id, { force: options.force, materials: options.materials, ...(options.engine ? { inference: inferenceFor(options.engine) } : {}) });
export const outlineRunningCount = () => outline().api.outlineRunningCount();
export const outlinePassages = (record: import("../src/core/contracts.ts").ChatRecord) => outline().ctx.learning.getSessionSnapshot!(record.id)!.passages;
export const selectOutlinePassages = (...args: Parameters<ReturnType<typeof createOutlineService>["selectOutlinePassages"]>) => outline().api.selectOutlinePassages(...args);
export const readLessonOutline = (id: string) => outline().store.readLessonOutline(id);
export const writeLessonOutline = (...args: Parameters<ReturnType<typeof createOutlineStore>["writeLessonOutline"]>) => outline().store.writeLessonOutline(...args);
export const readLegacyLessonOutline = (id: string) => outline().store.readLegacyLessonOutline(id);
export const outlineMaterials = (...args: Parameters<typeof materials> extends [unknown, ...infer Rest] ? Rest : never) => materials(outline().ctx.library!, ...args);
export const outlineMaterialPack = (...args: Parameters<typeof pack> extends [unknown, ...infer Rest] ? Rest : never) => pack(outline().ctx.library!, ...args);
const preferences = () => courseLocal("preference-plugin-fixture", () => { const ctx = context("learning-preferences"); return { api: createPreferenceConversation(ctx), store: createConversationStore(ctx.dataDirectory, ctx.learning.directory, ctx.course?.id ?? "legacy") }; });
export const preferenceChatView = () => preferences().api.preferenceChatView();
export const sendPreferenceMessage = (...args: Parameters<ReturnType<typeof createPreferenceConversation>["sendPreferenceMessage"]>) => preferences().api.sendPreferenceMessage(...args);
export const applyPreferenceConversation = (...args: Parameters<ReturnType<typeof createPreferenceConversation>["applyPreferenceConversation"]>) => preferences().api.applyPreferenceConversation(...args);
export const undoPreferenceConversation = (...args: Parameters<ReturnType<typeof createPreferenceConversation>["undoPreferenceConversation"]>) => preferences().api.undoPreferenceConversation(...args);
export const readPreferenceConversation = () => preferences().store.readPreferenceConversation();
export const writePreferenceConversation = (...args: Parameters<ReturnType<typeof createConversationStore>["writePreferenceConversation"]>) => preferences().store.writePreferenceConversation(...args);
