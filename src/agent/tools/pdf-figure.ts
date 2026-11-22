import { renderOpenPdfPage, type PdfCrop } from "../subagents/headless.ts";
import { approvedPdfBytes, type PdfInfo } from "../subagents/pdf-ops.ts";
import { isolatedRender } from "../subagents/render-client.ts";
import { resolvePdfPath } from "./pdf-path.ts";
import { learnerImageFromBytes, type LearnerImage } from "./learner-image.ts";

/** Pages and crops render at about this long side; storage caps at 1600 too. */
const FIGURE_LONG_SIDE = 1600;
/** A small crop stops gaining detail here instead of upscaling further. */
const MAX_FIGURE_DPI = 200;
export const MIN_CROP_SIDE = 16;

/** A page or crop of the learner's PDF, stored like any learner image. */
export interface PdfFigureImage extends LearnerImage {
	page: number;
	/** Absent for the whole page. */
	crop?: PdfCrop;
}

/** A box in the pixels of the page image the maker was shown. */
export interface CropBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One page of the learner's PDF, ready for the visual maker to crop. */
export interface PdfFigureSource {
	path: string;
	page: number;
	pageImage: PdfFigureImage;
	crop(box: CropBox, signal?: AbortSignal): Promise<PdfFigureImage>;
	/** Any page or crop image this source produced, by snapshot id. */
	imageFor(snapshotId: string): PdfFigureImage | undefined;
	/** Release the opened PDF, including its source bytes. */
	close(): Promise<void>;
}

async function openFigurePdf(rawPath: string, page: number, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const path = resolvePdfPath(rawPath);
	let pdf: string;
	try {
		pdf = await approvedPdfBytes(path, signal);
	} catch (error) {
		signal?.throwIfAborted();
		const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "no such file"
			: error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot open PDF ${path}: ${reason}`);
	}
	const info = await isolatedRender<Pick<PdfInfo, "page_count">>({ op: "info", pdf }, { signal });
	const pages = info.page_count;
	if (!Number.isInteger(pages) || pages < 1 || pages > 200) {
		throw new Error("Invalid renderer page count.");
	}
	if (!Number.isInteger(page) || page < 1 || page > pages) {
		throw new Error(`PDF ${path} has ${pages} page${pages === 1 ? "" : "s"}; page ${page} does not exist`);
	}
	return { path, pdf };
}

/** Dispatch-time gate: an unusable PDF or page fails the visual call. */
export async function checkPdfPage(rawPath: string, page: number, signal?: AbortSignal): Promise<string> {
	return (await openFigurePdf(rawPath, page, signal)).path;
}

/** Every crop reuses the same approved snapshot in the isolated renderer. */
export async function loadPdfFigureSource(rawPath: string, page: number, signal?: AbortSignal): Promise<PdfFigureSource> {
	const opened = await openFigurePdf(rawPath, page, signal);
	const path = opened.path;
	let pdf: string | undefined = opened.pdf;
	const made = new Map<string, PdfFigureImage>();
	const close = async () => { pdf = undefined; };
	const render = async (crop: PdfCrop | undefined, abort = signal): Promise<PdfFigureImage> => {
		if (pdf === undefined) throw new Error("PDF figure source is closed.");
		const png = await renderOpenPdfPage({ pdf, page }, { dpi: MAX_FIGURE_DPI, fitLongSide: FIGURE_LONG_SIDE, crop }, abort);
		abort?.throwIfAborted();
		if (pdf === undefined) throw new Error("PDF figure source is closed.");
		const image: PdfFigureImage = { ...(await learnerImageFromBytes(png, path, abort)), page, ...(crop ? { crop } : {}) };
		made.set(image.snapshotId, image);
		return image;
	};
	try {
		const pageImage = await render(undefined);
		return {
			path, page, pageImage, close,
			crop: (box, abort) => render(cropFraction(box, pageImage.width, pageImage.height), abort),
			imageFor: (snapshotId) => made.get(snapshotId),
		};
	} catch (error) {
		await close();
		throw error;
	}
}

/** Clamp a pixel box to the page and turn it into page fractions. */
export function cropFraction(box: CropBox, pageWidth: number, pageHeight: number): PdfCrop {
	if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) throw new Error("x, y, width and height must be numbers");
	const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
	const left = clamp(box.x, pageWidth);
	const top = clamp(box.y, pageHeight);
	const right = clamp(box.x + box.width, pageWidth);
	const bottom = clamp(box.y + box.height, pageHeight);
	if (right - left < MIN_CROP_SIDE || bottom - top < MIN_CROP_SIDE) {
		throw new Error(`the crop must cover at least ${MIN_CROP_SIDE}×${MIN_CROP_SIDE} px of the ${pageWidth}×${pageHeight} page`);
	}
	const round = (v: number) => Math.round(v * 10_000) / 10_000;
	const x = round(left / pageWidth);
	const y = round(top / pageHeight);
	return { x, y, width: Math.min(round(right / pageWidth), 1) - x, height: Math.min(round(bottom / pageHeight), 1) - y };
}
