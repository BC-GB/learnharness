import { courseRoute, lessonOutlineView, refreshLessonOutline } from "@/src/server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = courseRoute(async (_request: Request, context: Context) => {
	const view = lessonOutlineView((await context.params).id);
	return view ? Response.json(view, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Not found" }, { status: 404 });
});
export const POST = courseRoute(async (_request: Request, context: Context) => {
	const id = (await context.params).id; const view = lessonOutlineView(id);
	if (!view) return Response.json({ error: "Not found" }, { status: 404 });
	if (!view.enabled || !view.available) return Response.json({ error: "Outline unavailable" }, { status: 409 });
	await refreshLessonOutline(id, { force: true });
	return Response.json(lessonOutlineView(id), { headers: { "Cache-Control": "no-store" } });
});
