import { courseMaintenanceStatus, courseRoute } from "@/src/server";

export const dynamic = "force-dynamic";
export const GET = courseRoute(async () => Response.json(courseMaintenanceStatus(), { headers: { "Cache-Control": "no-store" } }));
