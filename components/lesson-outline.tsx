"use client";

import { useEffect, useRef, useState } from "react";
import { courseFetch as fetch, documentCourse } from "@/lib/course-client";
import { useSettingsSaved } from "@/components/settings-signal";

interface View {
	enabled: boolean; available: boolean; busy: boolean; currentNode: string | null; error?: string | null;
	topics: { id: string; title: string; items: { id: string; label: string; discussed: boolean; current: boolean }[] }[];
}

/** Separate GET-only navigation. No transcript, tool, answer or teacher-context writes. */
export function LessonOutline({ chatId, revision }: { chatId: string; revision: number }) {
	const [view, setView] = useState<View | null>(null); const [settingsTick, setSettingsTick] = useState(0);
	const courseId = documentCourse(); const [viewCourse, setViewCourse] = useState(courseId);
	useSettingsSaved(section => { if (section === "general") setSettingsTick(x => x + 1); });
	useEffect(() => {
		const controller = new AbortController(); let serial = 0;
		const refresh = async () => {
			const ticket = ++serial;
			try {
				const response = await fetch(`/api/chats/${chatId}/outline`, { signal: controller.signal });
				if (!response.ok) return;
				const next = await response.json();
				if (!next.enabled || !next.available) window.clearInterval(timer);
				if (!controller.signal.aborted && ticket === serial && documentCourse() === courseId) { setView(next); setViewCourse(courseId); }
			} catch { /* Reading a lesson remains usable if navigation is unavailable. */ }
		};
		void refresh();
		const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
		return () => { controller.abort(); window.clearInterval(timer); };
	}, [chatId, revision, settingsTick, courseId]);
	if (!view?.enabled || !view.available || viewCourse !== courseId) return null;
	return <OutlinePanel view={view} />;
}

export function OutlinePanel({ view }: { view: View }) {
	const currentRef = useRef<HTMLLIElement>(null);
	useEffect(() => { currentRef.current?.scrollIntoView({ block: "nearest" }); }, [view.currentNode]);
	return <aside aria-label="Lesson outline" data-testid="lesson-outline" className="hidden w-64 shrink-0 overflow-y-auto border-l border-border bg-background px-4 py-4 xl:block">
		<div className="mb-4 flex items-center justify-between text-sm font-medium"><span>Outline</span>{view.busy && <span className="text-xs text-muted-foreground">Updating…</span>}</div>
		<ol className="space-y-3 text-sm">
			{view.topics.map((topic, index) => <li key={topic.id} ref={topic.id === view.currentNode ? currentRef : undefined} aria-current={topic.id === view.currentNode ? "step" : undefined} className={topic.id === view.currentNode ? "border-l-2 border-foreground pl-3" : "pl-3 text-muted-foreground"}>
				<div className={topic.id === view.currentNode ? "font-medium" : undefined}>{index + 1}. {topic.title}</div>
				{topic.id === view.currentNode && topic.items.length > 0 && <ul className="mt-2 space-y-1.5 pl-3 text-xs">
					{topic.items.map(item => <li key={item.id} className={item.current ? "font-medium text-foreground" : "text-muted-foreground"}>{item.current ? "› " : "· "}{item.label}</li>)}
				</ul>}
			</li>)}
		</ol>
		{view.error && <p className="mt-4 text-xs text-muted-foreground">{view.error}</p>}
	</aside>;
}
