"use client";
import { useMemo } from "react";
import { PluginMountPoint, usePlugins } from "./plugins";
import type { PluginWidget } from "@/src/core";
export function PluginContributions({ location, session }: { location: PluginWidget["location"]; session?: { id: string; kind: "teaching" | "practice" } }) {
 const { snapshot } = usePlugins();
 return <>{snapshot.plugins.flatMap(p => (p.widgets ?? []).filter(w => w.location === location).map(w => <Widget key={p.info.id + ":" + w.id} pluginId={p.info.id} widget={w} session={session} />))}</>;
}
function Widget({ pluginId, widget, session }: { pluginId: string; widget: PluginWidget; session?: { id: string; kind: "teaching" | "practice" } }) {
 const id = session?.id, kind = session?.kind;
 const mount = useMemo(() => (container: HTMLElement, signal: AbortSignal) => widget.mount(container, signal, id && kind ? { id, kind } : undefined), [widget, id, kind]);
 return <PluginMountPoint pluginId={pluginId} mount={mount} label={widget.id} />;
}
