import fs from "node:fs";
import path from "node:path";
import { promptsOverrideDir, globalPreferencesEnabled, globalPreferencePath, courseSettingsFile, coursePromptsDir } from "../../config.ts";
import { courseStatePath } from "./course-context.ts";
import { isValidSegmentPath, type PromptMode } from "../core/prompt-segments.ts";

/** Plain Markdown additions stay separate from legacy replacement files.
 * Paths are generated from the same segment grammar and course state guard. */
export function promptCustomizationFile(segment: string, mode: PromptMode): string {
	if (!isValidSegmentPath(segment) || !["append", "replace"].includes(mode)) throw new Error("Invalid prompt customization.");
	if (globalPreferencesEnabled()) return globalPreferencePath(["global-prompts", ...(mode === "append" ? [".additions"] : []), segment].join("/"));
	return courseStatePath(path.join(promptsOverrideDir(), ...(mode === "append" ? [".additions"] : []), ...segment.split("/")));
}

export function promptStoreDirectory(directory: string): string {
	if (!globalPreferencesEnabled()) return courseStatePath(directory);
	const relative = path.relative(promptsOverrideDir(), directory).split(path.sep).join("/");
	return globalPreferencePath(relative ? `global-prompts/${relative}` : "global-prompts");
}

export function globalPromptSwitches(): Record<string, boolean> {
	if (!globalPreferencesEnabled()) return {};
	try {
		const raw = JSON.parse(fs.readFileSync(globalPreferencePath("global-settings.json"), "utf8"))?.agent?.prompts;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return Object.fromEntries(Object.entries(raw).filter(([key, value]) => isValidSegmentPath(key) && value === true)) as Record<string, boolean>;
	} catch { return {}; }
}

/** Pre-global prompt files remain private course guidance. Never copy them
 * into the shared preference store or expose them in the global editor. */
export function readCoursePromptGuidance(segment: string): { text: string; mode: PromptMode } | null {
	if (!globalPreferencesEnabled() || !isValidSegmentPath(segment)) return null;
	try {
		const record = JSON.parse(fs.readFileSync(courseSettingsFile(), "utf8"));
		if (record?.agent?.prompts?.[segment] !== true) return null;
		for (const mode of ["append", "replace"] as const) {
			const file = courseStatePath(path.join(coursePromptsDir(), ...(mode === "append" ? [".additions"] : []), ...segment.split("/")));
			try { return { text: fs.readFileSync(file, "utf8"), mode }; }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null; }
		}
	} catch { /* Missing/unreadable course guidance never reads another course. */ }
	return null;
}

export function readPromptCustomization(segment: string): { text: string; mode: PromptMode } | null {
	if (!isValidSegmentPath(segment)) return null;
	for (const mode of ["append", "replace"] as const) {
		try { return { text: fs.readFileSync(promptCustomizationFile(segment, mode), "utf-8"), mode }; }
		catch (error) {
			// An inaccessible/aliased addition cannot reactivate an old
			// replacement unexpectedly. Missing additions retain legacy behaviour.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
		}
	}
	return null;
}
