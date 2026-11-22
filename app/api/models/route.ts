import { brokerEnabled } from "@/src/agent/broker-fetch";
import { courseRoute, modelCatalog, refreshConnectionCatalog, refreshModelCatalog } from "@/src/server";
import type { ModelCatalogRefreshResponse } from "@/src/core";

const headers = { "Cache-Control": "no-store" };

/**
 * The model picker's data (model-control wave): pi-ai's configured-provider
 * catalog as client-safe DTOs — id/name/cost/context/modality plus each
 * model's supported thinking levels. Reads bundled and locally saved
 * metadata; the existing connection catalogs still refresh independently.
 */
async function handleCourseGET() {
	await refreshConnectionCatalog();
	return Response.json(modelCatalog(), { headers });
}

/** Only this explicit action may contact pi.dev. The API Proxy guards it. */
async function handleCoursePOST() {
	if (brokerEnabled()) return Response.json({ error: "Remote model catalog refresh is unavailable in subscription mode" }, { status: 403, headers });
	let outcome;
	try { outcome = await refreshModelCatalog(); }
	catch { return Response.json({ error: "Model catalog refresh failed" }, { status: 502, headers }); }
	return Response.json({ outcome, catalog: modelCatalog() } satisfies ModelCatalogRefreshResponse, { headers });
}

export const GET = courseRoute(handleCourseGET);
export const POST = courseRoute(handleCoursePOST);
