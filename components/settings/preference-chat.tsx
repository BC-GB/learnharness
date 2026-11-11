"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { courseFetch as fetch } from "@/lib/course-client";
import type { PreferenceChatView } from "@/src/core";
import { useCourse } from "@/components/course-navigation";
import { notifySettingsSaved } from "@/components/settings-signal";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";

const OPEN_EVENT = "lh:open-preference-chat";
export function openPreferenceChat() { window.dispatchEvent(new window.Event(OPEN_EVENT)); }
export function PreferenceChatShortcut({ onOpen }: { onOpen: () => void }) {
 return <div className="space-y-3 p-5" data-testid="preference-chat-shortcut">
  <h3 className="text-sm font-medium">Learning preferences</h3>
  <p className="text-xs text-muted-foreground">Continue your preferences conversation in the floating chat. Review changes before applying them.</p>
  <button type="button" className="rounded border border-border px-3 py-2 text-xs" onClick={() => { onOpen(); openPreferenceChat(); }}>Open preferences chat</button>
 </div>;
}
export function FloatingPreferenceChat() {
 const course = useCourse();
 return <PreferenceChat key={course.id} courseName={course.name} />;
}
export function PreferenceChat({ courseName = "this course" }: { courseName?: string }) {
 const [open, setOpen] = useState(false);
 const [view, setView] = useState<PreferenceChatView | null>(null);
 const viewRef = useRef<PreferenceChatView | null>(null);
 const [message, setMessage] = useState("");
 const [draftText, setDraftText] = useState("");
 const [error, setError] = useState("");
 const [busy, setBusy] = useState(false);
 const busyRef = useRef(false);
 const mounted = useRef(false);
 const generation = useRef(0);
 const root = useRef<HTMLDivElement>(null);
 const panel = useRef<HTMLElement>(null);
 const trigger = useRef<HTMLButtonElement>(null);
 const input = useRef<HTMLTextAreaElement>(null);
 const log = useRef<HTMLDivElement>(null);
 const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
 const layer = usePopoverDismiss(root, open, close, { layerRootRef: panel });
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
 const accept = useCallback((next: PreferenceChatView) => {
  if (viewRef.current?.conversation.revision !== next.conversation.revision) setDraftText(next.conversation.proposal?.text ?? "");
  viewRef.current = next; setView(next);
 }, []);
 const reload = useCallback(async () => {
  if (busyRef.current) return;
  const current = ++generation.current;
  setError("");
  try {
   const response = await fetch("/api/settings/preference-chat", { cache: "no-store" }); const next = await response.json();
   if (!response.ok) throw new Error(next.error || "Could not load preferences.");
   if (mounted.current && generation.current === current) accept(next);
  } catch (e) { if (mounted.current && generation.current === current) setError((e as Error).message); }
 }, [accept]);
 useEffect(() => { const show = () => setOpen(true); window.addEventListener(OPEN_EVENT, show); return () => window.removeEventListener(OPEN_EVENT, show); }, []);
 useEffect(() => { if (open) { void reload(); input.current?.focus({ preventScroll: true }); } }, [open, reload]);
 useEffect(() => {
  const element = log.current;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 180) element.scrollTop = element.scrollHeight;
 }, [view?.conversation.messages.length, busy]);
 async function send(action: "chat" | "apply" | "undo") {
  if (!view || busyRef.current || (action === "chat" && !message.trim())) return;
  busyRef.current = true; setBusy(true); setError(""); generation.current++;
  try {
   const response = await fetch("/api/settings/preference-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, revision: view.revision, conversationRevision: view.conversation.revision, message, text: draftText }) });
   const next = await response.json();
   if (!response.ok) throw new Error(next.error || "The preference request did not finish.");
   if (mounted.current) { accept(next); if (action === "chat") setMessage(""); if (action !== "chat") notifySettingsSaved("agent"); }
  } catch (e) { if (mounted.current) setError((e as Error).message); }
  finally { busyRef.current = false; if (mounted.current) setBusy(false); }
 }
 const stale = !!view?.conversation.proposal && view.conversation.proposal.baseRevision !== view.revision;
 return <div ref={root} className="lh-no-drag fixed bottom-4 right-4 max-w-[calc(100vw-2rem)]" style={{ zIndex: open ? INTERACTION_LAYER_Z_BASE + layer.order : 40 }} data-testid="floating-preference-chat">
  <section ref={panel} hidden={!open} role="dialog" aria-modal="false" aria-label="Learning preferences chat" className="mb-3 flex h-[min(38rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" data-testid="preference-chat">
   <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
    <div className="min-w-0 flex-1"><h2 className="text-sm font-medium">Learning preferences</h2><p className="truncate text-[11px] text-muted-foreground">Conversation: {courseName}</p></div>
    <button type="button" aria-label="Close preferences chat" onClick={close} className="rounded p-1 hover:bg-accent"><X size={16} /></button>
   </header>
   <div className="shrink-0 border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
    {view?.scope === "global" ? "Applied preferences affect all courses. " : "Applied preferences affect this course. "}
    Chat history stays in this course. Only this conversation and preference text go to your teaching model when you send. Original prompts stay unchanged.
   </div>
   <div ref={log} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-label="Preference conversation" aria-live="polite">
    {!view?.conversation.messages.length && <p className="text-sm text-muted-foreground">How would you like to learn? Tell me what to change, then keep refining it here. Nothing is applied until you review it.</p>}
    {view?.conversation.messages.map(m => <div key={m.id} className={m.role === "user" ? "ml-6 rounded-lg bg-accent p-3" : m.role === "notice" ? "text-xs text-muted-foreground" : "mr-4 rounded-lg border border-border p-3"}>
     {m.role !== "notice" && <p className="mb-1 text-[10px] uppercase text-muted-foreground">{m.role === "user" ? "You" : "Preferences agent"}</p>}
     <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
    </div>)}
    {busy && <p className="text-xs text-muted-foreground" role="status">Working...</p>}
   </div>
   <div className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t border-border px-4 py-2">
    {error && <div role="alert" className="text-xs text-error">{error} <button type="button" disabled={busy} className="underline" onClick={() => void reload()}>Reload saved conversation</button></div>}
    {view?.conversation.proposal && <details data-testid="preference-review"><summary className="cursor-pointer text-xs font-medium">Review proposed preferences</summary>
     {stale && <p className="py-2 text-xs text-error">Preferences changed elsewhere. Send a follow-up to refresh this proposal before applying.</p>}
     <details className="py-2 text-xs"><summary>Before</summary><pre className="whitespace-pre-wrap break-words">{view.text || "(empty)"}</pre></details>
     <label className="block text-xs">Proposed complete addition<textarea aria-label="Proposed preference addition" value={draftText} maxLength={16000} disabled={busy || stale} onInput={e => setDraftText(e.currentTarget.value)} className="mt-1 min-h-32 w-full rounded border border-border bg-background p-2" /></label>
     <button type="button" disabled={busy || stale} onClick={() => void send("apply")} className="my-2 rounded border border-border px-3 py-1 text-xs disabled:opacity-40">Apply and enable</button>
    </details>}
    <details className="text-xs"><summary className="cursor-pointer">Current preferences{view && !view.enabled ? " (disabled)" : ""}</summary><pre className="whitespace-pre-wrap break-words py-2">{view?.text || "No appended text yet."}</pre></details>
    {view?.canUndo && <button type="button" disabled={busy} onClick={() => void send("undo")} className="text-xs underline disabled:opacity-40">Undo last change</button>}
   </div>
   <form className="shrink-0 space-y-2 border-t border-border p-3" onSubmit={e => { e.preventDefault(); void send("chat"); }}>
    <textarea ref={input} aria-label="Learning preference request" placeholder="Tell me how you want to learn..." rows={2} className="w-full resize-none rounded border border-border bg-background p-2 text-sm" value={message} maxLength={4000} disabled={busy} onInput={e => setMessage(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send("chat"); } }} />
    <div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span><button type="submit" disabled={busy || !view || !message.trim()} className="rounded border border-border px-3 py-1 text-xs disabled:opacity-40">Send</button></div>
   </form>
  </section>
  <button ref={trigger} type="button" onClick={() => setOpen(value => !value)} aria-label={open ? "Hide preferences chat" : "Open preferences chat"} aria-expanded={open} className="ml-auto flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-2 text-xs shadow-md hover:bg-accent" data-testid="preference-chat-toggle"><MessageCircle size={16} /><span>Preferences</span></button>
 </div>;
}
