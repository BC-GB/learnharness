import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

/** A server-validated course binding. Names are metadata, never path segments.
 * AsyncLocalStorage carries the binding through promises, timers and workers'
 * orchestration; model tools cannot change it. Browser filtering is not a gate. */
export interface CourseScope {
	id: string;
	name: string;
	dataRoot: string;
	sourceRoot: string | undefined;
}

interface Runtime {
	context: AsyncLocalStorage<Readonly<CourseScope> | undefined>;
	known: Map<string, Readonly<CourseScope>>;
	locals: Map<string, Map<string, unknown>>;
}
const global = globalThis as typeof globalThis & { __lhCourseRuntime?: Runtime };
function runtime(): Runtime {
	return global.__lhCourseRuntime ??= { context: new AsyncLocalStorage(), known: new Map(), locals: new Map() };
}

export function currentCourse(): Readonly<CourseScope> | undefined { return runtime().context.getStore(); }
export function currentCourseId(): string { return currentCourse()?.id ?? "legacy"; }

function realOrMissing(file: string): string {
	try { return fs.realpathSync(file); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const parent = path.dirname(file);
		if (parent === file) throw error;
		return path.join(realOrMissing(parent), path.basename(file));
	}
}
function inside(file: string, root: string): boolean {
	const relative = path.relative(root, file);
	return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** Guard named AND canonical state paths, including reads and leaf aliases.
 * The legacy profile does not own the new profiles nested under its old root.
 * Unbound fixture/CLI calls retain the pre-course data-location contract. */
export function courseStatePath(file: string): string {
	const scope = currentCourse();
	if (!scope) return file;
	const absolute = path.resolve(file);
	const root = path.resolve(scope.dataRoot);
	if (!inside(absolute, root) || (scope.id === "legacy" && inside(absolute, path.join(root, "course-profiles")))) throw new Error("State access is outside the selected course.");
	const canonicalRoot = realOrMissing(root);
	const canonical = realOrMissing(absolute);
	if (!inside(canonical, canonicalRoot) || (scope.id === "legacy" && inside(canonical, path.join(canonicalRoot, "course-profiles")))) throw new Error("State alias escapes the selected course.");
	return absolute;
}

export function runInCourse<T>(scope: CourseScope, work: () => T): T {
	const existing = runtime().known.get(scope.id);
	if (existing && (existing.dataRoot !== scope.dataRoot || existing.sourceRoot !== scope.sourceRoot)) throw new Error("Course binding changed; restart before using this course.");
	const bound = Object.freeze({ ...scope });
	runtime().known.set(scope.id, bound);
	return runtime().context.run(bound, work);
}

/** Runtime-only state must follow the same namespace as persistent records.
 * Each key is owned by one module; no transcripts are shared through globals. */
export function courseLocal<T>(key: string, create: () => T): T {
	const id = currentCourseId();
	let locals = runtime().locals.get(id);
	if (!locals) { locals = new Map(); runtime().locals.set(id, locals); }
	if (!locals.has(key)) locals.set(key, create());
	return locals.get(key) as T;
}

/** Account connection notifications may wake each course's OWN work. No
 * course data is passed between callbacks; their original binding is restored. */
export function forEachKnownCourse(work: () => void): void {
	for (const scope of runtime().known.values()) runtime().context.run(scope, work);
	if (!runtime().known.has("legacy")) runtime().context.run(undefined, work);
}
