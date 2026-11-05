import { NextResponse, type NextRequest } from "next/server";
import { desktopAPIAuthorized } from "./src/server/desktop-access.ts";
import { isCourseId } from "./src/core/courses.ts";

/** Protects pages (including server-rendered chat data), assets, and every API method.
 * No public callback or worker bypass: internal jobs call server functions,
 * and any legitimate self-HTTP request must carry the private capability. */
export function proxy(request: NextRequest) {
	if (!desktopAPIAuthorized(request.headers)) {
		return NextResponse.json(
			{ error: "Access requires the trusted LearnHarness window or authenticated gateway." },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
	const selections = request.nextUrl.searchParams.getAll("course");
	const selectedHeader = request.headers.get("x-learnharness-course");
	if (selections.length > 1 || (selectedHeader !== null && selections.length && selectedHeader !== selections[0])) return NextResponse.json({ error: "Conflicting course selection." }, { status: 400 });
	const course = selectedHeader ?? selections[0] ?? "legacy";
	if (!isCourseId(course)) return NextResponse.json({ error: "Unknown course." }, { status: 404 });
	const headers = new Headers(request.headers);
	// Always overwrite this internal page header, including on RSC requests.
	headers.set("x-lh-page-course", course);
	return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/:path*" };
