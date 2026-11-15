import fs from "node:fs";
import path from "node:path";
import { safePath, atomicWrite } from "./storage.ts";
import { validOutlineId, type LessonOutline, type LegacyLessonOutline } from "./contracts.ts";

export function createOutlineStore(directory: string, legacyDirectory: string) {
function file(id: string, legacy = false, read = false): string {
 if (!validOutlineId(id)) throw new Error("Invalid lesson identity");
 const own = safePath(directory, "outlines-v2/" + id + ".json");
 if (legacy || (read && !fs.existsSync(own))) return safePath(legacyDirectory, (legacy ? "lesson-outlines/" : "lesson-outlines-v2/") + id + ".json");
 return own;
}
function readLessonOutline(id: string): LessonOutline | null {
	try {
		const target = file(id, false, true); if (fs.statSync(target).size > 512 * 1024) throw new Error("Outline too large");
		const value = JSON.parse(fs.readFileSync(target, "utf8"));
		if (value.version !== 2 || value.chatId !== id || !Array.isArray(value.groups) || value.groups.length > 8) throw new Error("Invalid saved outline");
		return value;
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** Earlier files remain unchanged and usable by rollback. */
function readLegacyLessonOutline(id: string): LegacyLessonOutline | null {
	try {
		const target = file(id, true); if (fs.statSync(target).size > 512 * 1024) throw new Error("Outline too large");
		const value = JSON.parse(fs.readFileSync(target, "utf8"));
		if (value.version !== 1 || value.chatId !== id || !Array.isArray(value.topics) || value.topics.length > 100) throw new Error("Invalid legacy outline");
		return value;
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function writeLessonOutline(value: LessonOutline): void {
	const target = file(value.chatId); const bytes = JSON.stringify(value);
	if (Buffer.byteLength(bytes) > 512 * 1024) throw new Error("Outline too large");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	atomicWrite(target, bytes);
}

return { readLessonOutline, readLegacyLessonOutline, writeLessonOutline };
}
