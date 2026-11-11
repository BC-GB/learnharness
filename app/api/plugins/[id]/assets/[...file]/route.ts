import { courseRoute } from "@/src/server";
import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleCourseGET(_request: Request, context: { params: Promise<{ id: string; file: string[] }> }) {
	const { id, file } = await context.params;
	return pluginTransport.asset(id, file);
}

export const GET = courseRoute(handleCourseGET);
