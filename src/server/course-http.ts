import { CourseError, resolveCourse } from "../store/courses.ts";
import { DEFAULT_COURSE_ID, isCourseId } from "../core/courses.ts";
import { runInCourse, currentCourseId, currentCourse } from "../runtime/course-context.ts";
import { setEventScopeProvider } from "../core/events.ts";

setEventScopeProvider(currentCourseId);

export function requestedCourse(headers: Headers, url?: string): string {
	const header = headers.get("x-learnharness-course");
	const query = url ? new URL(url).searchParams.getAll("course") : [];
	if (query.length > 1 || (header !== null && query.length && header !== query[0])) throw new CourseError("Conflicting course selection.");
	const selected = header ?? query[0] ?? DEFAULT_COURSE_ID;
	if (!isCourseId(selected)) throw new CourseError("Unknown course.", 404);
	return selected;
}

/** Bind BEFORE the first store access. Rejections never fall back to the
 * legacy course. The binding survives streamed/background continuations. */
export function courseRoute<F extends (...args: any[]) => any>(handler: F): F {
	const reject = (error: unknown) => {
		if (error instanceof CourseError) return Response.json({ error: error.message, code: "course_unavailable" }, { status: error.status, headers: { "Cache-Control": "no-store" } });
		throw error;
	};
	return ((...args: Parameters<F>) => {
		try {
			const request = args[0] as Request | undefined;
			const invoke = () => handler(...args);
			let result;
			if (!request) result = invoke(); // framework-free fixture/internal call retains its explicit context
			else {
				const scope = resolveCourse(requestedCourse(request.headers, request.url));
				if (currentCourse() && currentCourseId() !== scope.id) throw new CourseError("Course selection changed inside a bound request.");
				result = runInCourse(scope, invoke);
			}
			// Preserve synchronous GET adapters used by both route composition and
			// callers, while retaining fail-closed errors after an async handler.
			return result instanceof Promise ? result.catch(reject) : result;
		} catch (error) { return reject(error); }
	}) as F;
}

export async function coursePage<T>(work: () => T): Promise<Awaited<T>> {
	const { headers } = await import("next/headers");
	const requestHeaders = await headers();
	const id = requestHeaders.get("x-lh-page-course") ?? DEFAULT_COURSE_ID;
	try { return await runInCourse(resolveCourse(id), work); }
	catch (error) {
		if (error instanceof CourseError && error.status === 404) { const { notFound } = await import("next/navigation"); notFound(); }
		throw error;
	}
}

export { listCourses, addCourse, CourseError } from "../store/courses.ts";
export { currentCourse } from "../runtime/course-context.ts";
