import { courseLocal, currentCourseId } from "../../src/runtime/course-context.ts";

/** Fault/status fixtures address the selected namespace's globalThis slot.
 * Production never reads the former unscoped __lhExtractionRuns/WakePipeline.
 * Tests retain their original assertions and restore the exact prior object. */
export function courseRuntimeSlot<T>(key: string): { current: T | undefined } {
	return {
		get current() { return (globalThis as typeof globalThis & { __lhCourseRuntime?: { locals: Map<string, Map<string, unknown>> } }).__lhCourseRuntime?.locals.get(currentCourseId())?.get(key) as T | undefined; },
		set current(value) {
			courseLocal(key, () => undefined);
			const runtime = (globalThis as typeof globalThis & { __lhCourseRuntime?: { locals: Map<string, Map<string, unknown>> } }).__lhCourseRuntime!;
			const local = runtime.locals.get(currentCourseId())!;
			if (value === undefined) local.delete(key); else local.set(key, value);
		},
	};
}
