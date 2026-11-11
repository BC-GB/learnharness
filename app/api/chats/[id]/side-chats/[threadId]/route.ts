import { courseRoute } from "@/src/server";
/**
 * One durable side conversation. GET attaches to its current answer (also
 * after reload); PATCH changes window visibility. Closing never deletes it.
 */
import { parseSideOpenInput, SideChatInputError } from "@/src/core";
import { sideChats } from "@/src/server";

type Ctx = { params: Promise<{ id: string; threadId: string }> };

async function handleCoursePATCH(request: Request, ctx: Ctx): Promise<Response> {
	const { id, threadId } = await ctx.params;
	let open: boolean;
	try {
		open = parseSideOpenInput(await request.json().catch(() => null));
	} catch (err) {
		if (err instanceof SideChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	const result = sideChats.setOpen(id, threadId, open);
	if (result === "unknown-chat") return Response.json({ error: "Unknown chat" }, { status: 404 });
	if (result === "unknown-thread") return Response.json({ error: "Unknown side thread" }, { status: 404 });
	return Response.json({ thread: result });
}

async function handleCourseGET(_req: Request, ctx: Ctx): Promise<Response> {
	const { id, threadId } = await ctx.params;
	return sideChats.watch(id, threadId);
}

export const PATCH = courseRoute(handleCoursePATCH);

export const GET = courseRoute(handleCourseGET);
