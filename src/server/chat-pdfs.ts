import { boundedCourseBody } from "./course-materials.ts";
import { CourseError } from "../store/courses.ts";
import { MAX_CHAT_PDF_BYTES, readChatPdf, storeChatPdf } from "../runtime/chat-pdfs.ts";
import { isolatedRender } from "../agent/subagents/render-client.ts";

let active = 0;
export async function uploadChatPdf(request: Request): Promise<Response> {
	if (active >= 2) throw new CourseError("Another PDF is uploading. Try again shortly.", 429);
	active++;
	try {
		const bytes = await boundedCourseBody(request, MAX_CHAT_PDF_BYTES);
		request.signal.throwIfAborted();
		if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("Not a PDF");
		// The same networkless, bounded renderer used by the PDF reader parses
		// untrusted bytes. No PDF parser or document script runs in the app.
		const info = await isolatedRender<{ page_count: number }>({ op: "info", pdf: Buffer.from(bytes).toString("base64") }, { signal: request.signal });
		request.signal.throwIfAborted();
		const raw = new URL(request.url).searchParams.getAll("filename");
		if (raw.length !== 1 || raw[0]!.length > 1024) throw new Error("Invalid filename");
		const saved = storeChatPdf(bytes, raw[0]!, info.page_count);
		return Response.json(saved, { status: 201, headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof CourseError) throw error;
		throw new CourseError("Could not attach this PDF. Use an unencrypted PDF up to 20 MB and 200 pages. If it is damaged or too complex, export a smaller PDF and try again.");
	} finally { active--; }
}
export function chatPdfResponse(request: Request): Response {
	try {
		const params = new URL(request.url).searchParams;
		const names = params.getAll("name");
		if (names.length !== 1 || params.getAll("metadata").length > 1) throw new Error();
		const saved = readChatPdf(names[0]!);
		if (params.get("metadata") === "1") return Response.json(saved.metadata, { headers: { "Cache-Control": "no-store" } });
		// Download only: never embed active original PDF contents in the app.
		return new Response(new Uint8Array(saved.bytes), { headers: {
			"Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=\"attached.pdf\"",
			"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
		} });
	} catch { throw new CourseError("PDF not found.", 404); }
}
