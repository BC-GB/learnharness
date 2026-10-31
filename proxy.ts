import { NextResponse, type NextRequest } from "next/server";
import { desktopAPIAuthorized } from "./src/server/desktop-access.ts";

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
	return NextResponse.next();
}

export const config = { matcher: "/:path*" };
