import type { PlanTree } from "./contracts.ts";

/** Presentation metadata only. Never part of ChatRecord or model-facing history. */
export interface OutlineSource { id: string; path: string; text: string; sha256: string }
export interface OutlinePassage { id: string; text: string; nodeId: string; index: number }
export interface OutlineItem {
	id: string;
	label: string;
	sources: { sourceId: string; quote: string }[];
	messageIds: string[];
}
export interface OutlineTopic { id: string; title: string; items: OutlineItem[]; currentItem: string | null }
export interface LessonOutline {
	version: 1;
	chatId: string;
	planKey: string;
	topics: OutlineTopic[];
	cursor: number;
	prefixKey: string;
	currentNode: string | null;
	updatedAt: string;
	lastAttempt?: string;
	error?: string;
	sources: { id: string; path: string; sha256: string }[];
	usage?: { model: string; input: number; output: number };
	/** Bounded prior observer views; never learner mastery or teacher state. */
	previous?: { planKey: string; topics: OutlineTopic[] }[];
}
export interface OutlineSubmission { items: OutlineItem[]; currentItem: string | null }

export function validOutlineId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

/** Stable topological order: preserve the teacher's order among ready nodes. */
export function outlineTopics(tree: PlanTree, old: OutlineTopic[] = []): OutlineTopic[] {
	const remaining = [...tree.nodes]; const output: OutlineTopic[] = [];
	if (remaining.length > 100 || new Set(remaining.map(n => n.id)).size !== remaining.length) throw new Error("Invalid outline plan");
	while (remaining.length) {
		const index = remaining.findIndex(n => tree.edges.every(e => e.to !== n.id || output.some(done => done.id === e.from)));
		if (index < 0) throw new Error("Invalid outline dependencies");
		const [node] = remaining.splice(index, 1);
		if (!validOutlineId(node!.id) || typeof node!.title !== "string" || !node!.title.trim()) throw new Error("Invalid outline topic");
		const previous = old.find(t => t.id === node!.id);
		output.push({ id: node!.id, title: node!.title, items: previous?.items ?? [], currentItem: previous?.currentItem ?? null });
	}
	return output;
}

const compact = (text: string) => text.replace(/\s+/g, " ").trim();
/** Reject invented sources/evidence, markup, overflow and unsupported current markers. */
export function validateOutlineSubmission(raw: unknown, sources: OutlineSource[], passages: OutlinePassage[]): OutlineSubmission {
	if (!raw || typeof raw !== "object") throw new Error("Invalid outline response");
	const value = raw as Record<string, unknown>;
	if (!Array.isArray(value.items) || value.items.length > 5) throw new Error("Keep at most five main ideas");
	const seen = new Set<string>(); const evidence = new Set(passages.map(p => p.id));
	const items = value.items.map((entry: unknown): OutlineItem => {
		if (!entry || typeof entry !== "object") throw new Error("Invalid main idea");
		const item = entry as Record<string, unknown>;
		if (!validOutlineId(item.id) || seen.has(item.id)) throw new Error("Invalid main idea identity");
		seen.add(item.id);
		if (typeof item.label !== "string" || !item.label.trim() || item.label.length > 100 || /[<>\r\n]/.test(item.label)) throw new Error("Use a short plain label");
		if (!Array.isArray(item.sources) || item.sources.length < 1 || item.sources.length > 3) throw new Error("A main idea needs course evidence");
		const citations = item.sources.map((entry: unknown) => {
			if (!entry || typeof entry !== "object") throw new Error("Invalid course evidence");
			const c = entry as Record<string, unknown>; const source = sources.find(s => s.id === c.sourceId);
			if (!source || typeof c.quote !== "string" || c.quote.length < 8 || c.quote.length > 400 || !compact(source.text).includes(compact(c.quote))) throw new Error("Course quote not found in supplied source");
			return { sourceId: source.id, quote: c.quote };
		});
		if (!Array.isArray(item.messageIds) || item.messageIds.length > 24 || item.messageIds.some(id => typeof id !== "string" || !evidence.has(id))) throw new Error("Unknown conversation evidence");
		return { id: item.id, label: item.label.trim(), sources: citations, messageIds: [...new Set(item.messageIds as string[])] };
	});
	if (value.currentItem !== null && (typeof value.currentItem !== "string" || !seen.has(value.currentItem))) throw new Error("Unknown current idea");
	const latest = passages.at(-1)?.id;
	const current = items.find(item => item.id === value.currentItem);
	return { items, currentItem: current && latest && current.messageIds.includes(latest) ? current.id : null };
}
