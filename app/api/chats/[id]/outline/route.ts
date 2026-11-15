import { courseRoute, optionalPluginCall } from "@/src/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = courseRoute(async (_request: Request, context: Context) => {
 try {
  const view = await optionalPluginCall("lesson-outline", "view", (await context.params).id);
  return view ? Response.json(view, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Not found" }, { status: 404 });
 } catch { return Response.json({ error: "Lesson outline plugin is unavailable" }, { status: 409 }); }
});
export const POST = courseRoute(async (_request: Request, context: Context) => {
 try {
  const id = (await context.params).id;
  const view = await optionalPluginCall("lesson-outline", "view", id) as { enabled: boolean; available: boolean } | null;
  if (!view) return Response.json({ error: "Not found" }, { status: 404 });
  if (!view.enabled || !view.available) return Response.json({ error: "Outline unavailable" }, { status: 409 });
  return Response.json(await optionalPluginCall("lesson-outline", "refresh", id), { headers: { "Cache-Control": "no-store" } });
 } catch { return Response.json({ error: "Lesson outline plugin is unavailable" }, { status: 409 }); }
});
