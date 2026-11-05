import { DEFAULT_COURSE_ID, isCourseId } from "@/src/core";

/** Per document, never a global cookie/localStorage selection. A stale tab
 * keeps its course while another tab can study something else. */
export function documentCourse(): string {
	return typeof document === "undefined" ? DEFAULT_COURSE_ID : document.documentElement.dataset.courseId ?? DEFAULT_COURSE_ID;
}

export function courseUrlForId(href: string, id: string): string {
	if (!isCourseId(id)) throw new Error("Unknown course.");
	if (!href.startsWith("/") || href.startsWith("//")) return href;
	const url = new URL(href, "http://learnharness.invalid");
	const selected = url.searchParams.getAll("course");
	if (selected.length > 1 || (selected.length === 1 && selected[0] !== id)) throw new Error("Conflicting course selection.");
	if (id !== DEFAULT_COURSE_ID) url.searchParams.set("course", id);
	return url.pathname + url.search + url.hash;
}

export function courseUrl(href: string): string { return courseUrlForId(href, documentCourse()); }

/** Fetch only adds a namespace to same-origin application APIs. Provider
 * transport and the credential broker are never modified by this helper. */
export const courseFetch: typeof fetch = (input, init) => {
	const origin = typeof location === "undefined" ? "http://learnharness.invalid" : location.origin;
	const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const url = new URL(raw, origin);
	if (url.origin !== origin || !url.pathname.startsWith("/api/")) return globalThis.fetch(input, init);
	const id = documentCourse();
	const scoped = courseUrlForId(url.pathname + url.search, id);
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
	const previous = headers.get("x-learnharness-course");
	if (previous !== null && previous !== id) throw new Error("Conflicting course selection.");
	if (id !== DEFAULT_COURSE_ID) headers.set("x-learnharness-course", id);
	// Preserve legacy relative URLs for existing integrations and injectable mocks.
	const target = input instanceof Request ? new Request(new URL(scoped, origin), input) : scoped;
	return globalThis.fetch(target, { ...init, headers });
};
