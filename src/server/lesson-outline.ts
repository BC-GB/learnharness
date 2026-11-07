import { createHash } from "node:crypto";
import type { ChatRecord } from "../core/contracts.ts";
import { derivePlanStatusesLh } from "../core/contracts.ts";
import { messageViewLines } from "../core/coverage.ts";
import { outlineTopics, validOutlineId, type LessonOutline, type OutlinePassage, type OutlineSource } from "../core/lesson-outline.ts";
import { readLessonOutline, writeLessonOutline } from "../store/lesson-outline.ts";
import { courseLocal } from "../runtime/course-context.ts";
import { observeLessonOutline } from "../agent/lesson-outline.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { connectionBackgroundAllowed } from "../agent/subscription-connections.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { compactionInFlight } from "./compaction.ts";
import { outlineMaterials } from "./outline-materials.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const active = () => courseLocal("lesson-outline-runs", () => new Map<string, Promise<void>>());
const pending = () => courseLocal("lesson-outline-pending", () => new Set<string>());
const scheduled = () => courseLocal("lesson-outline-scheduled", () => new Set<string>());
export const outlineRunningCount = () => active().size + scheduled().size;
const enabled = () => stores.settingsStore.readSettings()?.general?.lessonOutline === true;
const planKey = (record: ChatRecord) => hash(record.tree);

/** Read teacher prose only, tagged by the ORIGINAL plan's quiz positions. */
export function outlinePassages(record: ChatRecord): OutlinePassage[] {
	const nodes = new Set(record.tree?.nodes.map(n => n.id)); let nodeId: string | null = null;
	const output: OutlinePassage[] = [];
	for (const [index, message] of record.messages.entries()) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type !== "toolCall" || !["quiz", "explain"].includes(part.name)) continue;
			const id = (part.arguments as { nodeId?: unknown })?.nodeId;
			if (typeof id === "string" && nodes.has(id)) nodeId = id;
		}
		if (!nodeId) continue;
		const text = messageViewLines(message, message.id).join("\n").trim();
		if (text) output.push({ id: message.id, text, nodeId, index });
	}
	return output;
}

function base(record: ChatRecord, previous: LessonOutline | null): LessonOutline {
	const key = planKey(record); const prefixUnchanged = previous && previous.cursor <= record.messages.length && previous.prefixKey === hash(record.messages.slice(0, previous.cursor));
	const current = derivePlanStatusesLh(record.tree!, record.messages).current;
	return { version: 1, chatId: record.id, planKey: key,
		topics: outlineTopics(record.tree!, prefixUnchanged ? previous.topics : []),
		cursor: prefixUnchanged ? previous.cursor : 0,
		prefixKey: prefixUnchanged ? previous.prefixKey : hash([]), currentNode: current,
		updatedAt: previous?.updatedAt ?? "", sources: previous?.sources ?? [],
		previous: previous?.previous ?? [],
		...(prefixUnchanged ? { lastAttempt: previous.lastAttempt, pending: previous.pending, error: previous.error, usage: previous.usage } : {}),
	};
}

/** Pure GET: no generation, recovery, chat mutations or progress writes. */
export function lessonOutlineView(id: string) {
	if (!validOutlineId(id)) return null;
	const record = stores.chatStore.getChat(id); if (!record) return null;
	if (!enabled() || record.kind === "practice" || !record.tree?.nodes.length) return { enabled: enabled(), available: false, busy: false, topics: [], currentNode: null };
	const saved = readLessonOutline(id); const outline = base(record, saved);
	const latestTeacher = outlinePassages(record).filter(p => p.nodeId === outline.currentNode).at(-1)?.id;
	return { enabled: true, available: true, busy: active().has(id), currentNode: outline.currentNode,
		error: saved?.error ? "Couldn’t update the outline." : null,
		topics: outline.topics.map(topic => ({ id: topic.id, title: topic.title,
			items: topic.items.map(item => ({ id: item.id, label: item.label, discussed: item.messageIds.length > 0, current: topic.id === outline.currentNode && item.id === topic.currentItem && !!latestTeacher && item.messageIds.includes(latestTeacher) })),
		})),
	};
}

