import { courseRoute, optionalPluginCall, preferenceView } from "@/src/server";
export const dynamic = "force-dynamic";
async function boundedBody(request: Request): Promise<string> {
 const reader = request.body?.getReader(); if (!reader) return "";
 const parts: Uint8Array[] = []; let size = 0;
 try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 128 * 1024) { await reader.cancel(); throw new Error("Request too long"); } parts.push(value); } }
 finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
 return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export const GET = courseRoute(async () => {
 try { return Response.json(await optionalPluginCall("learning-preferences", "view"), { headers: { "Cache-Control": "no-store" } }); }
 catch { return Response.json({ error: "Learning preferences plugin is unavailable" }, { status: 409 }); }
});
export const POST = courseRoute(async (request: Request) => {
 try {
  const input = JSON.parse(await boundedBody(request));
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid request");
  if (typeof input.revision !== "string" || input.revision !== preferenceView().revision) return Response.json({ error: "Preferences changed. Reload first." }, { status: 409 });
  return Response.json(await optionalPluginCall("learning-preferences", "edit", input));
 }
 catch { return Response.json({ error: "Preference request could not finish. Reload to check saved text; Undo remains available." }, { status: 400 }); }
});
