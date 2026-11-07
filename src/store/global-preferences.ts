import fs from "node:fs";
import path from "node:path";
import { SETTINGS_FILE, globalPreferencePath, globalPreferencesEnabled } from "../../config.ts";
import type { UserSettings } from "../core/settings.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";
import { readSettings } from "./settings.ts";
import { currentCourse } from "../runtime/course-context.ts";

/** Explicit setup migration, run under the maintenance ingress lock.
 * Existing course records/guidance are retained byte-for-byte for recovery.
 * Only known app preferences are shared; no old prompt text or unknown data. */
export function initialiseGlobalPreferences(addition: string): { created: boolean; files: string[] } {
	if (globalPreferencesEnabled()) return { created: false, files: [] };
	if (currentCourse() && currentCourse()!.id !== "legacy") throw new Error("Global setup must run in the main preference context.");
	if (typeof addition !== "string" || !addition.trim() || Buffer.byteLength(addition) > 16 * 1024) throw new Error("Supply a short global teaching addition.");
	let previous: UserSettings | null = null;
	try {
		if (fs.realpathSync(SETTINGS_FILE) !== path.resolve(SETTINGS_FILE)) throw new Error("Aliased settings");
		JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
		previous = readSettings();
		if (!previous) throw new Error("Invalid preferences");
	}
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Existing preferences are unreadable; migration stopped."); }
	const next: UserSettings = { version: previous?.version ?? 1 };
	for (const key of ["general", "dictation", "claudeCode", "models", "customProvider", "appearance", "graph", "compaction"] as const) {
		if (previous?.[key] !== undefined) (next as Record<string, unknown>)[key] = previous[key];
	}
	// Switches for course-specific old prompt files never become global.
	const { prompts: _coursePrompts, ...agent } = previous?.agent ?? {};
	next.agent = { ...agent, prompts: { "shared/10-voice.md": true } };
	const prompt = globalPreferencePath("global-prompts/.additions/shared/10-voice.md");
	const record = globalPreferencePath("global-settings.json");
	if (fs.existsSync(prompt)) throw new Error("Uncommitted global instructions exist; review before migration.");
	fs.mkdirSync(path.dirname(prompt), { recursive: true });
	writeFileAtomicSync(prompt, addition, { allowInPlaceFallback: true });
	try {
		// The record is the activation marker, published last. No partially
		// prepared instructions replace course behaviour before this commit.
		writeFileAtomicSync(record, JSON.stringify(next, null, "\t"), { allowInPlaceFallback: true });
	} catch (error) { fs.unlinkSync(prompt); throw error; }
	return { created: true, files: ["data/global-settings.json", "data/global-prompts/.additions/shared/10-voice.md"] };
}
