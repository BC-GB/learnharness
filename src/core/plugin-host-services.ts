/** Optional host-owned capabilities. Availability is deployment policy, never manifest claims. */
import type { PluginModelSpec } from "./plugin-agents.ts";
export interface PluginConfiguration {
 read(): { values: Record<string, unknown>; models: Record<string, PluginModelSpec | null> };
 /** Only app-allowlisted keys for this package; null removes an override. */
 write(patch: Record<string, unknown>): void;
}
export interface PluginPromptEditor {
 read(): { text: string; enabled: boolean; revision: string; scope: string; canUndo: boolean };
 /** Explicit review/apply and recoverable undo retain host revision checks. */
 apply(revision: string, text: string): ReturnType<PluginPromptEditor["read"]>;
 undo(revision: string): ReturnType<PluginPromptEditor["read"]>;
}
export interface PluginCourseIdentity { id: string; name: string }
export interface PluginWidget {
 id: string;
 location: "app" | "session" | "settings-general";
 /** Session placement receives only its current native identity, never another course. */
 mount(container: HTMLElement, signal: AbortSignal, session?: { id: string; kind: "teaching" | "practice" }): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
