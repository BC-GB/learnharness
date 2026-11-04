import { courseRoute } from "@/src/server";
import { subscriptionControlsResponse } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = courseRoute(subscriptionControlsResponse);
export const POST = courseRoute(subscriptionControlsResponse);

