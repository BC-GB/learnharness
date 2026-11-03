"use client";

import { useEffect, useMemo, useState } from "react";
import { useActivity } from "./activity-dock";
import type { PlanTree } from "@/src/core";
import { deriveNodeCoverage, type ConceptLabel, type ProgressMessage } from "./node-progress-core";

/** A small outline beside the lesson. No transcript, settings or model writes. */
export function NodeProgress({ tree, messages, chatId, refreshKey = 0 }: { tree: PlanTree; messages: readonly ProgressMessage[]; chatId?: string; refreshKey?: number }) {
 const [concepts, setConcepts] = useState<ConceptLabel[]>([]);
 const extracting = useActivity().feed.extractions.some(run => run.chatId === chatId);
 useEffect(() => {
  if (!chatId) return;
  let alive = true;
  const controller = new AbortController();
  // Read saved concepts only. Never trigger extraction or another model call.
  void fetch("/api/graph", { signal: controller.signal, cache: "no-store" }).then(async response => {
   if (!response.ok) return;
   const body = await response.json() as { propositions?: ConceptLabel[] };
   if (alive && Array.isArray(body.propositions)) setConcepts(body.propositions.filter(c => typeof c?.name === "string" && Array.isArray(c.provenance) && c.provenance.every(p => typeof p?.chatId === "string" && typeof p.messageId === "string")));
  }).catch(() => { /* Existing lesson definitions remain usable offline. */ });
  return () => { alive = false; controller.abort(); };
 }, [chatId, refreshKey, extracting]);
 const coverage = useMemo(() => deriveNodeCoverage(tree, messages, concepts, chatId), [tree, messages, concepts, chatId]);
 const [collapsed, setCollapsed] = useState(false);
 const node = coverage.nodes.find(n => n.id === coverage.current);
 if (!node || !node.ideas.length) return null;
 return (
  <section data-testid="node-progress" aria-label="Main ideas covered in this node" className="shrink-0 border-b border-border/60 bg-background px-4 py-2 sm:px-6">
   <div className="mx-auto w-full max-w-6xl">
    <div className="flex items-start gap-3 text-xs">
     <p className="min-w-0 break-words"><span className="text-muted-foreground">Covered so far · </span>{node.title}</p>
     <button type="button" aria-expanded={!collapsed} aria-label={collapsed ? "Show covered ideas" : "Hide covered ideas"} onClick={() => setCollapsed(!collapsed)} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground">{collapsed ? "Show" : "Hide"}</button>
    </div>
    {!collapsed && <ol data-testid="node-progress-details" className="mt-1 flex max-h-28 flex-wrap gap-x-6 gap-y-1 overflow-y-auto text-sm">
     {node.ideas.map((idea, i) => <li key={idea.toLocaleLowerCase()} className="max-w-full break-words"><span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>{idea}</li>)}
    </ol>}
   </div>
  </section>
 );
}
