import { courseRoute } from "@/src/server";
import { subscriptionBrowserResponse } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = courseRoute(subscriptionBrowserResponse);
export const POST = courseRoute(subscriptionBrowserResponse);
