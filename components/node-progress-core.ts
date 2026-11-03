/** Browser-only coverage projection. Never written into the conversation,
 * plan, compaction summary or model request. Reads existing UI parts only. */
import { derivePlanStatuses, textPartMessageId, type PlanTree } from "@/src/core";

export interface ProgressPart {
	type: string;
	id?: string;
	text?: string;
	state?: string;
	sourceMessageId?: string;
	input?: unknown;
	output?: unknown;
}
export interface ProgressMessage { id: string; role: string; parts: readonly ProgressPart[] }
export interface CoveredSection { title: string; messageId: string | null }
export interface NodeCheck {
	id: string;
	question: string;
	status: "correct" | "incorrect" | "unsure" | "answered" | "pending" | "dismissed" | "failed";
	note?: string;
}
export interface NodeCoverage {
	id: string;
	title: string;
	sections: CoveredSection[];
	checks: NodeCheck[];
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}

/** Extract literal headings, not an AI-generated claim that a topic is complete.
 * Code examples, source footers and generic worked-answer scaffolding do not
 * become topic names. Plain React text rendering keeps any markup inert. */
export function sectionHeadings(text: string): string[] {
	const headings: string[] = [];
	let fence: string | null = null;
	for (const line of text.split(/\r?\n/)) {
		const marker = line.match(/^\s*(`{3,}|~{3,})/);
		if (marker) {
			if (fence === null) fence = marker[1]![0]!;
			else if (marker[1]![0] === fence) fence = null;
			continue;
		}
		if (fence) continue;
		const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
		if (!match) continue;
		const title = match[1]!.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "").trim();
		const bare = title.replace(/^[\d①-⑳]+[.)\s:]*/, "").replace(/[:?!.]+$/, "").trim();
		if (!bare || /^(?:given|required|question|solution|answer|interpretation|source(?:s)?|worked example|worked forecast|the building blocks|the distinction|the whole process|summary)$/i.test(bare)) continue;
		headings.push(title.length > 180 ? title.slice(0, 177) + "…" : title);
	}
	return headings;
}

export function deriveNodeCoverage(tree: PlanTree, messages: readonly ProgressMessage[]): {
	current: string | null;
	nodes: NodeCoverage[];
} {
	const nodes = tree.nodes.map(n => ({ id: n.id, title: n.title, sections: [] as CoveredSection[], checks: [] as NodeCheck[] }));
	const byId = new Map(nodes.map(n => [n.id, n]));
	const seen = new Map(nodes.map(n => [n.id, new Set<string>()]));
	let active: string | null = null;
	let pending: CoveredSection[] = [];
	function flush(nodeId: string | null) {
		const node = nodeId ? byId.get(nodeId) : undefined;
		if (node) for (const section of pending) {
			const key = section.title.toLocaleLowerCase().replace(/^[\d①-⑳]+[.)\s:]*/, "");
			if (seen.get(node.id)!.has(key)) continue;
			seen.get(node.id)!.add(key);
			node.sections.push(section);
		}
		pending = [];
	}
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const [index, part] of message.parts.entries()) {
			if (part.type === "text" && typeof part.text === "string") {
				const messageId = part.sourceMessageId ?? textPartMessageId(part.id);
				pending.push(...sectionHeadings(part.text).map(title => ({ title, messageId })));
				continue;
			}
			if (part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			const input = object(part.input);
			if (typeof input.nodeId !== "string" || !byId.has(input.nodeId)) continue;
			// A check follows the explanation it assesses. A prediction precedes
			// its teaching; do not credit the previous node's prose to that node.
			flush(input.type === "predict" ? active : input.nodeId);
			active = input.nodeId;
			if (typeof input.question !== "string" || !input.question.trim()) continue;
			const output = object(part.output);
			let status: NodeCheck["status"] = "pending";
			if (part.state === "output-error") status = "failed";
			else if (output.dismissed === true) status = "dismissed";
			else if (part.state === "output-available") {
				status = output.dontKnow === true ? "unsure" : output.correct === true ? "correct" : output.correct === false ? "incorrect" : "answered";
			}
			const note = typeof output.readingThinking === "string" && output.readingThinking.trim() ? output.readingThinking.trim() : undefined;
			byId.get(active)!.checks.push({ id: part.id ?? `${message.id}-${index}`, question: input.question.trim(), status, ...(note ? { note } : {}) });
		}
	}
	flush(active);
	// Keep the same navigation semantics as the harness. This projection never
	// turns a correct answer into a mastery/completion flag.
	const current = derivePlanStatuses(tree, messages.map(m => ({ parts: [...m.parts] }))).current;
	return { current, nodes };
}
