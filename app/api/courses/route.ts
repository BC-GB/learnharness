import { courseRoute, listCourses, addCourse, CourseError, boundedCourseBody } from "@/src/server";

export const dynamic = "force-dynamic";
export const GET = courseRoute(async () => Response.json({ courses: listCourses() }, { headers: { "Cache-Control": "no-store" } }));
export const POST = courseRoute(async (request: Request) => {
	let body;
	try { body = JSON.parse(new TextDecoder().decode(await boundedCourseBody(request, 4096))); }
	catch { throw new CourseError("Invalid course details."); }
	return Response.json({ course: addCourse(body?.name) }, { status: 201 });
});
