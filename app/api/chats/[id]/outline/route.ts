import { courseRoute, optionalPluginCall } from "@/src/server";
export const dynamic = "force-dynamic";
export const GET = courseRoute(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
 try { return Response.json(await optionalPluginCall("lesson-outline", "view", (await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
 catch { return Response.json({ enabled: false, available: false, groups: [] }, { status: 409 }); }
});
export const POST = courseRoute(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
 try { return Response.json(await optionalPluginCall("lesson-outline", "refresh", (await context.params).id)); }
 catch { return Response.json({ error: "Lesson outline is unavailable" }, { status: 409 }); }
});
