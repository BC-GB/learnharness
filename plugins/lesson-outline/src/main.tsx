import { createRoot } from "react-dom/client";
import type { PluginFrontendContext } from "../.sdk/index.d.ts";
import { LessonOutline } from "./panel.tsx";
import { OutlineSettings } from "./settings.tsx";
export function activate(ctx: PluginFrontendContext) {
 if (!ctx.registerWidget || !ctx.app.course) throw new Error("Native widgets/course support unavailable");
 const settings = (container: HTMLElement, signal: AbortSignal) => { const root = createRoot(container); root.render(<OutlineSettings ctx={ctx} signal={signal} />); return () => root.unmount(); };
 ctx.registerSettings(settings); ctx.registerWidget({ id: "outline-settings", location: "settings-general", mount: settings });
 ctx.registerWidget({ id: "lesson-outline", location: "session", mount(container, signal, session) {
  if (!session || session.kind !== "teaching") return;
  const root = createRoot(container); root.render(<LessonOutline ctx={ctx} chatId={session.id} />); return () => root.unmount();
 } });
}
