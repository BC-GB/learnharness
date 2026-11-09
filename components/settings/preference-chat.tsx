"use client";
import { useEffect, useState } from "react";
import { courseFetch as fetch } from "@/lib/course-client";
import { notifySettingsSaved } from "@/components/settings-signal";
type View = { text: string; revision: string; scope: string; canUndo: boolean; enabled: boolean };
export function PreferenceChat() {
 const [view, setView] = useState<View | null>(null), [message, setMessage] = useState("");
 const [draft, setDraft] = useState<{ text: string; summary: string } | null>(null);
 const [error, setError] = useState(""), [busy, setBusy] = useState(false);
 useEffect(() => { let active = true; void fetch("/api/settings/preference-chat").then(r => r.json()).then(v => { if (active) { if (v.error) setError(v.error); else setView(v); } }).catch(() => { if (active) setError("Could not load preferences"); }); return () => { active = false; }; }, []);
 async function send(action: "draft" | "apply" | "undo") {
  if (!view || busy) return; setBusy(true); setError("");
  try { const r = await fetch("/api/settings/preference-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, revision: view.revision, message, text: draft?.text }) }); const v = await r.json(); if (!r.ok) throw new Error(v.error);
   if (action === "draft") setDraft(v); else { setView(v); setDraft(null); setMessage(""); notifySettingsSaved("agent"); }
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 return <div className="space-y-3 p-5" data-testid="preference-chat">
  <h3 className="text-sm font-medium">Learning preferences</h3>
  <p className="text-xs text-muted-foreground">Tell the agent how you want to learn. It uses your teaching model to draft changes to appended guidance only. Review before applying. {view?.scope === "global" ? "Applies across courses." : "Applies to this course."} Original prompts stay unchanged.</p>
  {error && <p role="alert" className="text-xs text-red-500">{error} Reload Settings if preferences changed elsewhere.</p>}
  <details><summary className="text-xs">Current appended text{view && !view.enabled ? " (disabled)" : ""}</summary><pre className="whitespace-pre-wrap text-xs">{view?.text || "No appended text yet."}</pre></details>
  <label className="block text-xs">Your request<textarea aria-label="Learning preference request" className="mt-1 w-full rounded border border-border bg-background p-2" value={message} maxLength={4000} disabled={busy} onChange={e => setMessage(e.target.value)} /></label>
  <button type="button" disabled={busy || !view || !message.trim()} onClick={() => void send("draft")} className="rounded border border-border px-3 py-1 text-xs disabled:opacity-40">{busy ? "Working…" : "Send to preference agent"}</button>
  {draft && <div className="space-y-2"><p className="text-xs">{draft.summary}</p><details><summary className="text-xs">Before</summary><pre className="whitespace-pre-wrap text-xs">{view?.text || "(empty)"}</pre></details><label className="block text-xs">Proposed complete addition<textarea aria-label="Proposed preference addition" className="mt-1 min-h-40 w-full rounded border border-border bg-background p-2" maxLength={16000} value={draft.text} disabled={busy} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label><button type="button" disabled={busy} onClick={() => void send("apply")} className="rounded border border-border px-3 py-1 text-xs">Apply and enable</button></div>}
  {view?.canUndo && <button type="button" disabled={busy} onClick={() => void send("undo")} className="ml-2 text-xs underline">Undo last change</button>}
 </div>;
}
