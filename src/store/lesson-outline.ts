import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { courseStatePath } from "../runtime/course-context.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";
import { validOutlineId, type LessonOutline, type LegacyLessonOutline } from "../core/lesson-outline.ts";

function file(id: string, legacy = false): string {
	if (!validOutlineId(id)) throw new Error("Invalid lesson identity");
	const target = courseStatePath(path.join(PATHS.data, legacy ? "lesson-outlines" : "lesson-outlines-v2", id + ".json"));
	let at = target;
	for (;;) {
		try { if (fs.realpathSync(at) !== path.resolve(at)) throw new Error("Outline aliases are not allowed"); break; }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		const parent = path.dirname(at); if (parent === at) throw new Error("Outline directory unavailable"); at = parent;
	}
	return target;
}
export function readLessonOutline(id: string): LessonOutline | null {
	try {
		const target = file(id); if (fs.statSync(target).size > 512 * 1024) throw new Error("Outline too large");
		const value = JSON.parse(fs.readFileSync(target, "utf8"));
		if (value.version !== 2 || value.chatId !== id || !Array.isArray(value.groups) || value.groups.length > 8) throw new Error("Invalid saved outline");
		return value;
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** Earlier files remain unchanged and usable by rollback. */
export function readLegacyLessonOutline(id: string): LegacyLessonOutline | null {
	try {
		const target = file(id, true); if (fs.statSync(target).size > 512 * 1024) throw new Error("Outline too large");
		const value = JSON.parse(fs.readFileSync(target, "utf8"));
		if (value.version !== 1 || value.chatId !== id || !Array.isArray(value.topics) || value.topics.length > 100) throw new Error("Invalid legacy outline");
		return value;
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export function writeLessonOutline(value: LessonOutline): void {
	const target = file(value.chatId); const bytes = JSON.stringify(value);
	if (Buffer.byteLength(bytes) > 512 * 1024) throw new Error("Outline too large");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	writeFileAtomicSync(target, bytes);
}
