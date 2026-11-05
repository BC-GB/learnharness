import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PATHS } from "../../config.ts";
import { courseStatePath } from "./course-context.ts";

const NAME = /^[a-f0-9]{64}\.(?:png|jpg)$/;
const MAX_STORED_BYTES = 1024 * 1024;
const MAX_LIBRARY_BYTES = 256 * 1024 * 1024;

function directory(): string { return courseStatePath(path.join(PATHS.data, "pasted-images")); }

/** Only immutable, generated, metadata-free raster files in this course.
 * Never a general permission to read state, source files or another course. */
export function pastedImagePath(raw: string): string | undefined {
	const root = directory();
	const file = path.resolve(raw);
	if (path.dirname(file) !== root || !NAME.test(path.basename(file))) return undefined;
	courseStatePath(file);
	if (fs.realpathSync(root) !== root || fs.lstatSync(root).isSymbolicLink()) throw new Error("Image storage is unavailable.");
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORED_BYTES) throw new Error("Invalid pasted image.");
	const bytes = fs.readFileSync(file);
	if (createHash("sha256").update(bytes).digest("hex") !== path.basename(file).split(".")[0]) throw new Error("Pasted image changed.");
	return file;
}

export function readPastedImage(name: string): { bytes: Buffer; mime: string } {
	if (!NAME.test(name)) throw new Error("Image not found.");
	const file = pastedImagePath(path.join(directory(), name));
	if (!file) throw new Error("Image not found.");
	return { bytes: fs.readFileSync(file), mime: name.endsWith(".png") ? "image/png" : "image/jpeg" };
}

export function storePastedImage(bytes: Uint8Array, mime: string): { path: string; name: string } {
	if (!["image/png", "image/jpeg"].includes(mime) || !bytes.length || bytes.length > MAX_STORED_BYTES) throw new Error("Invalid normalized image.");
	const root = directory();
	fs.mkdirSync(root, { recursive: true, mode: 0o700 });
	if (fs.realpathSync(root) !== root || fs.lstatSync(root).isSymbolicLink()) throw new Error("Image storage is unavailable.");
	const name = `${createHash("sha256").update(bytes).digest("hex")}.${mime === "image/png" ? "png" : "jpg"}`;
	const file = courseStatePath(path.join(root, name));
	if (fs.existsSync(file)) { pastedImagePath(file); return { path: file, name }; }
	// Synchronous quota check + exclusive write: concurrent requests cannot
	// overwrite files or race the quota after their asynchronous normalization.
	let total = 0; let count = 0;
	for (const entry of fs.readdirSync(root)) {
		const stat = fs.lstatSync(path.join(root, entry));
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid image storage entry.");
		total += stat.size; count++;
	}
	if (count >= 2000 || total + bytes.length > MAX_LIBRARY_BYTES) throw new Error("This course's pasted-image storage is full.");
	const fd = fs.openSync(file, "wx", 0o600);
	try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
	catch (error) { fs.unlinkSync(file); throw error; }
	finally { fs.closeSync(fd); }
	return { path: file, name };
}
