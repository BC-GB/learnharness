import { courseRoute } from "@/src/server";
import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleCoursePUT(request: Request, context: { params: Promise<{ id: string }> }) {
	return pluginTransport.setEnabled((await context.params).id, request);
}

export const PUT = courseRoute(handleCoursePUT);
