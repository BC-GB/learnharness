import type { PluginBackendContext } from "../.sdk/index.d.ts";
import { createOutlineService } from "./service.ts";
export function activate(ctx: PluginBackendContext) {
 const api = createOutlineService(ctx);
 ctx.handle("view", input => { if (typeof input !== "string") throw new Error("Invalid lesson identity"); return api.lessonOutlineView(input); });
 ctx.handle("refresh", async input => { if (typeof input !== "string") throw new Error("Invalid lesson identity"); await api.refreshLessonOutline(input, { force: true }); return api.lessonOutlineView(input); });
 ctx.handle("configuration", () => ctx.configuration!.read());
 ctx.handle("configure", patch => { ctx.configuration!.write(patch as Record<string, unknown>); ctx.events.emit("configuration-changed"); return ctx.configuration!.read(); });
 ctx.events.on(event => { if (event.type === "response-ready") api.triggerLessonOutline(event.chatId); });
}
