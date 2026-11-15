import { currentCourse } from "../runtime/course-context.ts";
import { sourceSearchRoots } from "./tools/fs-shared.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";

/** Per-turn routing metadata, never file contents or a cross-course inventory. */
export function courseLibraryContext(): string {
	const course = currentCourse();
	if (!course) return "";
	let roots: string[];
	try { roots = sourceSearchRoots().roots; }
	catch {
		return JSON.stringify({ name: course.name, roots: [], available: false });
	}
	return JSON.stringify({ name: course.name, roots: roots.slice(0, 8), available: true });
}

/** Bind the existing file tools without changing their schema or execution. */
export function bindCourseLibrary(tools: AgentTool<any, any>[]): AgentTool<any, any>[] {
	const metadata = courseLibraryContext();
	if (!metadata) return tools;
	return tools.map(tool => ["read", "ls", "find", "grep"].includes(tool.name)
		? { ...tool, description: `${tool.description}\n\nSource library metadata: ${metadata}` }
		: tool);
}
