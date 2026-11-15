/** Delegate native creation and one-time drafts to the course-bound host. */
import type { PluginCreatedSession, PluginFrontendContext } from "../.sdk/index.d.ts";
import type { ChildSessionKind } from "./domain.ts";
export const LAUNCH_FAILURE = "Could not open the session. You can still attach an existing chat to this node.";
export interface NativeSessionHost {
  create(input: { readonly title: string; readonly kind: ChildSessionKind }): Promise<{ chatId: string }>;
  stageOpeningPrompt(chatId: string, text: string): boolean;
  clearOpeningPrompt(chatId: string): void;
}
export interface BrowserSessionHostOptions { readonly app: Pick<PluginFrontendContext["app"], "createSession"> }
export function createBrowserSessionHost({ app }: BrowserSessionHostOptions): NativeSessionHost {
  const owned = new Map<string, PluginCreatedSession>();
  return {
    async create(input) {
      try {
        const created = await app.createSession(input);
        if (!created || !/^[A-Za-z0-9_-]{1,128}$/.test(created.id)) { created?.clearOpeningPrompt(); throw Error(LAUNCH_FAILURE); }
        owned.set(created.id, created); return { chatId: created.id };
      } catch { throw Error(LAUNCH_FAILURE); }
    },
    stageOpeningPrompt(id, text) { return owned.get(id)?.stageOpeningPrompt(text) ?? false; },
    clearOpeningPrompt(id) { owned.get(id)?.clearOpeningPrompt(); owned.delete(id); },
  };
}
