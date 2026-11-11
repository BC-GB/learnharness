import { courseRoute } from "@/src/server";
import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleCoursePOST(request: Request, context: { params: Promise<{ id: string }> }) {
	return pluginTransport.call((await context.params).id, request);
}

export const POST = courseRoute(handleCoursePOST);
