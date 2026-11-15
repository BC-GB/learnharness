"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
function SettingsRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) { return <div className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm">{label}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>{children}</div>; }
function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: (on: boolean) => void; label: string }) { return <button type="button" role="switch" data-testid="toggle-response-notifications" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="rounded border border-border px-3 py-1 text-xs disabled:opacity-40">{checked ? "On" : "Off"}</button>; }
import { NOTIFICATION_CHANGE, notificationsEnabled, notificationsSupported, setNotificationsEnabled } from "./notifications.ts";

export function NotificationSettings() {
	const [enabled, setEnabled] = useState(false);
	const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		const refresh = () => { setEnabled(notificationsEnabled()); setPermission(notificationsSupported() ? Notification.permission : "unsupported"); };
		refresh();
		window.addEventListener("focus", refresh); window.addEventListener("storage", refresh); window.addEventListener(NOTIFICATION_CHANGE, refresh);
		return () => { window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); window.removeEventListener(NOTIFICATION_CHANGE, refresh); };
	}, []);
	const toggle = async (on: boolean) => {
		setBusy(true); setError("");
		try {
			// Permission is requested only from this learner-initiated click.
			if (on && Notification.permission === "default") await Notification.requestPermission();
			const allowed = !on || Notification.permission === "granted";
			setNotificationsEnabled(on && allowed); setEnabled(on && allowed); setPermission(Notification.permission);
			if (!allowed) setError("Notifications were not allowed. You can enable them in your browser’s site permissions.");
		} catch { setError("Your browser could not enable notifications. Check its site permissions."); }
		finally { setBusy(false); }
	};
	return <div className="border-t border-border pt-4" data-testid="notification-settings">
		<SettingsRow label="Response notifications" hint="Notify when a response is ready while you’re in another tab or app. Stored in this browser; lesson content stays out of alerts.">
			<Toggle checked={enabled} disabled={busy || permission === "unsupported" || (permission === "denied" && !enabled)} onChange={(on) => void toggle(on)} label="Response notifications" />
		</SettingsRow>
		{permission === "unsupported" && <p className="mt-2 text-xs text-muted-foreground">Desktop notifications are unavailable in this browser or connection.</p>}
		{permission === "denied" && <p className="mt-2 text-xs text-muted-foreground">Blocked by your browser. Allow notifications in its site permissions, then return here.</p>}
		{error && <p role="status" className="mt-2 text-xs text-muted-foreground">{error}</p>}
	</div>;
}
