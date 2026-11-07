import type { PlanTree } from "./contracts.ts";

/** Navigation metadata only. Never teacher state or model-facing history. */
export interface OutlineSource { id: string; path: string; text: string; sha256: string }
export interface OutlinePassage { id: string; text: string; nodeId: string | null; index: number }
export interface OutlineItem { id: string; label: string; sources: { sourceId: string; quote: string }[]; messageIds: string[] }
export interface OutlineGroup { id: string; title: string; nodeIds: string[]; items: OutlineItem[] }
export interface OutlineSubmission { groups: OutlineGroup[]; currentItem: string | null; revisionReason: string | null }
export interface LessonOutline extends OutlineSubmission {
	version: 2; chatId: string; planKey: string; cursor: number; prefixKey: string;
	nativeNode: string | null; updatedAt: string; lastAttempt?: string; pending?: boolean; error?: string;
	sources: { id: string; path: string; sha256: string }[];
	usage?: { model: string; input: number; output: number };
	previous?: { planKey: string; groups: OutlineGroup[]; revisionReason: string | null }[];
}
export interface LegacyLessonOutline {
	version: 1; chatId: string; topics: { id: string; title: string; items: OutlineItem[] }[];
	sources: { id: string; path: string; sha256: string }[];
}
export function validOutlineId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value); }
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
function label(value: unknown, limit: number): string {
	if (typeof value !== "string" || !value.trim() || value.length > limit || /[<>\r\n]/.test(value)) throw new Error("Use a short plain heading");
	return value.trim();
}
export const outlineShape = (groups: OutlineGroup[]) => JSON.stringify(groups.map(g => [g.id, g.title, g.nodeIds, g.items.map(i => [i.id, i.label])]));

/** AI owns grouping, wording and sequence. Code checks scope and provenance. */
export function validateOutlineSubmission(raw: unknown, sources: OutlineSource[], passages: OutlinePassage[], plan: PlanTree, prior: OutlineGroup[] = []): OutlineSubmission {
	if (!raw || typeof raw !== "object") throw new Error("Invalid outline response");
	const value = raw as Record<string, unknown>; const knownNodes = new Set(plan.nodes.map(n => n.id));
	if (!knownNodes.size || knownNodes.size > 100 || knownNodes.size !== plan.nodes.length) throw new Error("Invalid outline plan");
	if (!Array.isArray(value.groups) || !value.groups.length || value.groups.length > 8) throw new Error("Invalid outline groups");
	const groupIds = new Set<string>(); const itemIds = new Set<string>(); const coveredNodes = new Set<string>();
	const evidence = new Set([...passages.map(p => p.id), ...prior.flatMap(g => g.items.flatMap(i => i.messageIds))]);
	const groups = value.groups.map((entry: unknown): OutlineGroup => {
		if (!entry || typeof entry !== "object") throw new Error("Invalid group"); const group = entry as Record<string, unknown>;
		if (!validOutlineId(group.id) || groupIds.has(group.id)) throw new Error("Invalid group identity"); groupIds.add(group.id);
		if (!Array.isArray(group.nodeIds) || !group.nodeIds.length || group.nodeIds.length > 100 || group.nodeIds.some(id => typeof id !== "string" || !knownNodes.has(id))) throw new Error("Unknown plan node");
		const nodeIds = [...new Set(group.nodeIds as string[])]; nodeIds.forEach(id => coveredNodes.add(id));
		if (!Array.isArray(group.items) || !group.items.length || group.items.length > 8) throw new Error("Invalid main ideas");
		const items = group.items.map((entry: unknown): OutlineItem => {
			if (!entry || typeof entry !== "object") throw new Error("Invalid main idea"); const item = entry as Record<string, unknown>;
			if (!validOutlineId(item.id) || itemIds.has(item.id)) throw new Error("Invalid main idea identity"); itemIds.add(item.id);
			if (!Array.isArray(item.sources) || !item.sources.length || item.sources.length > 3) throw new Error("A main idea needs course evidence");
			const citations = item.sources.map((entry: unknown) => {
				if (!entry || typeof entry !== "object") throw new Error("Invalid course evidence"); const c = entry as Record<string, unknown>;
				const source = sources.find(s => s.id === c.sourceId);
				if (!source || typeof c.quote !== "string" || compact(c.quote).length < 8 || c.quote.length > 400 || !compact(source.text).includes(compact(c.quote))) throw new Error("Course quote not found");
				return { sourceId: source.id, quote: c.quote };
			});
			if (!Array.isArray(item.messageIds) || item.messageIds.length > 24 || item.messageIds.some(id => typeof id !== "string" || !evidence.has(id))) throw new Error("Unknown conversation evidence");
			return { id: item.id, label: label(item.label, 90), sources: citations, messageIds: [...new Set(item.messageIds as string[])] };
		});
		return { id: group.id, title: label(group.title, 70), nodeIds, items };
	});
	if (itemIds.size > 32 || [...knownNodes].some(id => !coveredNodes.has(id))) throw new Error("Outline must represent the plan within its bounds");
	const revisionReason = value.revisionReason === null ? null : label(value.revisionReason, 240);
	if (prior.length && outlineShape(groups) !== outlineShape(prior) && !revisionReason) throw new Error("Explain an outline revision");
	if (value.currentItem !== null && (typeof value.currentItem !== "string" || !itemIds.has(value.currentItem))) throw new Error("Unknown current idea");
	const current = groups.flatMap(g => g.items).find(i => i.id === value.currentItem); const latest = passages.at(-1)?.id;
	return { groups, revisionReason, currentItem: current && latest && current.messageIds.includes(latest) ? current.id : null };
}
