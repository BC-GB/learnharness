import { courseRoute } from "@/src/server";
import { handleChatRequest } from "@/src/server";

async function handleCoursePOST(req: Request) {
	return handleChatRequest(req);
}

export const POST = courseRoute(handleCoursePOST);
