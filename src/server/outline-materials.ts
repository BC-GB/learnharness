import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { currentCourse } from "../runtime/course-context.ts";
import type { OutlineSource } from "../core/lesson-outline.ts";

const excluded = new Set(["apps", "practice", "my notes", "assignment work", "original files", "supporting files", "node_modules", "course-profiles"]);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(w => !["the", "and", "for", "with", "this", "that", "from", "what", "which", "course", "lecture"].includes(w)));
/** No model file tools. Bounded, canonical, selected-course Markdown only. */
export function outlineMaterials(query: string, previous: { path: string; quote: string }[] = []): OutlineSource[] {
	const root = currentCourse()?.sourceRoot; if (!root) return [];
	if (fs.realpathSync(root) !== path.resolve(root)) throw new Error("Aliased course library");
	const wanted = words(query); const candidates: { path: string; text: string; score: number }[] = [];
	let entries = 0; let bytes = 0;
	function walk(dir: string, depth: number): void {
		if (depth > 7 || entries >= 2000 || bytes >= 8 * 1024 * 1024) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (++entries > 2000) break;
			if (e.name.startsWith(".") || e.isSymbolicLink() || excluded.has(e.name.toLowerCase())) continue;
			const target = path.join(dir, e.name);
			if (fs.realpathSync(target) !== target) continue;
			if (e.isDirectory()) { walk(target, depth + 1); continue; }
			if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
			const size = fs.statSync(target).size; if (size > 512 * 1024 || bytes + size > 8 * 1024 * 1024) continue;
			bytes += size; const text = fs.readFileSync(target, "utf8"); const relative = path.relative(root!, target).split(path.sep).join("/");
			const fileWords = words(relative); const bodyWords = words(text);
			const score = (previous.some(p => p.path === relative) ? 1000 : 0) + [...wanted].reduce((sum, word) => sum + (fileWords.has(word) ? 8 : 0) + (bodyWords.has(word) ? 1 : 0), 0);
			if (!/^(?:materials|index|readme|agents)\.(?:md|txt)$/i.test(e.name)) candidates.push({ path: relative, text, score });
		}
	}
	walk(root, 0);
	// Retained earlier editions do not compete with their numbered revision.
	const editions = new Map<string, { version: number; source: typeof candidates[number] }>();
	for (const source of candidates) {
		const revision = source.path.match(/\s*\(v(\d+)\)(?=\.md$)/i);
		const key = source.path.replace(/\s*\(v\d+\)(?=\.md$)/i, "").toLowerCase();
		const version = revision ? Number(revision[1]) : 1;
		if (!editions.has(key) || editions.get(key)!.version < version) editions.set(key, { version, source });
	}
	return [...editions.values()].map(v => v.source).filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 3).map((source) => {
		const lines = source.text.split("\n"); let at = 0; let best = -1;
		for (let index = 0; index < lines.length; index += 10) {
			const score = [...words(lines.slice(index, index + 20).join(" "))].filter(w => wanted.has(w)).length;
			if (score > best) { best = score; at = Math.max(0, index - 3); }
		}
		const sha256 = createHash("sha256").update(source.text).digest("hex");
		const retained = previous.filter(p => p.path === source.path && source.text.replace(/\s+/g, " ").includes(p.quote.replace(/\s+/g, " "))).slice(0, 8).map(p => p.quote.slice(0, 400)).join("\n");
		return { id: "s_" + createHash("sha256").update(source.path + sha256).digest("hex").slice(0, 16), path: source.path, text: [lines.slice(at, at + 120).join("\n").slice(0, 6500), retained].filter(Boolean).join("\n").slice(0, 10000), sha256 };
	});
}
