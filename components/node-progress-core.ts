/** Read-only browser projection. Never enters the teacher's context. */
import { derivePlanStatuses, textPartMessageId, type PlanTree } from "@/src/core";

export interface ProgressPart { type: string; id?: string; text?: string; input?: unknown }
export interface ProgressMessage { id: string; role: string; parts: readonly ProgressPart[] }
export interface ConceptLabel { name: string; provenance: readonly { chatId: string; messageId: string }[] }
export interface NodeCoverage { id: string; title: string; ideas: string[] }

function topicLabel(value: string): string | null {
 const label = value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\$([^$]+)\$/g, "$1")
  .replace(/[*`]/g, "").replace(/^\s*(?:\d+[.)]|[①-⑳])\s*/, "")
  .replace(/^week\s+\d+\s*:\s*/i, "").split(/:\s+/)[0]!.replace(/[:.]+$/, "").trim();
 // Select named topics rather than rhetorical headings, example steps or
 // equation fragments. This is conservative selection, not a summarizer.
 if (!label || label.length < 2 || label.length > 72 || label.split(/\s+/).length > 8 || /[?!=<>\\]/.test(label)) return null;
 if (/^(?:how|what|why|when|where|which|who|did|does|do|can|could|should|if|yes|no|now|next|keep|apply|compare|suppose|translate|separate|read|name and purpose|one month|the two words|the question|the distinction|the building blocks|the whole process|your proposed options)\b/i.test(label)) return null;
 if (/^(?:given|required|solution|interpretation|question|answer|source|sources|summary|worked example|worked forecast|example|step|rule|option)(?:\s+[A-Z\d])?$/i.test(label)) return null;
 if (/\b(?:is|are|was|were|does|means|chooses|must|should|would|cannot|isn.t|doesn.t)\b/i.test(label)) return null;
 return label;
}

/** Explicitly named definitions only, while existing concept extraction catches up. No inferred
 * syllabus, new vocabulary, free-form summary or model request. */
export function mainIdeaLabels(text: string): string[] {
 const labels: string[] = [];
 let fence: { char: string; length: number } | null = null;
 for (const line of text.split(/\r?\n/)) {
  const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (marker) {
   const delimiter = marker[1]!;
   if (!fence) fence = { char: delimiter[0]!, length: delimiter.length };
   else if (delimiter[0] === fence.char && delimiter.length >= fence.length && !marker[2]!.trim()) fence = null;
   continue;
  }
  if (fence) continue;
  for (const match of line.matchAll(/\*\*([^*\n]+)\*\*/g)) {
   const rest = line.slice(match.index! + match[0].length);
   if (!/[:：]\s*$/.test(match[1]!) && !/^\s*(?:[:：]|(?:means?|is|are|refers?|describes?|measures?|occurs?)\b)/i.test(rest)) continue;
   const label = topicLabel(match[1]!); if (label && /^\p{Lu}/u.test(label)) labels.push(label);
  }
 }
 return labels;
}

export function deriveNodeCoverage(tree: PlanTree, messages: readonly ProgressMessage[], concepts: readonly ConceptLabel[] = [], chatId?: string): { current: string | null; nodes: NodeCoverage[] } {
 const nodes = tree.nodes.map(n => ({ id: n.id, title: n.title, ideas: [] as string[] }));
 const byId = new Map(nodes.map(n => [n.id, n]));
 const sources = new Map(nodes.map(n => [n.id, new Set<string>()]));
 const seen = new Map(nodes.map(n => [n.id, new Set<string>()]));
 let active: string | null = null;
 let pending: { labels: string[]; source: string | null }[] = [];
 function flush(nodeId: string | null) {
  const node = nodeId ? byId.get(nodeId) : undefined;
  if (node) for (const entry of pending) {
   if (entry.source) sources.get(node.id)!.add(entry.source);
   for (const idea of entry.labels) {
    const key = idea.toLocaleLowerCase();
    if (key === node.title.toLocaleLowerCase() || seen.get(node.id)!.has(key)) continue;
    seen.get(node.id)!.add(key);node.ideas.push(idea);
   }
  }
  pending = [];
 }
 for (const message of messages) {
  if (message.role !== "assistant") continue;
  for (const part of message.parts) {
   if (part.type === "text" && typeof part.text === "string") { pending.push({labels: mainIdeaLabels(part.text),source: textPartMessageId(part.id)}); continue; }
   if (part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
   const input = part.input as { nodeId?: unknown; type?: unknown } | undefined;
   if (typeof input?.nodeId !== "string" || !byId.has(input.nodeId)) continue;
   // Existing position tags only: checks follow teaching; predictions precede
   // it. Question results, notes and grades are never read by this view.
   flush(input.type === "predict" ? active : input.nodeId);
   active = input.nodeId;
  }
 }
 flush(active);
 // Reuse the existing extractor's stable, short proposition names. No
 // extraction is triggered here. Provenance confines them to this chat/node.
 for (const node of nodes) {
  const sourceIds = sources.get(node.id)!;
  const saved = concepts.filter(c => c.provenance.some(p => p.chatId === chatId && p.messageId !== "" && sourceIds.has(p.messageId)));
  if (saved.length) {
   const names = saved.map(c => c.name.trim()).filter(name => name.length > 1 && name.length <= 100 && /\p{L}/u.test(name));
   // Existing concept extraction supplies stable semantic names. Until a
   // node has extracted concepts, its explicit definition names are the
   // lightweight fallback. Never turn every heading into another item.
   if (names.length) node.ideas = [...new Map(names.map(name => [name.toLocaleLowerCase(),name])).values()];
  }
 }
 const current = derivePlanStatuses(tree, messages.map(m => ({ parts: [...m.parts] }))).current;
 return { current, nodes };
}
