import { boundedCourseBody } from "./course-materials.ts";
import { CourseError } from "../store/courses.ts";
import { normalizeLearnerImageBytes } from "../agent/tools/learner-image.ts";
import { readPastedImage, storePastedImage } from "../runtime/pasted-images.ts";

let active = 0;
export async function uploadPastedImage(request: Request): Promise<Response> {
	if (active >= 2) throw new CourseError("Another image is uploading. Try again shortly.", 429);
	active++;
	try {
		const bytes = await boundedCourseBody(request, 25 * 1024 * 1024);
		// Client filenames, MIME claims and HTML are never trusted or fetched.
		const image = await normalizeLearnerImageBytes(bytes, request.signal);
		request.signal.throwIfAborted();
		const stored = storePastedImage(Buffer.from(image.data, "base64"), image.mimeType);
		return Response.json(stored, { status: 201, headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof CourseError) throw error;
		throw new CourseError("Could not attach this image. Use a valid PNG, JPEG, GIF, WebP or BMP under 25 MiB and 16 megapixels.");
	} finally { active--; }
}

export function pastedImageResponse(request: Request): Response {
	try {
		const names = new URL(request.url).searchParams.getAll("name");
		if (names.length !== 1) throw new Error();
		const image = readPastedImage(names[0]!);
		return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
	} catch { throw new CourseError("Image not found.", 404); }
}
