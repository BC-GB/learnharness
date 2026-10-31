import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";

import * as path from "node:path";

/** Read-only model tools confined to an explicitly approved source library. */

/** 50KB — pi's DEFAULT_MAX_BYTES, the output ceiling for every fs tool. */
export const MAX_OUTPUT_BYTES = 50 * 1024;
/** pi's grep line-truncation length (GREP_MAX_LINE_LENGTH). */
export const GREP_MAX_LINE_LENGTH = 500;
/** Wall-clock budget for tree walks (find/grep over a whole home dir). */
export const WALK_TIMEOUT_MS = 10_000;

/**
 * Directory names never entered during walks. node_modules/.git mirror pi's
 * fd/rg defaults; Library/.Trash are the home-root noise the user approved
 * (2026-09-19) — caches, app support, and the trash live under them.
 * Explicit paths (ls/read of ~/Library/…) are NOT filtered — only walks.
 */
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", "Library", ".Trash"]);

/** Require a configured root and reject lexical or canonical path escapes. */
export function resolveSourcePath(p?: string): string {
	const configuredRoot = process.env.LH_SOURCE_ROOT;
	if (!configuredRoot) throw new Error("Source access requires an explicitly configured LH_SOURCE_ROOT.");
	// Both the lexical path and real target must stay within the read-only
	// course snapshot. This excludes traversal, prefix collisions and symlinks.
	const root = realpathSync(configuredRoot);
	const candidate = path.resolve(root, p || '.');
	const within = (value: string) => value === root || value.startsWith(root + path.sep);
	if (!within(candidate)) throw new Error('Source access is restricted to the course library.');
	const resolved = realpathSync(candidate);
	if (!within(resolved)) throw new Error('Source access is restricted to the course library.');
	return resolved;
}

/** pi's formatSize idiom (50KB prints as "50.0KB"). */
export function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** Cap output to MAX_OUTPUT_BYTES on whole lines, pi's truncateHead idiom. */
export function capOutput(lines: string[]): { content: string; truncated: boolean } {
	const out: string[] = [];
	for (const line of lines) {
		const candidate = [...out, line].join("\n");
		if (Buffer.byteLength(candidate, "utf-8") > MAX_OUTPUT_BYTES) {
			return { content: out.join("\n"), truncated: true };
		}
		out.push(line);
	}
	return { content: out.join("\n"), truncated: false };
}

/** Expand top-level brace alternatives: '*.{ts,tsx}' → ['*.ts', '*.tsx'].
 *  Nested braces are out of scope (pi's fd handles them; models rarely
 *  emit them — a non-expanding literal match is the graceful fallback). */
export function expandBraces(pattern: string): string[] {
	if (pattern.length > 256 || (pattern.match(/\{/g) ?? []).length > 1) throw new Error("Glob is too complex.");
	const open = pattern.indexOf("{");
	if (open === -1) return [pattern];
	const close = pattern.indexOf("}", open);
	if (close === -1) return [pattern];
	const before = pattern.slice(0, open);
	const after = pattern.slice(close + 1);
	const alts: string[] = [];
	for (const alt of pattern.slice(open + 1, close).split(",")) {
		alts.push(...expandBraces(before + alt + after));
	}
	return alts;
}

/** Bounded dynamic-programming glob matcher; no regex backtracking. */
export function globToRegex(glob: string): { test(value: string): boolean } {
 if (glob.length > 256) throw new Error("Glob is too complex.");
 const tokens: { char?: string; star?: boolean; cross?: boolean; any?: boolean }[] = [];
 for (let i = 0; i < glob.length; i++) {
  if (glob[i] === "*") {
   const cross = glob[i + 1] === "*";
   if (cross) { i++; if (glob[i + 1] === "/") i++; }
   tokens.push({ star: true, cross });
  } else if (glob[i] === "?") tokens.push({ any: true });
  else tokens.push({ char: glob[i] });
 }
 return { test(value) {
  if (value.length > 32768) return false;
  let previous = new Uint8Array(value.length + 1); previous[0] = 1;
  for (const token of tokens) {
   const next = new Uint8Array(value.length + 1);
   if (token.star) next[0] = previous[0]!;
   for (let i = 1; i <= value.length; i++) {
    if (token.star) next[i] = previous[i]! || ((token.cross || value[i - 1] !== "/") ? next[i - 1]! : 0);
    else next[i] = previous[i - 1]! && (token.any ? value[i - 1] !== "/" : value[i - 1] === token.char) ? 1 : 0;
   }
   previous = next;
  }
  return previous[value.length] === 1;
 } };
}

/**
 * pi/fd's matching rule: a pattern with no slash matches against the
 * BASENAME at any depth; one with a slash matches the relative path, with
 * an implied leading "**-slash" prefix unless it is itself anchored (see
 * the code below — the literal sequence cannot appear in this comment
 * because it terminates block comments).
 */
export function matchGlob(relativePath: string, pattern: string): boolean {
	const posix = relativePath.split(path.sep).join("/");
	const basename = posix.split("/").pop() ?? posix;
	for (const alt of expandBraces(pattern)) {
		if (!alt.includes("/")) {
			if (globToRegex(alt).test(basename)) return true;
		} else {
			let effective = alt;
			if (!effective.startsWith("/") && !effective.startsWith("**/") && effective !== "**") {
				effective = `**/${effective}`;
			}
			if (effective.startsWith("/")) effective = effective.slice(1);
			if (globToRegex(effective).test(posix)) return true;
		}
	}
	return false;
}

/**
 * Depth-first walk under `root`, never entering EXCLUDED_DIR_NAMES.
 * `visit` receives absolute file paths; returning true STOPS the walk
 * (find's result limit). The deadline bounds a home-dir walk to
 * WALK_TIMEOUT_MS — partial results are the graceful degradation.
 */
export async function walkFiles(
	root: string,
	visit: (filePath: string) => boolean | Promise<boolean>,
	signal?: AbortSignal,
): Promise<{ timedOut: boolean; aborted: boolean }> {
	const deadline = Date.now() + WALK_TIMEOUT_MS;
	let timedOut = false;
	let aborted = false;
	if (signal?.aborted) return { timedOut: false, aborted: true };

	const walkDir = async (dir: string): Promise<boolean> => {
		if (Date.now() > deadline) {
			timedOut = true;
			return true; // stop
		}
		if (signal?.aborted) {
			aborted = true;
			return true; // stop — abort yields partial results, not a throw
		}
		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return false; // unreadable dir (permissions): skip, keep walking
		}
		for (const entry of entries) {
			if (Date.now() > deadline) {
				timedOut = true;
				return true;
			}
			if (signal?.aborted) {
				aborted = true;
				return true;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
				if (await walkDir(full)) return true;
			} else if (entry.isFile()) {
				if (await visit(full)) return true;
			}
			// symlinks/other: not followed (pi's fd doesn't follow either)
		}
		return false;
	};

	await walkDir(root);
	return { timedOut, aborted };
}

/** True if the first 8KB chunk contains a NUL byte — pi/rg's binary skip. */
export async function isBinaryFile(filePath: string): Promise<boolean> {
	const handle = await fs.open(filePath, "r");
	try {
		const buf = Buffer.alloc(8192);
		const { bytesRead } = await handle.read(buf, 0, 8192, 0);
		return buf.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

/** pi's GREP_MAX_LINE_LENGTH line truncation (no mid-word care, hard cap). */
export function truncateGrepLine(line: string): { text: string; wasTruncated: boolean } {
	if (line.length <= GREP_MAX_LINE_LENGTH) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, GREP_MAX_LINE_LENGTH)}… [truncated]`, wasTruncated: true };
}
