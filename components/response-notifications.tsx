"use client";

import { useEffect } from "react";
import { useCourse, useRouter } from "./course-navigation";
import { useServerEvent } from "./server-events";
import { deliverResponseReady } from "@/src/core";
import { documentCourse } from "@/lib/course-client";
import { claimResponse, closeResponseNotifications, NOTIFICATION_CHANGE, notificationsEnabled, showResponseNotification } from "@/lib/response-notifications";

/** Rides the existing course-scoped channel: no polling, transcript reads,
 * model calls, service worker, external push subscription or server writes. */
export function ResponseNotifications() {
	const { id } = useCourse();
	const router = useRouter();
	useServerEvent("response-ready", (event) => {
		void deliverResponseReady(event, {
			allowed: () => documentCourse() === id && notificationsEnabled(),
			away: () => document.visibilityState !== "visible" || !document.hasFocus(),
			claim: (ready) => claimResponse(id, ready),
			show: (ready) => showResponseNotification(`lh:${id}:${ready.chatId}`, () => router.push(`/chat/${encodeURIComponent(ready.chatId)}`)),
		}).catch(() => { /* A blocked browser/OS notification must never affect a lesson. */ });
	});
	useEffect(() => {
		const closeIfReading = () => { if (document.visibilityState === "visible" && document.hasFocus()) closeResponseNotifications(); };
		const changed = () => { if (!notificationsEnabled()) closeResponseNotifications(); };
		window.addEventListener("focus", closeIfReading);
		document.addEventListener("visibilitychange", closeIfReading);
		window.addEventListener("storage", changed);
		window.addEventListener(NOTIFICATION_CHANGE, changed);
		return () => {
			window.removeEventListener("focus", closeIfReading);
			document.removeEventListener("visibilitychange", closeIfReading);
			window.removeEventListener("storage", changed);
			window.removeEventListener(NOTIFICATION_CHANGE, changed);
			closeResponseNotifications();
		};
	}, []);
	return null;
}
