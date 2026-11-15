import { createRoot } from "react-dom/client";
import type { PluginFrontendContext } from "../.sdk/index.d.ts";
import { NotificationSettings } from "./settings.tsx";
import { claimResponse, closeResponseNotifications, deliverResponseReady, NOTIFICATION_CHANGE, notificationsEnabled, showResponseNotification } from "./notifications.ts";
export function activate(ctx: PluginFrontendContext) {
 if (!ctx.registerWidget || !ctx.app.course) throw new Error("Native widget/course support unavailable");
 const course = ctx.app.course();
 const mount = (container: HTMLElement) => { const root = createRoot(container); root.render(<NotificationSettings />); return () => root.unmount(); };
 ctx.registerWidget({ id: "notification-settings", location: "settings-general", mount }); ctx.registerSettings(mount);
 ctx.onAppEvent(event => { if (event.type === "response-ready") void deliverResponseReady(event, {
  allowed: () => !ctx.signal.aborted && ctx.app.course!().id === course.id && notificationsEnabled(),
  away: () => document.visibilityState !== "visible" || !document.hasFocus(),
  claim: ready => claimResponse(course.id, ready),
  show: ready => showResponseNotification(`lh:${course.id}:${ready.chatId}`, () => { if (!ctx.signal.aborted && ctx.app.course!().id === course.id) ctx.app.openSession(ready.chatId); }),
 }).catch(() => {}); });
 const reading = () => { if (document.visibilityState === "visible" && document.hasFocus()) closeResponseNotifications(); };
 const changed = () => { if (!notificationsEnabled()) closeResponseNotifications(); };
 window.addEventListener("focus", reading); document.addEventListener("visibilitychange", reading); window.addEventListener("storage", changed); window.addEventListener(NOTIFICATION_CHANGE, changed);
 ctx.cleanup(() => { window.removeEventListener("focus", reading); document.removeEventListener("visibilitychange", reading); window.removeEventListener("storage", changed); window.removeEventListener(NOTIFICATION_CHANGE, changed); closeResponseNotifications(); });
}
