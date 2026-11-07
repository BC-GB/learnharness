import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { currentCourse } from "../runtime/course-context.ts";
import type { PlanTree } from "../core/contracts.ts";
import type { OutlineSource } from "../core/lesson-outline.ts";

const excluded = new Set(["apps", "practice", "my notes", "assignment work", "original files", "supporting files", "node_modules", "course-profiles"]);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(w => !["the", "and", "for", "with", "this", "that", "from", "what", "which", "course", "lecture"].includes(w)));
type Reference = { path: string; quote: string };
interface Reading { path: string; text: string; fileWords: Set<string>; bodyWords: Set<string> }

/** One bounded selected-course walk per update, never one walk per plan node. */
function catalog(): Reading[] {
	const root = currentCourse()?.sourceRoot; if (!root) return [];
	if (fs.realpathSync(root) !== path.resolve(root)) throw new Error("Aliased course library");
	const candidates: Reading[] = []; let entries = 0; let bytes = 0;
	function walk(dir: string, depth: number): void {
		if (depth > 7 || entries >= 2000 || bytes >= 8 * 1024 * 1024) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (++entries > 2000) break;
			if (e.name.startsWith(".") || e.isSymbolicLink() || excluded.has(e.name.toLowerCase())) continue;
			const target = path.join(dir, e.name); if (fs.realpathSync(target) !== target) continue;
			if (e.isDirectory()) { walk(target, depth + 1); continue; }
			if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
			const size = fs.statSync(target).size; if (size > 512 * 1024 || bytes + size > 8 * 1024 * 1024) continue;
			bytes += size; const text = fs.readFileSync(target, "utf8"); const relative = path.relative(root!, target).split(path.sep).join("/");
			if (!/^(?:materials|index|readme|agents)\.(?:md|txt)$/i.test(e.name)) candidates.push({ path: relative, text, fileWords: words(relative), bodyWords: words(text) });
		}
	}
	walk(root, 0);
	const editions = new Map<string, { version: number; source: Reading }>();
	for (const source of candidates) {
		const revision = source.path.match(/\s*\(v(\d+)\)(?=\.md$)/i); const key = source.path.replace(/\s*\(v\d+\)(?=\.md$)/i, "").toLowerCase();
		const version = revision ? Number(revision[1]) : 1;
		if (!editions.has(key) || editions.get(key)!.version < version) editions.set(key, { version, source });
	}
	return [...editions.values()].map(v => v.source);
}
function ranking(readings: Reading[], query: string): Reading[] {
	const wanted = [...words(query)];
	const frequency = new Map(wanted.map(word => [word, readings.filter(s => s.bodyWords.has(word)).length]));
	const scores = readings.map(source => ({ source, score: wanted.reduce((sum, word) => {
		const rarity = 1 + Math.log((readings.length + 1) / (1 + frequency.get(word)!));
		return sum + (source.fileWords.has(word) ? 8 : 0) + (source.bodyWords.has(word) ? rarity : 0);
	}, 0) }));
	return scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.source.path.localeCompare(b.source.path)).map(s => s.source);
}
function excerpt(source: Reading, query: string, previous: Reference[], limit: number): OutlineSource {
	const wanted = words(query); const lines = source.text.split("\n"); let at = 0; let best = -1;
	for (let index = 0; index < lines.length; index += 10) {
		const score = [...words(lines.slice(index, index + 20).join(" "))].filter(w => wanted.has(w)).length;
		if (score > best) { best = score; at = Math.max(0, index - 3); }
	}
	const sha256 = createHash("sha256").update(source.text).digest("hex");
	const retained = retainedQuotes(source, previous);
	const headings = lines.filter(l => /^#{1,4}\s/.test(l)).join("\n").slice(0, 1000);
	return { id: "s_" + createHash("sha256").update(source.path + sha256).digest("hex").slice(0, 16), path: source.path,
		text: [retained, headings, lines.slice(at, at + 120).join("\n")].filter(Boolean).join("\n").slice(0, limit), sha256 };
}
function retainedQuotes(source: Reading, previous: Reference[]): string {
	const normalized = source.text.replace(/\s+/g, " ");
	return [...new Set(previous.filter(p => p.path === source.path && normalized.includes(p.quote.replace(/\s+/g, " "))).slice(0, 96).map(p => p.quote.slice(0, 400)))].join("\n");
}
/** Compatibility seam for focused searches; earlier editions never re-enter. */
export function outlineMaterials(query: string, previous: Reference[] = []): OutlineSource[] {
	const readings = catalog(); const ranked = ranking(readings, query);
	const selected = [...readings.filter(s => previous.some(p => p.path === s.path)), ...ranked];
	return [...new Map(selected.map(s => [s.path, s])).values()].slice(0, 3).map(s => excerpt(s, query, previous, 6500));
}

/** Broad plan coverage plus focused current discussion, with explicit gaps. */
export function outlineMaterialPack(plan: PlanTree, focus: string, previous: Reference[] = []) {
	previous = previous.slice(0, 96);
	const readings = catalog(); const queries = plan.nodes.map(n => ({ id: n.id, query: [n.title, n.summary ?? ""].join(" ") }));
	const perNode = queries.map(n => ({ ...n, readings: ranking(readings, n.query).slice(0, 2) }));
	const selected = [...readings.filter(s => previous.some(p => p.path === s.path)), ...ranking(readings, focus).slice(0, 3), ...perNode.flatMap(n => n.readings.slice(0, 1)), ...perNode.flatMap(n => n.readings.slice(1))];
	const unique = [...new Map(selected.map(s => [s.path, s])).values()].slice(0, 16);
	// Preserve previously verified quotes without letting one source crowd out
	// the entire plan. At most96 citations plus16x2,500 new characters <80K.
	const sources = unique.map(s => excerpt(s, [focus, ...perNode.filter(n => n.readings.includes(s)).map(n => n.query)].join("\n"), previous, retainedQuotes(s, previous).length + 2500));
	return { sources, sourceCoverage: perNode.map(n => ({ nodeId: n.id, sourceIds: sources.filter(s => n.readings.some(r => r.path === s.path)).map(s => s.id) })) };
}
