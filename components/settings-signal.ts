"use client";

/**
 * THE cross-surface settings signal (fix wave, owner ruling 2026-09-22):
 * every WRITER dispatches after a successful PUT, every READER re-reads —
 * the composer reflects the strong slot the instant setup saves, the
 * settings section reflects the composer's pick on its next mount... and
 * so on, by construction. CustomEvent on the window, the lh:chat-renamed
 * pattern: writers and readers live in different component subtrees
 * (portaled dialogs included), and the app already speaks this dialect.
 *
 * The event carries the section name so ONE event serves all sections —
 * readers filter on what they actually read.
 */
import { useEffect, useRef } from "react";

export const SETTINGS_SAVED_EVENT = "lh:settings-saved";
const SETTINGS_STORAGE_EVENT = "lh:global-settings-saved:v1";

/** The settings sections a writer can land (the write seam's union). */
// "keys" joined the roster (zero-keys wave, 2026-09-25): keys-section
// dispatches it after save AND delete — deletions used to be invisible to
// the zero-keys pill and the setup dialog's auto-advance.
export type SettingsSection = "general" | "keys" | "agent" | "models" | "appearance" | "graph" | "compaction" | "dictation" | "claudeCode";

/** Writers call this after the PUT resolves ok — never before (a failed
 *  write notifies nothing; the record is unchanged). */
export function notifySettingsSaved(section: SettingsSection): void {
	window.dispatchEvent(
		new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { section } }),
	);
	// Notify other course tabs without sharing setting values or course data.
	try { window.localStorage.setItem(SETTINGS_STORAGE_EVENT, JSON.stringify({ section, nonce: `${Date.now()}:${Math.random()}` })); } catch { /* Storage can be unavailable; next open still reads the shared record. */ }
}

/** Non-hook listener (imperative seams, tests). Returns an unsubscribe. */
export function onSettingsSaved(handler: (section: SettingsSection) => void): () => void {
	const listener = (e: Event) => {
		const section = (e as CustomEvent<{ section?: SettingsSection }>).detail?.section;
		if (section !== undefined) handler(section);
	};
	window.addEventListener(SETTINGS_SAVED_EVENT, listener);
	const storage = (event: StorageEvent) => {
		if (event.key !== SETTINGS_STORAGE_EVENT || !event.newValue) return;
		try {
			const section = JSON.parse(event.newValue).section;
			if (["general", "keys", "agent", "models", "appearance", "graph", "compaction", "dictation", "claudeCode"].includes(section)) handler(section);
		} catch { /* Malformed browser metadata is not a settings change. */ }
	};
	window.addEventListener("storage", storage);
	return () => { window.removeEventListener(SETTINGS_SAVED_EVENT, listener); window.removeEventListener("storage", storage); };
}

/** Reader subscription: re-invokes whenever a writer lands, with the
 *  handler captured through a ref so callers never churn the
 *  subscription (and never stale-close over it either). */
export function useSettingsSaved(handler: (section: SettingsSection) => void): void {
	const saved = useRef(handler);
	saved.current = handler;
	useEffect(() => onSettingsSaved((section) => saved.current(section)), []);
}
