import { courseRoute } from "@/src/server";
import { graphView } from "@/src/server";

/**
 * The home graph view's data endpoint (W4; vision §1 "Home page") — thin
 * transport: the server entry (src/server/graph.ts) returns nodes, edges,
 * session provenance, and per-session understanding observations.
 */

export const dynamic = "force-dynamic";

async function handleCourseGET() {
	return Response.json(graphView());
}

export const GET = courseRoute(handleCourseGET);
