import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PluginLibrary, PluginLibraryFile } from "../core/plugin-library.ts";
import { currentCourse, currentCourseId, runInCourse } from "../runtime/course-context.ts";
import { resolveCourse } from "../store/courses.ts";
import { approvedSourceRoot, matchGlob, resolveSourcePath, sourceSearchRoots, WALK_TIMEOUT_MS } from "../agent/tools/fs-shared.ts";
import { resolvePolicy } from "../agent/tools/file-access.ts";

const TEXT = /\.(?:md|txt|csv|r|py|json|qmd|tex|ipynb|js|ts)$/i;
const MAX_BYTES = 512 * 1024;
/** Capture the validated activation, including deferred calls from another tab. */
export function createPluginLibrary(signal: AbortSignal): PluginLibrary {
	const scope = currentCourse() ?? resolveCourse(currentCourseId());
	const bound = <T>(read: () => T): T => runInCourse(scope, () => { signal.throwIfAborted(); return read(); });
	return {
		list: options => bound(async () => {
			const limit = options?.limit ?? 500, pattern = options?.pattern ?? "*";
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || typeof pattern !== "string") throw new Error("Invalid library search bounds");
			// Validate even an empty library's pattern before walking.
			matchGlob("example.md", pattern);
			const root = approvedSourceRoot(), policy = resolvePolicy();
			const roots = sourceSearchRoots(undefined, policy).roots;
			const files: PluginLibraryFile[] = []; const seen = new Set<string>();
			let truncated = false, bytes = 0, examined = 0;
			const deadline = Date.now() + WALK_TIMEOUT_MS;
			const walk = (directory: string, depth: number): void => {
				if (depth > 7) { truncated = true; return; }
				for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
					if (++examined > 2000 || Date.now() >= deadline) { truncated = true; return; }
					if (entry.isSymbolicLink() || entry.name.startsWith(".") || ["node_modules", "Library"].includes(entry.name)) continue;
					const filename = path.join(directory, entry.name);
					try { resolveSourcePath(filename, policy); } catch { continue; }
					if (entry.isDirectory()) { walk(filename, depth + 1); if (examined > 2000 || bytes >= 48 * 1024 || files.length >= limit) return; continue; }
					if (!entry.isFile()) continue;
					const relative = path.relative(root, filename).split(path.sep).join("/");
					if (!TEXT.test(relative) || !matchGlob(relative, pattern) || seen.has(relative)) continue;
					const item = { path: relative, name: path.basename(filename), bytes: fs.statSync(filename).size };
					const size = Buffer.byteLength(JSON.stringify(item));
					if (files.length >= limit || bytes + size > 48 * 1024) { truncated = true; return; }
					seen.add(relative); files.push(item); bytes += size;
				}
			};
			for (const directory of roots) {
				walk(directory, 0);
				if (examined > 2000 || bytes >= 48 * 1024 || files.length >= limit) { truncated = true; break; }
			}
			signal.throwIfAborted();
			return { name: scope.name, files, truncated };
		}),
		read: options => bound(() => {
			const requested = options?.path, offset = options?.offset ?? 0, limit = options?.limit ?? 20_000;
			if (typeof requested !== "string" || !requested || requested.includes("\\") || path.isAbsolute(requested) || requested.split("/").some(p => p === ".." || p.startsWith(".")) || !TEXT.test(requested)) throw new Error("Use a relative text path inside the selected course library");
			if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BYTES) throw new Error("Invalid library read bounds");
			const filename = resolveSourcePath(requested);
			const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
			try {
				const stat = fs.fstatSync(fd);
				if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Library text exceeds the 512 KiB file limit");
				const raw = fs.readFileSync(fd);
				if (raw.length > MAX_BYTES || raw.includes(0)) throw new Error("Unsupported or oversized library text");
				const text = new TextDecoder("utf-8", { fatal: true }).decode(raw), start = Math.min(offset, text.length), end = Math.min(start + limit, text.length);
				return { path: requested, text: text.slice(start, end), characters: text.length, offset: start, nextOffset: end < text.length ? end : null, sha256: createHash("sha256").update(raw).digest("hex") };
			} finally { fs.closeSync(fd); }
		}),
	};
}
