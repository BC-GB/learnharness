import { courseRoute, courseMaterials, uploadCourseMaterials } from "@/src/server";

export const dynamic = "force-dynamic";
export const GET = courseRoute(async () => Response.json(courseMaterials(), { headers: { "Cache-Control": "no-store" } }));
export const POST = courseRoute(async (request: Request) => Response.json({ added: await uploadCourseMaterials(request) }, { status: 201 }));
