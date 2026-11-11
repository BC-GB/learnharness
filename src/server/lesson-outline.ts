import { createHash } from "node:crypto";
import type { ChatRecord } from "../core/contracts.ts";
import { derivePlanStatusesLh } from "../core/contracts.ts";
import { messageViewLines } from "../core/coverage.ts";
import { validOutlineId, type LessonOutline, type OutlinePassage, type OutlineSource } from "../core/lesson-outline.ts";
import { readLessonOutline, readLegacyLessonOutline, writeLessonOutline } from "../store/lesson-outline.ts";
import { courseLocal } from "../runtime/course-context.ts";
import { observeLessonOutline } from "../agent/lesson-outline.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { connectionBackgroundAllowed } from "../agent/subscription-connections.ts";
import { withWorkerRequestSlot } from "../agent/worker-request-admission.ts";
import { resolveOutlineModelSpec } from "../core/settings-resolution.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { compactionInFlight } from "./compaction.ts";
import { outlineMaterialPack } from "./outline-materials.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const active = () => courseLocal("lesson-outline-runs", () => new Map<string, Promise<void>>());
const pending = () => courseLocal("lesson-outline-pending", () => new Set<string>());
const scheduled = () => courseLocal("lesson-outline-scheduled", () => new Set<string>());
export const outlineRunningCount = () => active().size + scheduled().size;
const enabled = () => stores.settingsStore.readSettings()?.general?.lessonOutline === true;
const planKey = (record: ChatRecord) => hash(record.tree);

/** Include prose before/between tags. Native positions are hints, not containers. */
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
		const text = messageViewLines(message, message.id).join("\n").trim();
		if (text) output.push({ id: message.id, text, nodeId, index });
	}
	return output;
}

/** Representative plan-wide backfill plus recent prose; later batches do not overlap. */
export function selectOutlinePassages(all: OutlinePassage[], cursor: number, backfill: boolean): OutlinePassage[] {
	if (!backfill) {
		const selected: OutlinePassage[] = []; let budget = 24000;
		for (const p of all.filter(p => p.index >= cursor)) {
			if (budget < 1) break;
			const text = p.text.slice(0, Math.min(16000, budget)); selected.push({ ...p, text }); budget -= text.length;
		}
		return selected;
	}
	const selected = new Map<string, OutlinePassage>(); let recent = 12000;
	for (const p of all.slice().reverse()) {
		if (recent < 1) break;
		const text = p.text.slice(-Math.min(8000, recent)); selected.set(p.id, { ...p, text }); recent -= text.length;
	}
	let remaining = 24000 - [...selected.values()].reduce((n, p) => n + p.text.length, 0);
	const representatives = new Map<string | null, OutlinePassage[]>();
	for (const p of all) { const row = representatives.get(p.nodeId) ?? []; representatives.set(p.nodeId, row.length ? [row[0]!, p] : [p]); }
	for (const p of [...representatives.values()].flat()) {
		if (selected.has(p.id) || remaining < 1) continue;
		const text = p.text.slice(0, Math.min(1000, remaining)); selected.set(p.id, { ...p, text }); remaining -= text.length;
	}
	return [...selected.values()].sort((a, b) => a.index - b.index);
}
function base(record: ChatRecord, previous: LessonOutline | null): LessonOutline {
	const prefixUnchanged = previous && previous.cursor <= record.messages.length && previous.prefixKey === hash(record.messages.slice(0, previous.cursor));
	return { version: 2, chatId: record.id, planKey: planKey(record),
		groups: prefixUnchanged ? previous.groups : [], currentItem: prefixUnchanged ? previous.currentItem : null,
		revisionReason: prefixUnchanged ? previous.revisionReason : null,
		cursor: prefixUnchanged ? previous.cursor : 0, prefixKey: prefixUnchanged ? previous.prefixKey : hash([]),
		nativeNode: derivePlanStatusesLh(record.tree!, record.messages).current,
		updatedAt: previous?.updatedAt ?? "", sources: previous?.sources ?? [], previous: previous?.previous ?? [],
		...(prefixUnchanged ? { lastAttempt: previous.lastAttempt, pending: previous.pending, error: previous.error, usage: previous.usage } : {}),
	};
}

/** GET never infers, mutates progress or derives display headings from plan tags. */
export function lessonOutlineView(id: string) {
	if (!validOutlineId(id)) return null;
	const record = stores.chatStore.getChat(id); if (!record) return null;
	if (!enabled() || record.kind === "practice" || !record.tree?.nodes.length) return { enabled: enabled(), available: false, busy: false, groups: [], currentGroup: null, focusGroup: null };
	const saved = readLessonOutline(id); const outline = base(record, saved);
	const latestTeacher = outlinePassages(record).at(-1)?.id;
	const known = new Set(record.tree.nodes.map(n => n.id));
	const groups = outline.groups.filter(g => g.nodeIds.every(n => known.has(n)));
	const focus = groups.find(g => g.items.some(i => i.id === outline.currentItem))?.id ?? groups[0]?.id ?? null;
	const current = groups.find(g => g.items.some(i => i.id === outline.currentItem && !!latestTeacher && i.messageIds.includes(latestTeacher)))?.id ?? null;
	return { enabled: true, available: true, busy: active().has(id), currentGroup: current, focusGroup: focus,
		error: saved?.error ? "Couldn’t update the outline." : null,
		groups: groups.map(group => ({ id: group.id, title: group.title, items: group.items.map(item => ({
			id: item.id, label: item.label, state: (group.id === current && item.id === outline.currentItem ? "current" : item.messageIds.length ? "discussed" : "upcoming") as "current" | "discussed" | "upcoming",
		})) })),
	};
}

