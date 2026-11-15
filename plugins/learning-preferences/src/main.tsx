import { createRoot } from "react-dom/client";
import type { PluginFrontendContext } from "../.sdk/index.d.ts";
import { PreferenceChat, PreferenceChatShortcut } from "./chat.tsx";
export function activate(ctx: PluginFrontendContext) {
 if (!ctx.registerWidget || !ctx.app.course || !ctx.ui.mountPopover) throw new Error("Native course/widgets/popup support unavailable");
 const course = ctx.app.course();
 ctx.registerWidget({ id: "preferences-chat", location: "app", mount(container, signal) {
  const root = createRoot(container); root.render(<PreferenceChat ctx={ctx} signal={signal} courseId={course.id} courseName={course.name} />); return () => root.unmount();
 } });
 ctx.registerSettings(container => { const root = createRoot(container); root.render(<PreferenceChatShortcut onOpen={() => ctx.app.closeSettings?.()} />); return () => root.unmount(); });
}
