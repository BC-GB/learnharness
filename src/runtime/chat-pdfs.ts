import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PATHS } from "../../config.ts";
import { courseStatePath } from "./course-context.ts";

export const MAX_CHAT_PDF_BYTES = 20 * 1024 * 1024;
const NAME = /^[a-f0-9]{64}\.pdf$/;
const MAX_LIBRARY_BYTES = 256 * 1024 * 1024;
export interface ChatPdfMetadata { name: string; filename: string; pages: number }

function directory(): string { return courseStatePath(path.join(PATHS.data, "chat-pdfs")); }
function checkedRoot(): string {
	const root = directory();
	if (fs.realpathSync(root) !== root || !fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error("PDF storage is unavailable.");
	return root;
}
export function pdfFilename(value: string): string {
	const name = value.split(/[/\\]/).pop()!.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 120);
	return name || "Attached PDF.pdf";
}
function regular(file: string, max: number): void {
	courseStatePath(file);
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > max) throw new Error("Invalid PDF storage entry.");
}

/** A capability for this course's immutable uploaded PDFs only. General
 * source/state readers retain their existing access boundary. */
export function chatPdfPath(raw: string): string | undefined {
	const file = path.resolve(raw);
	if (path.dirname(file) !== directory() || !NAME.test(path.basename(file))) return undefined;
	checkedRoot(); regular(file, MAX_CHAT_PDF_BYTES);
	const bytes = fs.readFileSync(file);
	if (createHash("sha256").update(bytes).digest("hex") !== path.basename(file).slice(0, 64) || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Attached PDF changed.");
	return file;
}
export function readChatPdf(name: string): { bytes: Buffer; metadata: ChatPdfMetadata; path: string } {
	if (!NAME.test(name)) throw new Error("PDF not found.");
	const file = chatPdfPath(path.join(directory(), name));
	if (!file) throw new Error("PDF not found.");
	const meta = file + ".json"; regular(meta, 2048);
	const metadata = JSON.parse(fs.readFileSync(meta, "utf8")) as ChatPdfMetadata;
	if (metadata.name !== name || typeof metadata.filename !== "string" || metadata.filename !== pdfFilename(metadata.filename)
		|| !Number.isSafeInteger(metadata.pages) || metadata.pages < 1 || metadata.pages > 200) throw new Error("Invalid PDF metadata.");
	return { bytes: fs.readFileSync(file), metadata, path: file };
}
export function storeChatPdf(bytes: Uint8Array, filename: string, pages: number): ChatPdfMetadata & { path: string } {
	if (!bytes.length || bytes.length > MAX_CHAT_PDF_BYTES || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
		|| !Number.isSafeInteger(pages) || pages < 1 || pages > 200) throw new Error("Invalid PDF.");
	fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
	const root = checkedRoot();
	const name = createHash("sha256").update(bytes).digest("hex") + ".pdf";
	const file = courseStatePath(path.join(root, name));
	if (fs.existsSync(file)) { const saved = readChatPdf(name); return { ...saved.metadata, path: saved.path }; }
	let total = 0; let count = 0;
	for (const entry of fs.readdirSync(root)) {
		if (!/^[a-f0-9]{64}\.pdf(?:\.json)?$/.test(entry)) throw new Error("Invalid PDF storage entry.");
		const candidate = path.join(root, entry); regular(candidate, entry.endsWith(".json") ? 2048 : MAX_CHAT_PDF_BYTES);
		total += fs.statSync(candidate).size; if (entry.endsWith(".pdf")) count++;
	}
	const metadata: ChatPdfMetadata = { name, filename: pdfFilename(filename), pages };
	const json = JSON.stringify(metadata);
	if (count >= 2000 || total + bytes.length + Buffer.byteLength(json) > MAX_LIBRARY_BYTES) throw new Error("This course's PDF attachment storage is full.");
	// Synchronous quota admission and exclusive writes cannot race another
	// upload. Metadata commits last; interrupted/incomplete entries fail closed.
	fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
	try { fs.writeFileSync(file + ".json", json, { flag: "wx", mode: 0o600 }); }
	catch (error) { fs.unlinkSync(file); throw error; }
	return { ...metadata, path: file };
}
