import { courseRoute, preferenceView, applyPreferences, undoPreferences, proposePreferences } from "@/src/server";
export const dynamic = "force-dynamic";
async function boundedBody(request: Request): Promise<string> {
 const reader = request.body?.getReader(); if (!reader) return "";
 const parts: Uint8Array[] = []; let size = 0;
 try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 20000) { await reader.cancel(); throw new Error("Request too long"); } parts.push(value); } }
 finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
 return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export const GET = courseRoute(async () => { try { return Response.json(preferenceView()); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); } });
export const POST = courseRoute(async (request: Request) => {
 try {
  const raw = await boundedBody(request);
  const body = JSON.parse(raw); const current = preferenceView();
  if (typeof body.revision !== "string" || body.revision !== current.revision) return Response.json({ error: "Preferences changed. Reload first." }, { status: 409 });
  if (body.action === "apply" && typeof body.text === "string") return Response.json(applyPreferences(body.revision, body.text));
  if (body.action === "undo") return Response.json(undoPreferences(body.revision));
  if (body.action !== "draft" || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) return Response.json({ error: "Invalid request" }, { status: 400 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  const proposal = await proposePreferences(current.text, body.message, signal);
  return Response.json({ ...proposal, revision: current.revision });
 } catch { return Response.json({ error: "Preference request failed. Your draft has not been automatically applied; reload to check saved text." }, { status: 400 }); }
});
