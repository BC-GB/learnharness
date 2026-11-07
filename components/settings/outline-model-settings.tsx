"use client";

import { useEffect, useRef, useState } from "react";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { resolveOutlineModelSpec, type GeneralSettings, type RoleModelOverride, type UserSettings } from "@/src/core";
import { useModelCatalog } from "@/components/model-catalog";
import { MenuShell } from "@/components/menu-shell";
import { defaultOrderLevel, populateLevel } from "@/components/thinking-default";
import { prettyModel } from "@/components/usage-format";
import { SettingsMenuTrigger, SettingsRow } from "./controls";
import { ModelMenuList, ThinkingMenuList } from "./model-menu";

/** Global preference for the independent observer, using the original model menu. */
export function OutlineModelSettings({ settings, onChange, autofocus = false }: { settings: UserSettings; onChange: (next: GeneralSettings) => Promise<void>; autofocus?: boolean }) {
	const { catalog, failed } = useModelCatalog(); const effective = resolveOutlineModelSpec(settings);
	const selected = catalog?.models?.find(m => m.provider === effective?.provider && m.id === effective?.id);
	const levels = selected?.supportedLevels ?? [];
	const reasoning = effective?.thinkingLevel ?? (selected ? defaultOrderLevel(levels) : undefined);
	const [menu, setMenu] = useState<"model" | "thinking" | null>(null); const [saving, setSaving] = useState(false);
	const anchor = useRef<HTMLSpanElement>(null);
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => { if (autofocus) root.current?.scrollIntoView?.({ block: "nearest" }); }, [autofocus]);
	useEffect(() => {
		if (!menu) return;
		const pointer = (e: PointerEvent) => { if (e.target instanceof Element && !anchor.current?.contains(e.target) && !e.target.closest("[data-lh-menu]")) setMenu(null); };
		const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(null); } };
		document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", key, true);
		return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key, true); };
	}, [menu]);
	const commit = async (override?: RoleModelOverride) => {
		setMenu(null); setSaving(true); const next = { ...settings.general };
		if (override) next.outlineModel = override; else delete next.outlineModel;
		try { await onChange(next); } finally { setSaving(false); }
	};
	return <div ref={root} data-testid="outline-model-settings">
		<SettingsRow label="Outline model" hint="Applies to the next outline update." testid="row-outline-model">
			<span ref={anchor} className="relative flex items-center gap-2">
				<SettingsMenuTrigger aria-label="Outline model" data-testid="outline-model" value={effective ? prettyModel(effective.id) : "Not configured"} disabled={saving} aria-expanded={menu === "model"} onClick={() => setMenu(menu === "model" ? null : "model")} />
				<SettingsMenuTrigger aria-label="Outline reasoning" data-testid="outline-reasoning" value={reasoning ?? "—"} disabled={saving || !selected} aria-expanded={menu === "thinking"} onClick={() => setMenu(menu === "thinking" ? null : "thinking")} />
				{menu === "model" && <MenuShell preferredSide="down" anchorTestid="outline-model" testid="outline-model-menu" menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl">
					<button type="button" className="mb-2 rounded px-2 py-2 text-left hover:bg-accent" onClick={() => void commit()}>Use background defaults</button>
					<ModelMenuList models={catalog?.models} effectiveId={effective?.id} effectiveProvider={effective?.provider} onPick={entry => void commit({ ...settings.general?.outlineModel, model: { provider: entry.provider, id: entry.id }, thinkingLevel: populateLevel(reasoning, entry.supportedLevels) })} footer={failed ? "Model list unavailable. Your saved selection is retained." : "Independent outline model"} />
				</MenuShell>}
				{menu === "thinking" && <MenuShell preferredSide="down" anchorTestid="outline-reasoning" testid="outline-reasoning-menu" menuClass="flex w-44 flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl">
					<ThinkingMenuList levels={levels.map(String)} effectiveLevel={reasoning} onPick={level => void commit({ ...settings.general?.outlineModel, thinkingLevel: level as ThinkingLevel })} />
				</MenuShell>}
			</span>
		</SettingsRow>
		<p className="px-1 pb-2 text-xs leading-relaxed text-muted-foreground" data-testid="outline-context-summary">Reads this course’s plan and reading excerpts, teaching samples and the previous outline. Historical coverage is sampled; answer records and other subjects aren’t loaded.</p>
	</div>;
}
