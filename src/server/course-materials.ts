import fs from "node:fs";
import path from "node:path";
import { currentCourse, courseStatePath } from "../runtime/course-context.ts";
import { CourseError } from "../store/courses.ts";

export const MAX_COURSE_UPLOAD = 26 * 1024 * 1024;
export async function boundedCourseBody(request: Request, limit: number): Promise<Uint8Array> {
	if (Number(request.headers.get("content-length")) > limit) throw new CourseError("Upload is too large.", 413);
	const reader = request.body?.getReader();
	if (!reader) throw new CourseError("Missing request body.");
	const chunks: Uint8Array[] = []; let length = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read(); if (done) break;
			length += value.byteLength;
			if (length > limit) throw new CourseError("Upload is too large.", 413);
			chunks.push(value);
		}
		const body = new Uint8Array(length); let at = 0;
		for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
		return body;
	} finally { void reader.cancel().catch(() => undefined); }
}

function library(): string {
	const scope = currentCourse();
	if (!scope?.sourceRoot) throw new CourseError("Course library is not configured.", 503);
	try {
		if (fs.realpathSync(scope.sourceRoot) !== path.resolve(scope.sourceRoot) || !fs.statSync(scope.sourceRoot).isDirectory()) throw new Error();
		return scope.sourceRoot;
	} catch { throw new CourseError("Course library is unavailable.", 503); }
}
export function courseMaterials(): { files: { name: string; bytes: number }[]; readOnly: boolean } {
	const root = library(); const files: { name: string; bytes: number }[] = [];
	const walk = (directory: string, depth: number) => {
		if (depth > 8 || files.length >= 2000) return;
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(file, depth + 1);
			else if (entry.isFile()) files.push({ name: path.relative(root, file).split(path.sep).join("/"), bytes: fs.statSync(file).size });
			if (files.length >= 2000) break;
		}
	};
	walk(root, 0);
	return { files: files.sort((a, b) => a.name.localeCompare(b.name)), readOnly: currentCourse()!.id === "legacy" };
}

export async function uploadCourseMaterials(request: Request): Promise<string[]> {
	if (currentCourse()?.id === "legacy") throw new CourseError("This course uses its existing read-only material library.", 403);
	const root = library();
	const body = await boundedCourseBody(request, MAX_COURSE_UPLOAD);
	let form;
	try { form = await new Response(new Uint8Array(body), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
	catch { throw new CourseError("Choose files to upload."); }
	const entries = form.getAll("files");
	if (!entries.length || entries.length > 25 || entries.some((file) => !(file instanceof File))) throw new CourseError("Choose between 1 and 25 files.");
	const prepared: { name: string; bytes: Uint8Array }[] = [];
	for (const file of entries as File[]) {
		if (!file.name || file.name.length > 160 || file.name.startsWith(".") || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(file.name) || /[. ]$/.test(file.name)) throw new CourseError("A filename is not supported. Rename it and try again.");
		const ext = path.extname(file.name).toLowerCase();
		if (![".pdf", ".txt", ".md", ".csv", ".json", ".r", ".rmd", ".tex", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) throw new CourseError("Upload PDF, text, CSV, R or image files. Convert Word or slides to PDF first.");
		const limit = ext === ".pdf" ? 20 * 1024 * 1024 : [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext) ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
		if (!file.size || file.size > limit) throw new CourseError("A file is empty or too large. Use smaller files.", 413);
		prepared.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
	}
	const written: string[] = [];
	try {
		// No await in this critical section: duplicate names never overwrite a
		// saved material, and a second request cannot interleave name selection.
		for (const item of prepared) {
			let name = item.name; let number = 2;
			while (fs.existsSync(path.join(root, name))) { const ext = path.extname(item.name); name = `${item.name.slice(0, -ext.length)} (${number++})${ext}`; }
			const target = courseStatePath(path.join(root, name));
			const fd = fs.openSync(target, "wx", 0o600);
			written.push(target);
			try { fs.writeFileSync(fd, item.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
		}
	} catch (error) { for (const file of written) fs.unlinkSync(file); throw error; }
	return written.map((file) => path.basename(file));
}
