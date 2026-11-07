"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import { courseFetch as fetch, documentCourse } from "@/lib/course-client";
import { useSettingsSaved } from "@/components/settings-signal";

export interface OutlineView {
	enabled: boolean; available: boolean; busy: boolean; currentGroup: string | null; focusGroup: string | null; error?: string | null;
	groups: { id: string; title: string; items: { id: string; label: string; state: "discussed" | "current" | "upcoming" }[] }[];
}

/** Read-only projection. Its context, model and storage stay outside the teacher. */
export function LessonOutline({ chatId, revision }: { chatId: string; revision: number }) {
	const courseId = documentCourse(); const identity = courseId + ":" + chatId;
	const [saved, setSaved] = useState<{ identity: string; view: OutlineView } | null>(null);
	const [settingsTick, setSettingsTick] = useState(0);
	useSettingsSaved(section => { if (section === "general") setSettingsTick(x => x + 1); });
	useEffect(() => {
		const controller = new AbortController(); let serial = 0;
		const refresh = async () => {
			const ticket = ++serial;
			try {
				const response = await fetch(`/api/chats/${chatId}/outline`, { signal: controller.signal });
				if (!response.ok) return; const next = await response.json();
				if (!next.enabled || !next.available) window.clearInterval(timer);
				if (!controller.signal.aborted && ticket === serial && documentCourse() === courseId) setSaved({ identity, view: next });
			} catch { /* The lesson remains usable when navigation is unavailable. */ }
		};
		void refresh(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
		return () => { controller.abort(); window.clearInterval(timer); };
	}, [chatId, revision, settingsTick, courseId, identity]);
	if (!saved || saved.identity !== identity || !saved.view.enabled || !saved.view.available) return null;
	return <OutlinePanel key={identity} view={saved.view} />;
}

export function OutlinePanel({ view }: { view: OutlineView }) {
	const [collapsed, setCollapsed] = useState(false);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const card = useRef<HTMLElement>(null);
	const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
	const clamp = useCallback((x: number, y: number) => ({ x: Math.max(16, Math.min(x, window.innerWidth - (card.current?.offsetWidth ?? 320) - 16)), y: Math.max(64, Math.min(y, window.innerHeight - (card.current?.offsetHeight ?? 160) - 96)) }), []);
	const start = (e: PointerEvent<HTMLButtonElement>) => {
		if (e.button !== 0) return; const box = card.current?.getBoundingClientRect(); if (!box) return;
		drag.current = { x: box.left, y: box.top, startX: e.clientX, startY: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId);
	};
	const move = (e: PointerEvent<HTMLButtonElement>) => {
		const at = drag.current; if (at) setPosition(clamp(at.x + e.clientX - at.startX, at.y + e.clientY - at.startY));
	};
	const keyboardMove = (e: KeyboardEvent<HTMLButtonElement>) => {
		if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault(); e.stopPropagation();
		const box = card.current?.getBoundingClientRect(); if (!box) return;
		setPosition(clamp(box.left + (e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0), box.top + (e.key === "ArrowUp" ? -20 : e.key === "ArrowDown" ? 20 : 0)));
	};
	useEffect(() => {
		const resize = () => setPosition(p => p ? clamp(p.x, p.y) : null);
		const observer = new ResizeObserver(resize); if (card.current) observer.observe(card.current);
		window.addEventListener("resize", resize); return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
	}, [clamp]);
	const focus = view.currentGroup ?? view.focusGroup;
	return <aside ref={card} aria-label="Lesson outline" data-testid="lesson-outline" data-floating="true"
		className="fixed z-40 flex max-h-[calc(100dvh-10rem)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background/95 font-sans shadow-xl backdrop-blur-sm"
		style={position ? { left: position.x, top: position.y } : { right: 20, top: 88 }}>
		<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
			<button type="button" aria-label="Move outline" title="Drag or use arrow keys to move" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={keyboardMove} className="touch-none cursor-grab text-muted-foreground active:cursor-grabbing"><GripVertical size={15} /></button>
			<h2 className="flex-1 text-sm font-semibold">Outline</h2>
			{view.busy && <span role="status" className="text-xs text-muted-foreground">Updating…</span>}
			<button type="button" aria-label={collapsed ? "Expand outline" : "Minimize outline"} aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)} className="rounded p-1 text-muted-foreground hover:bg-muted">{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
		</div>
		{!collapsed && <div className="min-h-0 max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain px-4 py-3">
			{view.groups.length ? <ol className="space-y-3 text-sm">
				{view.groups.map((group, index) => <li key={group.id} data-group-id={group.id}>
					<div className={group.id === focus ? "font-semibold" : "text-muted-foreground"}>{index + 1}. {group.title}</div>
					{group.id === focus && <ul className="mt-2 space-y-2 pl-2">
						{group.items.map(item => <li key={item.id} aria-current={item.state === "current" ? "step" : undefined} data-state={item.state} aria-label={item.label + " — " + item.state}
							className={"flex gap-2 text-sm leading-snug " + (item.state === "current" ? "font-semibold text-foreground" : item.state === "discussed" ? "text-foreground/80" : "text-muted-foreground")}>
							<span aria-hidden="true" className="w-3 shrink-0">{item.state === "current" ? "›" : item.state === "discussed" ? "•" : "○"}</span><span>{item.label}</span>
						</li>)}
					</ul>}
				</li>)}
			</ol> : <p className="text-sm text-muted-foreground">The outline will appear after the next teaching response.</p>}
			{view.error && <p className="mt-3 text-xs text-muted-foreground">{view.error}</p>}
		</div>}
	</aside>;
}
