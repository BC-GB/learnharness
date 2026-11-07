import fs from "node:fs";
import path from "node:path";
import { isValidSegmentPath } from "../core/prompt-segments.ts";

function canonical(file: string): string {
	try { return fs.realpathSync(file); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const parent = path.dirname(file);
		if (parent === file) throw error;
		return path.join(canonical(parent), path.basename(file));
	}
}

/** Explicit shared preferences only; this is not a cross-course state guard. */
export function sharedPreferencePath(root: string, relative: string): string {
	const parts = relative.split("/");
	const promptParts = parts[1] === ".additions" ? parts.slice(2) : parts.slice(1);
	const promptKey = promptParts.join("/");
	const directory = promptKey === "" || ["teacher", "prober", "practice", "shared"].includes(promptKey);
	if (relative !== "global-settings.json" && !(parts[0] === "global-prompts" && (directory || isValidSegmentPath(promptKey)))) throw new Error("Invalid global preference path.");
	const target = path.join(root, ...parts);
	if (canonical(target) !== path.join(canonical(root), ...parts)) throw new Error("Global preferences cannot use aliased paths.");
	return target;
}

export function sharedPreferencesExist(root: string): boolean {
	try { fs.lstatSync(path.join(root, "global-settings.json")); return true; }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function sharedPreferenceFile(root: string, file: string): string | undefined {
	const relative = path.relative(root, file).split(path.sep).join("/");
	const parts = relative.split("/");
	const key = (parts[1] === ".additions" ? parts.slice(2) : parts.slice(1)).join("/");
	if (relative !== "global-settings.json" && !(parts[0] === "global-prompts" && isValidSegmentPath(key))) return undefined;
	return sharedPreferencePath(root, relative);
}
