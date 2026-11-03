"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { messageAnchorId, type PlanTree } from "@/src/core";
import { deriveNodeCoverage, type ProgressMessage } from "./node-progress-core";

const COLLAPSED_KEY = "learnharness.nodeProgress.collapsed";
const STATUS = { correct: "Correct answer", incorrect: "Incorrect answer", unsure: "Not sure", answered: "Answered", pending: "Awaiting answer", dismissed: "Dismissed", failed: "Question failed" } as const;

/** An optional display over existing records, not another teaching agent.
 * No fetch, transcript writes, tools, prompt changes or model requests. */
export function NodeProgress({ tree, messages }: { tree: PlanTree; messages: readonly ProgressMessage[] }) {
	const coverage = useMemo(() => deriveNodeCoverage(tree, messages), [tree, messages]);
	const [chosen, setChosen] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	useEffect(() => {
		try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* Preference storage is optional. */ }
	}, []);
	const selected = coverage.nodes.find(n => n.id === chosen) ?? coverage.nodes.find(n => n.id === coverage.current);
	if (!selected) return null;
	const answered = selected.checks.filter(c => ["correct", "incorrect", "unsure", "answered"].includes(c.status));
	const latest = selected.checks.slice(-3).reverse();
	const notes = selected.checks.filter(c => c.note).slice(-2).reverse();
	function toggle() {
		const next = !collapsed;
		setCollapsed(next);
		try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* No effect on lessons. */ }
	}
	return (
		<section data-testid="node-progress" aria-label="Node progress" className="shrink-0 border-b border-border/60 bg-background px-4 py-2 sm:px-6">
			<div className="mx-auto w-full max-w-6xl">
				<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					<span className="text-xs font-medium text-muted-foreground">{selected.id === coverage.current ? "Current node" : "Earlier node"}</span>
					<select aria-label="Review node progress" value={selected.id} onChange={e => setChosen(e.target.value === coverage.current ? null : e.target.value)} className="min-w-0 max-w-full flex-1 rounded border border-border bg-background px-2 py-1 text-sm sm:max-w-md">
						{coverage.nodes.filter(n => n.id === coverage.current || n.sections.length || n.checks.length).map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
					</select>
					<span className="text-xs text-muted-foreground">{selected.sections.length} {selected.sections.length === 1 ? "section" : "sections"} · {answered.length} answered checks</span>
					{selected.id !== coverage.current && <button type="button" onClick={() => setChosen(null)} className="text-xs underline underline-offset-4">Back to current</button>}
					<button type="button" aria-expanded={!collapsed} aria-label={collapsed ? "Show node progress details" : "Hide node progress details"} onClick={toggle} className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
						{collapsed ? "Show" : "Hide"}{collapsed ? <ChevronDownIcon className="size-3" /> : <ChevronUpIcon className="size-3" />}
					</button>
				</div>
				{!collapsed && <div className="mt-2 grid max-h-44 gap-3 overflow-y-auto text-xs sm:grid-cols-2" data-testid="node-progress-details">
					<div className="min-w-0">
						<p className="mb-1 font-medium">Covered so far</p>
						{selected.sections.length ? <ol className="list-decimal space-y-1 pl-5">{selected.sections.map((s, i) => <li key={`${s.title}-${i}`} className="break-words">{s.messageId ? <a href={`#${encodeURIComponent(messageAnchorId(s.messageId))}`} className="underline decoration-border underline-offset-2 hover:decoration-current">{s.title}</a> : s.title}</li>)}</ol> : <p className="text-muted-foreground">No section headings recorded for this node yet.</p>}
					</div>
					<div className="min-w-0 space-y-2">
						<p className="font-medium">Recent checks</p>
						{latest.length ? <ul className="space-y-2">{latest.map(c => <li key={c.id} className="break-words"><span className="font-medium">{STATUS[c.status]}:</span> {c.question}</li>)}</ul> : <p className="text-muted-foreground">No checks recorded yet.</p>}
						{notes.length > 0 && <div><p className="mb-1 font-medium">Your reading notes</p>{notes.map(c => <p key={c.id} className="mb-1 whitespace-pre-wrap break-words text-muted-foreground">{c.note}</p>)}</div>}
					</div>
				</div>}
				{!collapsed && <p className="mt-2 text-[11px] text-muted-foreground">Recorded lesson headings and checks. This is coverage, not a completion or mastery score.</p>}
			</div>
		</section>
	);
}
