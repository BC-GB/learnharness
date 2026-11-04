import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BASE_DATA_ROOT } from "../../config.ts";
import { courseName, DEFAULT_COURSE_ID, isCourseId, type CourseInfo } from "../core/courses.ts";
import { runInCourse, type CourseScope } from "../runtime/course-context.ts";
import { sanitizeUserSettings } from "../core/settings.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const registryFile = path.join(BASE_DATA_ROOT, "courses.json");
const profilesRoot = path.join(BASE_DATA_ROOT, "course-profiles");
export class CourseError extends Error {
	constructor(message: string, readonly status = 400) { super(message); this.name = "CourseError"; }
}
interface Registry { version: 1; courses: CourseInfo[] }
const initialCourse = (): CourseInfo => ({ id: DEFAULT_COURSE_ID, name: courseName(process.env.LH_DEFAULT_COURSE_NAME) ?? "Existing course", createdAt: "1970-01-01T00:00:00.000Z", readOnlyLibrary: true });

function readRegistry(): Registry {
	let raw: string;
	try {
		if (!fs.lstatSync(registryFile).isFile()) throw new CourseError("Course registry needs repair. No course was opened.", 503);
		raw = fs.readFileSync(registryFile, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, courses: [initialCourse()] };
		throw new CourseError("Course registry cannot be read. No course was opened.", 503);
	}
	try {
		const value = JSON.parse(raw) as Registry;
		if (value.version !== 1 || !Array.isArray(value.courses) || value.courses.length < 1 || value.courses.length > 64) throw new Error();
		const ids = new Set<string>();
		for (const entry of value.courses) {
			if (!entry || !isCourseId(entry.id) || courseName(entry.name) !== entry.name || ids.has(entry.id) || typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt)) || entry.readOnlyLibrary !== (entry.id === DEFAULT_COURSE_ID)) throw new Error();
			ids.add(entry.id);
		}
		if (!ids.has(DEFAULT_COURSE_ID)) throw new Error();
		return { version: 1, courses: value.courses.map(({ id, name, createdAt, readOnlyLibrary }) => ({ id, name, createdAt, readOnlyLibrary })) };
	} catch { throw new CourseError("Course registry is invalid. No course was opened.", 503); }
}

/** Course directories are server-minted and never follow aliases into a
 * different profile. Reject substitution again on every request, not just add. */
function checkedDirectory(directory: string): string {
	try {
		const base = fs.realpathSync(BASE_DATA_ROOT);
		const relative = path.relative(BASE_DATA_ROOT, directory);
		if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error();
		let current = BASE_DATA_ROOT;
		for (const part of relative.split(path.sep).filter(Boolean)) {
			current = path.join(current, part);
			if (!fs.lstatSync(current).isDirectory()) throw new Error();
		}
		if (fs.realpathSync(directory) !== path.join(base, relative)) throw new Error();
		return path.resolve(directory);
	} catch { throw new CourseError("Course storage is unavailable. No other course was opened.", 503); }
}

export function listCourses(): CourseInfo[] { return readRegistry().courses; }
export function resolveCourse(id: string): CourseScope {
	if (!isCourseId(id)) throw new CourseError("Unknown course.", 404);
	const entry = readRegistry().courses.find((course) => course.id === id);
	if (!entry) throw new CourseError("Unknown course.", 404);
	if (id === DEFAULT_COURSE_ID) return { id, name: entry.name, dataRoot: BASE_DATA_ROOT, sourceRoot: process.env.LH_SOURCE_ROOT };
	const dataRoot = checkedDirectory(path.join(profilesRoot, id));
	return { id, name: entry.name, dataRoot, sourceRoot: checkedDirectory(path.join(dataRoot, "materials")) };
}

export function addCourse(rawName: unknown): CourseInfo {
	const name = courseName(rawName);
	if (!name) throw new CourseError("Use a course name between 1 and 80 characters.");
	const registry = readRegistry();
	if (registry.courses.length >= 64) throw new CourseError("The course limit has been reached.");
	if (registry.courses.some((course) => course.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new CourseError("A course with this name already exists.");
	fs.mkdirSync(BASE_DATA_ROOT, { recursive: true });
	if (!fs.existsSync(profilesRoot)) fs.mkdirSync(profilesRoot);
	checkedDirectory(profilesRoot);
	const entry: CourseInfo = { id: `course_${randomUUID().replaceAll("-", "")}`, name, createdAt: new Date().toISOString(), readOnlyLibrary: false };
	const directory = path.join(profilesRoot, entry.id);
	fs.mkdirSync(directory);
	fs.mkdirSync(path.join(directory, "materials"));
	// Copy only sanitized, explicitly general preferences. No agent prompts,
	// folder policies, transcripts, graph, notes or course content are copied.
	let preferences;
	try { preferences = sanitizeUserSettings(JSON.parse(fs.readFileSync(path.join(BASE_DATA_ROOT, "settings.json"), "utf8"))); } catch { /* Fresh course can configure models normally. */ }
	if (preferences) runInCourse({ id: entry.id, name: entry.name, dataRoot: directory, sourceRoot: path.join(directory, "materials") }, () => writeFileAtomicSync(path.join(directory, "settings.json"), JSON.stringify({ version: preferences.version, models: preferences.models, appearance: preferences.appearance, general: preferences.general }, null, "\t")));
	registry.courses.push(entry);
	runInCourse({ id: "legacy", name: registry.courses[0]!.name, dataRoot: BASE_DATA_ROOT, sourceRoot: process.env.LH_SOURCE_ROOT }, () => writeFileAtomicSync(registryFile, JSON.stringify(registry, null, "\t") + "\n"));
	return entry;
}

/** Explicit local maintenance only. Model tools and normal activity APIs
 * never receive this cross-course iteration capability. */
export function eachCourseForMaintenance<T>(read: () => T): T[] {
	return listCourses().map((course) => runInCourse(resolveCourse(course.id), read));
}
