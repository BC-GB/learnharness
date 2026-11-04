import { courseRoute } from "@/src/server";
import { claudeCodeInstallationResponse } from "@/src/server";

/** Installation/version only; never reads auth status or makes a model request. */
async function handleCourseGET(request: Request) {
	return claudeCodeInstallationResponse(request);
}

export const GET = courseRoute(handleCourseGET);
