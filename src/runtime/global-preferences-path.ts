import fs from "node:fs";
import path from "node:path";
import { isValidSegmentPath } from "../core/prompt-segments.ts";
import { isThemeId } from "../core/themes.ts";

function themePreference(relative: string, allowDirectory = false): boolean {
	if (allowDirectory && relative === "themes") return true;
	const parts = relative.split("/");
	return parts.length === 2 && parts[0] === "themes" && parts[1]!.endsWith(".json") && isThemeId(parts[1]!.slice(0, -5));
}

function canonical(file: string): string {
	try { return fs.realpathSync(file); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const parent = path.dirname(file);
		if (parent === file) throw error;
		return path.join(/* turbopackIgnore: true */ canonical(parent), path.basename(file));
	}
}

/** Explicit shared preferences only; this is not a cross-course state guard. */
export function sharedPreferencePath(root: string, relative: string): string {
	const parts = relative.split("/");
	const promptParts = parts[1] === ".additions" ? parts.slice(2) : parts.slice(1);
	const promptKey = promptParts.join("/");
	const directory = promptKey === "" || ["teacher", "prober", "practice", "shared"].includes(promptKey);
	if (!themePreference(relative, true) && !/^global-plugin-(drawing-pad|rich-code-blocks|flashcards)\.json$/.test(relative) && relative !== "global-plugins.json" && relative !== "global-settings.json" && relative !== "preference-history.json" && !(parts[0] === "global-prompts" && (directory || isValidSegmentPath(promptKey)))) throw new Error("Invalid global preference path.");
	const target = path.join(/* turbopackIgnore: true */ root, ...parts);
	if (canonical(target) !== path.join(/* turbopackIgnore: true */ canonical(root), ...parts)) throw new Error("Global preferences cannot use aliased paths.");
	return target;
}

export function sharedPreferencesExist(root: string): boolean {
	try { fs.lstatSync(path.join(/* turbopackIgnore: true */ root, "global-settings.json")); return true; }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function sharedPreferenceFile(root: string, file: string): string | undefined {
	const relative = path.relative(root, file).split(path.sep).join("/");
	const parts = relative.split("/");
	const key = (parts[1] === ".additions" ? parts.slice(2) : parts.slice(1)).join("/");
	if (!themePreference(relative) && !/^global-plugin-(drawing-pad|rich-code-blocks|flashcards)\.json$/.test(relative) && relative !== "global-plugins.json" && relative !== "global-settings.json" && relative !== "preference-history.json" && !(parts[0] === "global-prompts" && isValidSegmentPath(key))) return undefined;
	return sharedPreferencePath(root, relative);
}
