import type { ResponseReady } from "../src/core/response-ready.ts";

export const NOTIFICATION_PREFERENCE = "lh:response-notifications:v1";
export const NOTIFICATION_CHANGE = "lh:response-notifications-changed";
const active = new Set<Notification>();

export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && window.isSecureContext && typeof Notification !== "undefined";
}
export function notificationsEnabled(): boolean {
	try { return notificationsSupported() && Notification.permission === "granted" && localStorage.getItem(NOTIFICATION_PREFERENCE) === "on"; }
	catch { return false; }
}
export function setNotificationsEnabled(on: boolean): void {
	localStorage.setItem(NOTIFICATION_PREFERENCE, on ? "on" : "off");
	if (!on) closeResponseNotifications();
	window.dispatchEvent(new Event(NOTIFICATION_CHANGE));
}
export function closeResponseNotifications(): void {
	for (const notification of active) notification.close();
	active.clear();
}

/** Same-origin atomic claims prevent two open tabs from notifying twice.
 * Only opaque course/chat/message IDs are stored; no transcript or account
 * data. A bounded ledger, local to this browser, never enters model context. */
export function claimResponse(courseId: string, event: ResponseReady): Promise<boolean> {
	return new Promise((resolve) => {
		if (typeof indexedDB === "undefined") { resolve(false); return; }
		const open = indexedDB.open("lh-response-notifications", 1);
		open.onupgradeneeded = () => open.result.createObjectStore("claims", { keyPath: "id" });
		open.onerror = () => resolve(false);
		open.onblocked = () => resolve(false);
		open.onsuccess = () => {
			const db = open.result;
			const tx = db.transaction("claims", "readwrite"), store = tx.objectStore("claims");
			const id = `${courseId}:${event.chatId}:${event.messageId}`;
			let claimed = false;
			const read = store.get(id);
			read.onsuccess = () => {
				if (read.result) return;
				store.add({ id, at: Date.now() }); claimed = true;
				const all = store.getAll();
				all.onsuccess = () => {
					const rows = all.result as { id: string; at: number }[];
					for (const row of rows.sort((a, b) => a.at - b.at).slice(0, Math.max(0, rows.length - 256))) store.delete(row.id);
				};
			};
			tx.oncomplete = () => { db.close(); resolve(claimed); };
			tx.onerror = tx.onabort = () => { db.close(); resolve(false); };
		};
	});
}

export function showResponseNotification(tag: string, onClick: () => void): void {
	const notification = new Notification("LearnHarness", {
		body: "Your response is ready.", tag,
	});
	active.add(notification);
	notification.onclose = () => active.delete(notification);
	notification.onclick = () => { notification.close(); active.delete(notification); window.focus(); onClick(); };
}
