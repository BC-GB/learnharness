import { constants } from "node:fs";
import fs from "node:fs/promises";
import { resolvePdfPath } from "../tools/pdf-path.ts";
import { isolatedRender, isolatedRendererEnabled } from "./render-client.ts";
import type { PdfPage } from "./pdf-markdown.ts";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
export interface PdfPageInfo {
	page: number;
	text_length: number;
	image_count: number;
	/** Fraction of math-flavored chars — the render-this-page signal (port
	 *  of the skill's unicode-range density heuristic). */
	math_density: number;
}

export interface PdfInfo {
	path: string;
	page_count: number;
	/** Mean chars/page — the size class the strategy branches on. */
	mean_text_length: number;
	pages: PdfPageInfo[];
}

export function standardFontsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";
}

export function parsePageSpec(spec: string, total: number): number[] {
	const trimmed = spec.trim().toLowerCase();
	if (trimmed === "all") return Array.from({ length: total }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of spec.split(",")) {
		const p = part.trim();
		if (!p) continue;
		if (p.includes("-")) {
			const [startRaw, endRaw] = p.split("-", 2) as [string, string];
			const start = Math.max(1, parseInt(startRaw, 10));
			const end = Math.min(total, parseInt(endRaw, 10));
			for (let pg = start; pg <= end; pg++) pages.add(pg);
		} else {
			const pg = parseInt(p, 10);
			if (pg >= 1 && pg <= total) pages.add(pg);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

/** pdf_extract: text of the requested pages, `--- Page N ---` headed. */
export interface PdfSearchHit {
	page: number;
	line: number;
	/** contextLines around the hit, `>>>` marking the hit line. */
	context: string;
}

export function renderDir(filePath: string): string {
	// FNV-1a short hash of the absolute path — stable per file, no deps.
	const abs = path.resolve(filePath);
	let h = 0x811c9dc5;
	for (let i = 0; i < abs.length; i++) {
		h ^= abs.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return path.join("/tmp", `lh-pdf-${h.toString(16).padStart(8, "0")}`);
}
const DISABLED = "PDF processing is disabled by deployment policy: an isolated parser is required.";
/** Read one approved, bounded snapshot for the isolated parser. */
export async function approvedPdfBytes(file: string, signal?: AbortSignal): Promise<string> {
	signal?.throwIfAborted();
	if (!isolatedRendererEnabled()) throw new Error(DISABLED);
	const safe = resolvePdfPath(file);
	const limit = 20 * 1024 * 1024;
	const initial = await fs.stat(safe);
	if (!initial.isFile() || initial.size > limit) throw new Error("PDF file limit");
	signal?.throwIfAborted();
	const handle = await fs.open(safe, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size > limit) throw new Error("PDF file limit");
		if (before.dev !== initial.dev || before.ino !== initial.ino) throw new Error("The PDF changed before it could be opened");
		signal?.throwIfAborted();
		const bytes = Buffer.alloc(before.size);
		for (let offset = 0; offset < bytes.length;) {
			const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), null);
			signal?.throwIfAborted();
			if (!bytesRead) throw new Error("The PDF changed while being read");
			offset += bytesRead;
		}
		const { bytesRead: extra } = await handle.read(Buffer.alloc(1), 0, 1, null);
		const after = await handle.stat();
		signal?.throwIfAborted();
		if (after.size > limit) throw new Error("PDF file limit");
		if (extra || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
			throw new Error("The PDF changed while being read");
		}
		if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF");
		return bytes.toString("base64");
	} finally {
		await handle.close();
	}
}

export async function pdfProbe(file:string):Promise<void>{await pdfInfo(file)}
export async function pdfInfo(file:string):Promise<PdfInfo>{const x=await isolatedRender<Omit<PdfInfo,'path'>>({op:'info',pdf:await approvedPdfBytes(file)});return {...x,path:file}}
export async function pdfExtract(file:string,pages:string):Promise<string>{return isolatedRender({op:'extract',pdf:await approvedPdfBytes(file),pages})}
export async function pdfSearch(file:string,query:string,opts?:{contextLines?:number;literal?:boolean}):Promise<{hits:PdfSearchHit[];pageTexts:Map<number,string>}>{
 const x=await isolatedRender<{hits:PdfSearchHit[];pageTexts:[number,string][]}>({op:'search',pdf:await approvedPdfBytes(file),query,contextLines:opts?.contextLines??3,literal:opts?.literal??false});return {...x,pageTexts:new Map(x.pageTexts)};
}
export type PdfConversion={kind:'converted';pages:PdfPage[]}|{kind:'too-long';pageCount:number}|{kind:'unreadable'};
export async function convertPdf(data: Uint8Array, maxPages: number, options?: { signal?: AbortSignal }): Promise<PdfConversion> {
 options?.signal?.throwIfAborted();
 if (!isolatedRendererEnabled()) throw Error(DISABLED);
 if (data.length > 20 * 1024 * 1024) throw Error("PDF input too large");
 if (!Number.isSafeInteger(maxPages) || maxPages <= 0) throw Error("Invalid PDF page limit");
 // New plugin callers share the existing isolated parser ceiling.
 return isolatedRender({ op: "convert", pdf: Buffer.from(data).toString("base64"), maxPages: Math.min(maxPages, 200) }, options);
}
