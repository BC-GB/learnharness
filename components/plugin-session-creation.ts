import { courseFetch, courseUrlForId, documentCourse } from "@/lib/course-client";
import { stashOpeningPrompt, clearOpeningPrompt } from "./opening-prompt";
import type { PluginCreatedSession } from "@/src/core";

interface Host {
	fetch: typeof fetch;
	course(): string;
	stage(id: string, text: string, course: string): boolean;
	clear(id: string, course: string): void;
}
const native: Host = { fetch: courseFetch, course: documentCourse,
	stage: (id, text, course) => stashOpeningPrompt(id, text, false, course),
	clear: (id, course) => { clearOpeningPrompt(id, course); },
};
/** The same host route and draft format as native Send; ownership survives awaits. */
export async function createPluginSession(input: { title: string; kind: "teaching" | "practice" }, signal: AbortSignal, host: Host = native): Promise<PluginCreatedSession> {
	signal.throwIfAborted(); const course = host.course();
	if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.length > 1000 || !["teaching", "practice"].includes(input.kind)) throw new Error("Invalid native session request");
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (course !== "legacy") headers["x-learnharness-course"] = course;
	const response = await host.fetch(courseUrlForId("/api/chats", course), { method: "POST", headers, signal,
		body: JSON.stringify({ title: input.title, ...(input.kind === "practice" ? { kind: "practice" } : {}) }),
	});
	signal.throwIfAborted();
	if (host.course() !== course) throw new Error("Course changed while creating the session");
	if (!response.ok) throw new Error("Could not create the native session");
	const value = await response.json(); signal.throwIfAborted();
	if (host.course() !== course || typeof value?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) throw new Error("Invalid or stale native session response");
	const id: string = value.id;
	return Object.freeze({ id,
		stageOpeningPrompt(text: string) {
			if (signal.aborted || host.course() !== course || typeof text !== "string" || !text.trim() || text.length > 100_000) return false;
			return host.stage(id, text, course);
		},
		clearOpeningPrompt() { host.clear(id, course); },
	});
}
