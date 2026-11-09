import { courseRoute } from "@/src/server";
import { preferenceView, applyPreferences, undoPreferences } from "@/src/server/preference-editor";
import { draftPreferences } from "@/src/agent/preference-editor";
import { piEngineForSpec } from "@/src/agent/models";
import { resolveModelSpec } from "@/src/core/settings-resolution";
import { stores } from "@/src/server/stores";
export const dynamic = "force-dynamic";
export const GET = courseRoute(async () => { try { return Response.json(preferenceView()); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); } });
export const POST = courseRoute(async (request: Request) => {
 try {
  const raw = await request.text(); if (raw.length > 20000) return Response.json({ error: "Request too long" }, { status: 413 });
  const body = JSON.parse(raw); const current = preferenceView();
  if (typeof body.revision !== "string" || body.revision !== current.revision) return Response.json({ error: "Preferences changed. Reload first." }, { status: 409 });
  if (body.action === "apply" && typeof body.text === "string") return Response.json(applyPreferences(body.revision, body.text));
  if (body.action === "undo") return Response.json(undoPreferences(body.revision));
  if (body.action !== "draft" || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) return Response.json({ error: "Invalid request" }, { status: 400 });
  const settings = stores.settingsStore.readSettings();
  const spec = resolveModelSpec("teacher", settings?.agent?.models?.teacher, settings?.models);
  if (!spec) return Response.json({ error: "Choose a teaching model in Settings first." }, { status: 409 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  const proposal = await draftPreferences(piEngineForSpec(spec, false), current.text, body.message, signal);
  return Response.json({ ...proposal, revision: current.revision, model: spec.id });
 } catch { return Response.json({ error: "Preference request failed. Your draft has not been automatically applied; reload to check saved text." }, { status: 400 }); }
});