/** Dependency injection is process-local for tests; the HTTP endpoint accepts none. */
export async function refreshLessonOutline(id: string, options: { force?: boolean; engine?: PiEngine; materials?: (query: string) => OutlineSource[] } = {}): Promise<void> {
	if (!validOutlineId(id) || !enabled()) return;
	if (active().has(id)) { pending().add(id); return; }
	let resolve!: () => void; const lock = new Promise<void>(done => { resolve = done; }); active().set(id, lock);
	const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 60000);
	try {
		const record = stores.chatStore.getChat(id);
		if (!record?.tree?.nodes.length || record.kind === "practice" || isTurnRunning(id) || compactionInFlight(id)) return;
		const old = readLessonOutline(id); const state = base(record, old);
		const topic = state.topics.find(t => t.id === state.currentNode) ?? state.topics[0]!;
		const all = outlinePassages(record).filter(p => p.nodeId === topic.id);
		const newer = all.filter(p => p.index >= state.cursor);
		const changedPlan = old?.planKey !== state.planKey;
		const entered = old?.currentNode !== state.currentNode;
		const newTokens = Math.ceil(newer.reduce((sum, p) => sum + p.text.length, 0) / 4);
		if (old && !old.pending && !changedPlan && !entered && !newer.length && !old.error) return;
		if (!options.force && !changedPlan && !entered && topic.items.length && newTokens < 2048) return;
		const attempt = hash([state.planKey, state.currentNode, state.cursor, record.messages]);
		if (old?.lastAttempt === attempt && !old.pending && !(options.force && old.error && Date.now() - Date.parse(old.updatedAt) >= 60000)) return;
		if (!options.force && old?.error && Date.now() - Date.parse(old.updatedAt) < 60000) return;
		// Bound the observer's independent context. First backfill uses the current
		// topic's recent passages; subsequent batches have a monotonic raw cursor.
		const selected: OutlinePassage[] = []; let characters = 0;
		const backfill = !old || changedPlan || entered;
		for (const p of (backfill ? all.slice().reverse() : newer)) {
			if (characters + p.text.length > 16000 && selected.length) break;
			const text = p.text.slice(0, 16000); const passage = { ...p, text };
			if (backfill) selected.unshift(passage); else selected.push(passage);
			characters += text.length;
		}
		const generationNode = topic.id;
		state.lastAttempt = attempt; state.updatedAt = new Date().toISOString(); state.error = undefined;
		state.pending = true;
		writeLessonOutline(state);
		try {
			await withBgLlmSlot(controller.signal, async () => {
				if (controller.signal.aborted || !enabled() || isTurnRunning(id) || compactionInFlight(id)) return;
				const fresh = stores.chatStore.getChat(id);
				if (!fresh || hash(fresh.messages) !== hash(record.messages) || planKey(fresh) !== state.planKey) return;
				const spec = resolveRoleSpec("extractor", stores.settingsStore.readSettings());
				if (!options.engine && (!spec || !connectionBackgroundAllowed(spec.provider))) throw new Error("Outline connection unavailable");
				const query = [topic.title, record.tree!.nodes.find(n => n.id === generationNode)?.summary ?? "", ...selected.slice(-2).map(p => p.text.slice(0, 500))].join("\n");
				const references = topic.items.flatMap(item => item.sources.flatMap(c => { const source = state.sources.find(s => s.id === c.sourceId); return source ? [{ path: source.path, quote: c.quote }] : []; }));
				const sources = options.materials ? options.materials(query) : outlineMaterials(query, references);
				if (!sources.length) throw new Error("Course reading copies unavailable");
				const engine = options.engine ?? piEngineForSpec(spec!, true);
				const result = await observeLessonOutline(engine, { goal: record.title ?? "Current lesson", plan: record.tree!, topic, passages: selected, sources }, controller.signal);
				const latest = stores.chatStore.getChat(id);
				if (controller.signal.aborted || !enabled() || !latest || planKey(latest) !== state.planKey || hash(latest.messages.slice(0, record.messages.length)) !== hash(record.messages)) return;
				const next = { ...state };
				next.previous = [...(old?.previous ?? []), ...(old ? [{ planKey: old.planKey, topics: old.topics }] : [])].slice(-3);
				next.topics = state.topics.map(t => t.id === generationNode ? { ...t, items: result.items, currentItem: result.currentItem } : t);
				next.sources = [...new Map([...state.sources, ...sources.map(({ id, path, sha256 }) => ({ id, path, sha256 }))].map(s => [s.id, s])).values()].slice(-300);
				next.cursor = backfill || !selected.length ? record.messages.length : selected.at(-1)!.index + 1;
				next.prefixKey = hash(record.messages.slice(0, next.cursor)); next.usage = result.usage;
				next.updatedAt = new Date().toISOString(); next.error = undefined; next.pending = false;
				writeLessonOutline(next);
			});
		} catch {
			// An observer failure has no teacher wake, steer, retry loop or transcript marker.
			if (enabled() && stores.chatStore.getChat(id)) writeLessonOutline({ ...state, pending: false, error: "Outline update unavailable", updatedAt: new Date().toISOString() });
		}
	} finally {
		clearTimeout(deadline); active().delete(id); resolve();
		if (pending().delete(id)) queueMicrotask(() => triggerLessonOutline(id));
	}
}

/** Optional post-settlement hook; failures never escape into the teaching loop. */
export function triggerLessonOutline(id: string): void {
	if (process.env.NODE_ENV === "test") return;
	try {
		if (!enabled() || scheduled().has(id)) return;
		scheduled().add(id);
		setImmediate(() => { scheduled().delete(id); void refreshLessonOutline(id).catch(() => undefined); });
	} catch { /* Teacher remains independent. */ }
}