/** Injection seams are test-only; HTTP callers cannot supply engines or paths. */
export async function refreshLessonOutline(id: string, options: { force?: boolean; engine?: PiEngine; materials?: (query: string) => OutlineSource[] } = {}): Promise<void> {
	if (!validOutlineId(id) || !enabled()) return;
	if (active().has(id)) { pending().add(id); return; }
	let resolve!: () => void; active().set(id, new Promise<void>(done => { resolve = done; }));
	const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 60000);
	try {
		const record = stores.chatStore.getChat(id);
		if (!record?.tree?.nodes.length || record.kind === "practice" || isTurnRunning(id) || compactionInFlight(id)) return;
		const old = readLessonOutline(id); const state = base(record, old); const all = outlinePassages(record);
		const newer = all.filter(p => p.index >= state.cursor);
		const changedPlan = old?.planKey !== state.planKey; const entered = old?.nativeNode !== state.nativeNode;
		const newTokens = Math.ceil(newer.reduce((sum, p) => sum + p.text.length, 0) / 4);
		if (old && !old.pending && !changedPlan && !entered && !newer.length && !old.error) return;
		if (!options.force && !old?.pending && !changedPlan && !entered && state.groups.length && newTokens < 2048) return;
		const attempt = hash([state.planKey, state.nativeNode, state.cursor, record.messages]);
		if (old?.lastAttempt === attempt && !old.pending && !(options.force && old.error && Date.now() - Date.parse(old.updatedAt) >= 60000)) return;
		if (!options.force && old?.error && Date.now() - Date.parse(old.updatedAt) < 60000) return;
		const backfill = !old || changedPlan || !state.cursor;
		const selected = selectOutlinePassages(all, state.cursor, backfill);
		state.lastAttempt = attempt; state.updatedAt = new Date().toISOString(); state.error = undefined; state.pending = true;
		writeLessonOutline(state);
		try {
			await withWorkerRequestSlot(controller.signal, async () => {
				if (controller.signal.aborted || !enabled() || isTurnRunning(id) || compactionInFlight(id)) return;
				const fresh = stores.chatStore.getChat(id);
				if (!fresh || hash(fresh.messages) !== hash(record.messages) || planKey(fresh) !== state.planKey) return;
				const spec = resolveOutlineModelSpec(stores.settingsStore.readSettings());
				if (!options.engine && (!spec || !connectionBackgroundAllowed(spec.provider))) throw new Error("Outline connection unavailable");
				const legacy = old ? null : readLegacyLessonOutline(id);
				const sourceLookup = [...state.sources, ...(legacy?.sources ?? [])];
				const references = [...state.groups.flatMap(g => g.items), ...(legacy?.topics.flatMap(t => t.items) ?? [])].flatMap(item => item.sources.flatMap(c => {
					const source = sourceLookup.find(s => s.id === c.sourceId); return source ? [{ path: source.path, quote: c.quote }] : [];
				}));
				const query = selected.slice(-3).map(p => p.text.slice(-1600)).join("\n");
				const pack = options.materials ? { sources: options.materials(query), sourceCoverage: [] } : outlineMaterialPack(record.tree!, query, references);
				if (!pack.sources.length) throw new Error("Course reading copies unavailable");
				const engine = options.engine ?? piEngineForSpec(spec!, true);
				const result = await observeLessonOutline(engine, { goal: record.title ?? "Current lesson", plan: record.tree!, nativeNodeHint: state.nativeNode, previousGroups: state.groups, passages: selected, ...pack }, controller.signal);
				const latest = stores.chatStore.getChat(id);
				if (controller.signal.aborted || !enabled() || !latest || planKey(latest) !== state.planKey || hash(latest.messages.slice(0, record.messages.length)) !== hash(record.messages)) return;
				const next = { ...state, ...result };
				next.previous = [...(old?.previous ?? []), ...(old ? [{ planKey: old.planKey, groups: old.groups, revisionReason: old.revisionReason }] : [])].slice(-3);
				next.sources = pack.sources.map(({ id, path, sha256 }) => ({ id, path, sha256 }));
				next.cursor = backfill || !selected.length ? record.messages.length : selected.at(-1)!.index + 1;
				next.prefixKey = hash(record.messages.slice(0, next.cursor)); next.updatedAt = new Date().toISOString(); next.error = undefined; next.pending = false;
				writeLessonOutline(next);
			});
		} catch {
			if (enabled() && stores.chatStore.getChat(id)) writeLessonOutline({ ...state, pending: false, error: "Outline update unavailable", updatedAt: new Date().toISOString() });
		}
	} finally {
		clearTimeout(deadline); active().delete(id); resolve();
		if (pending().delete(id)) queueMicrotask(() => triggerLessonOutline(id));
	}
}
export function triggerLessonOutline(id: string): void {
	if (process.env.NODE_ENV === "test") return;
	try {
		if (!enabled() || scheduled().has(id)) return;
		scheduled().add(id);
		setImmediate(() => { scheduled().delete(id); void refreshLessonOutline(id).catch(() => undefined); });
	} catch { /* The original teacher remains independent. */ }
}
