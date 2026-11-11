import { courseRoute } from "@/src/server";
import { pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handleCourseGET(_request: Request) { return pluginTransport.list(); }
function handleCoursePOST(request: Request) { return pluginTransport.refresh(request); }

export const GET = courseRoute(handleCourseGET);

export const POST = courseRoute(handleCoursePOST);
