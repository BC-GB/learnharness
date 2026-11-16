import type { ModelImageResizeOptions } from "../image-processing/types.ts";
import { BROKER_REQUEST_MAX_BYTES } from "../broker-request-body.ts";

/** Prepare a PDF batch before serialization, leaving room for its instructions,
 * text and tool results. Otherwise several large PNGs can exhaust the shared
 * request-fitting deadline. Keep the existing fitter's JPEG/dimension floors. */
export function pdfPageResizeOptions(
 png: Buffer, pageCount: number, resize?: ModelImageResizeOptions,
): ModelImageResizeOptions {
 if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 6) throw new Error("Invalid PDF image batch.");
 const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
 const initialScale = Math.min(1, (resize?.maxWidth ?? 2000) / width, (resize?.maxHeight ?? 2000) / height);
 return {
  ...resize,
  maxBytes: Math.min(resize?.maxBytes ?? Infinity, Math.floor(BROKER_REQUEST_MAX_BYTES * 0.75 / pageCount)),
  minJpegQuality: Math.max(resize?.minJpegQuality ?? 0, 70),
  minScale: Math.max(resize?.minScale ?? 0, initialScale / 2),
 };
}
