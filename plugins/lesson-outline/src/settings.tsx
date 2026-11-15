import { useEffect, useRef, useState } from "react";
import type { PluginFrontendContext, PluginModelSpec, PluginWidgetHandle, PluginModelPickerProps, PluginThinkingPickerProps } from "../.sdk/index.d.ts";
type Configuration = { values: { lessonOutline?: boolean; backgroundThinkingLevel?: PluginModelSpec["thinkingLevel"]; outlineModel?: { model?: { id: string; provider: string }; thinkingLevel?: PluginModelSpec["thinkingLevel"] } }; models: { background: PluginModelSpec | null } };
export function OutlineSettings({ ctx, signal }: { ctx: PluginFrontendContext; signal: AbortSignal }) {
 const [config, setConfig] = useState<Configuration | null>(null), [error, setError] = useState("");
 const [busy, setBusy] = useState(false); const alive = useRef(true);
 const modelContainer = useRef<HTMLDivElement>(null), thinkingContainer = useRef<HTMLDivElement>(null);
 const model = useRef<PluginWidgetHandle<PluginModelPickerProps> | null>(null), thinking = useRef<PluginWidgetHandle<PluginThinkingPickerProps> | null>(null);
 const current = useRef(config); current.current = config;
 const generation = useRef(0), saving = useRef(false);
 const save = async (patch: Record<string, unknown>) => {
  if (signal.aborted || saving.current) return; saving.current = true; const ticket = ++generation.current; setBusy(true); setError("");
  try { const next = await ctx.call<Configuration>("configure", patch); if (alive.current && !signal.aborted && ticket === generation.current) setConfig(next); }
  catch (e) { if (alive.current && !signal.aborted && ticket === generation.current) setError((e as Error).message); } finally { saving.current = false; if (alive.current) setBusy(false); }
 };
 const saveRef = useRef(save); saveRef.current = save;
 useEffect(() => {
  alive.current = true;
  const refresh = () => { const ticket = ++generation.current; void ctx.call<Configuration>("configuration").then(next => { if (alive.current && !signal.aborted && ticket === generation.current) setConfig(next); }).catch(e => { if (alive.current && !signal.aborted && ticket === generation.current) setError((e as Error).message); }); };
  refresh(); const off = ctx.onNotification(refresh), resync = ctx.onResync(refresh), events = ctx.onAppEvent(event => { if (event.type === "settings-changed") refresh(); });
  return () => { alive.current = false; generation.current++; off(); resync(); events(); };
 }, [ctx, signal]);
 useEffect(() => {
  if (!modelContainer.current || !thinkingContainer.current) return;
  model.current = ctx.ui.mountModelPicker(modelContainer.current, { value: undefined, disabled: true, onChange: value => saveRef.current({ outlineModel: { ...current.current?.values.outlineModel, model: value, thinkingLevel: current.current?.values.backgroundThinkingLevel ?? current.current?.models.background?.thinkingLevel } }) }, { signal });
  thinking.current = ctx.ui.mountThinkingPicker(thinkingContainer.current, { model: undefined, value: undefined, disabled: true, onChange: thinkingLevel => saveRef.current({ outlineModel: { ...current.current?.values.outlineModel, thinkingLevel } }) }, { signal });
  return () => { model.current?.dispose(); thinking.current?.dispose(); };
 }, [ctx, signal]);
 useEffect(() => { const spec = config?.models.background; model.current?.update({ value: spec ?? undefined, disabled: busy || !config }); thinking.current?.update({ model: spec ?? undefined, value: config?.values.backgroundThinkingLevel ?? spec?.thinkingLevel, disabled: busy || !spec }); }, [config, busy]);
 return <div className="space-y-3 py-3" data-testid="outline-model-settings">
  <div className="flex items-center justify-between gap-3" data-testid="row-lesson-outline"><div><p className="text-sm">Lesson outline</p><p className="text-xs text-muted-foreground">A separate AI organises the lesson using its plan and course readings. Teaching stays unchanged.</p></div><button type="button" role="switch" data-testid="toggle-lesson-outline" aria-label="Lesson outline" aria-checked={config?.values.lessonOutline === true} disabled={busy || !config} onClick={() => void save({ lessonOutline: !config?.values.lessonOutline })} className="rounded border border-border px-3 py-1 text-xs disabled:opacity-40">{config?.values.lessonOutline ? "On" : "Off"}</button></div>
  <div className="flex flex-wrap items-center gap-3"><span className="text-sm">Outline model</span><div ref={modelContainer} data-testid="outline-model" /><span className="text-sm">Outline reasoning</span><div ref={thinkingContainer} data-testid="outline-reasoning" /></div>
  <button type="button" disabled={busy || !config} onClick={() => void save({ outlineModel: null })} className="text-xs underline">Use background defaults</button>
  <p className="text-xs text-muted-foreground" data-testid="outline-context-summary">Reads this course’s plan and reading excerpts, teaching samples and the previous outline. Historical coverage is sampled; answer records and other subjects aren’t loaded.</p>
  {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
 </div>;
}
