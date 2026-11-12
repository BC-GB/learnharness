import { detectSupportedImageMimeType } from "./image-processing/mime.mjs";
import { resizeImageInBoundedWorker } from "./image-processing/resize.ts";
import { checkImageDimensions } from "./tools/learner-image-dimensions.ts";

// This is the existing broker wire limit, not a configurable provider allowance.
export const BROKER_REQUEST_MAX_BYTES = 1024 * 1024;
const MAX_PREPARATION_BYTES = 32 * BROKER_REQUEST_MAX_BYTES;
const MAX_IMAGES = 64;
const MAX_IMAGE_BASE64_BYTES = 6 * BROKER_REQUEST_MAX_BYTES;
const PREPARATION_TIMEOUT_MS = 15_000;
const IMAGE_OVERHEAD_RESERVE = 384; // data URL prefix and a dimension note, including JSON quoting

export class BrokerRequestBodyError extends Error {
	constructor(message: string, readonly status: 400 | 413 = 413) { super(message); }
}

function tooLarge(): BrokerRequestBodyError {
	return new BrokerRequestBodyError("This conversation exceeds the 1 MiB request limit, even with reduced image copies. Start a new conversation with fewer images or less text. Your saved conversation and original images are unchanged.");
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface InlineImage {
	part: Record<string, unknown>;
	content: unknown[];
	data: string;
	mime: string;
}

/** Only provider image blocks are eligible. Never rewrite text, tool arguments,
 * external URLs or arbitrary nested JSON that merely resembles an image. */
function inlineImages(payload: Record<string, unknown>): InlineImage[] {
	const images: InlineImage[] = [];
	if (!Array.isArray(payload.input)) return images;
	for (const item of payload.input) {
		if (!record(item)) continue;
		const content = item.type === "function_call_output" ? item.output : item.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!record(part) || part.type !== "input_image" || typeof part.image_url !== "string") continue;
			if (!part.image_url.startsWith("data:")) continue;
			const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.image_url);
			if (!match || !match[2] || match[2].length % 4 !== 0 || match[2].length > MAX_IMAGE_BASE64_BYTES) {
				throw new BrokerRequestBodyError("An image in this conversation cannot be prepared for the request limit. Use a smaller valid PNG, JPEG, GIF or WebP image. Your original image is unchanged.", 400);
			}
			images.push({ part, content, mime: match[1]!, data: match[2]! });
			if (images.length > MAX_IMAGES) throw tooLarge();
		}
	}
	return images;
}

/** Fit private model-facing copies AFTER SDK serialization. The caller's body,
 * native messages, stored history and original files are never mutated. */
export async function prepareBrokerRequestBody(serialized: string, signal?: AbortSignal | null): Promise<Buffer> {
	signal?.throwIfAborted();
	const size = Buffer.byteLength(serialized, "utf8");
	if (size > MAX_PREPARATION_BYTES) throw tooLarge();
	let payload: unknown;
	try { payload = JSON.parse(serialized); }
	catch { throw new BrokerRequestBodyError("The model request is not valid JSON. No request was sent.", 400); }
	if (!record(payload)) throw new BrokerRequestBodyError("The model request must be a JSON object. No request was sent.", 400);
	if (size <= BROKER_REQUEST_MAX_BYTES) return Buffer.from(serialized);
	const images = inlineImages(payload);
	if (!images.length) throw tooLarge();
	let remainingImageBytes = images.reduce((sum, image) => sum + image.data.length, 0);
	for (const image of images) image.part.image_url = "";
	const fixedBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
	let available = BROKER_REQUEST_MAX_BYTES - fixedBytes - IMAGE_OVERHEAD_RESERVE * images.length;
	if (available <= 0) throw tooLarge();
	// One deadline covers all images, not fifteen seconds per image. Termination
	// is mandatory on cancellation/failure; there is no main-thread fallback.
	const deadline = new AbortController();
	const timeout = setTimeout(() => deadline.abort(new Error("Image preparation timed out")), PREPARATION_TIMEOUT_MS);
	const processingSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
	try {
		// Start with the largest copies and redistribute every unused byte. Small
		// already-minimal images must not be forced below an arbitrary equal share.
		for (const image of images.toSorted((a, b) => b.data.length - a.data.length)) {
			processingSignal.throwIfAborted();
			const maxBytes = Math.floor(available * image.data.length / remainingImageBytes);
			if (maxBytes < 4) throw tooLarge();
			const bytes = Buffer.from(image.data, "base64");
			if (bytes.toString("base64") !== image.data || detectSupportedImageMimeType(bytes) !== image.mime) {
				throw new BrokerRequestBodyError("An image in this conversation has invalid image data. Replace that image and try again. Your saved conversation and original images are unchanged.", 400);
			}
			try { checkImageDimensions(bytes, image.mime); }
			catch { throw new BrokerRequestBodyError("An image in this conversation is invalid or too large to process safely. Use an image under 16 megapixels and 8192 pixels per side. Your original image is unchanged.", 400); }
			const resized = await resizeImageInBoundedWorker(bytes, image.mime, {
				maxBytes, maxWidth: 8192, maxHeight: 8192,
				jpegQuality: 90, minJpegQuality: 70, minScale: 0.5,
			}, processingSignal);
			processingSignal.throwIfAborted();
			if (!resized) throw tooLarge();
			available -= resized.data.length;
			remainingImageBytes -= image.data.length;
			image.part.image_url = `data:${resized.mimeType};base64,${resized.data}`;
			if (resized.width !== resized.originalWidth || resized.height !== resized.originalHeight) {
				image.content.splice(image.content.indexOf(image.part), 0, {
					type: "input_text",
					text: `[Model-facing image copy resized from ${resized.originalWidth}x${resized.originalHeight} to ${resized.width}x${resized.height} to fit the request limit. Original image retained.]`,
				});
			}
		}
		signal?.throwIfAborted();
		const body = Buffer.from(JSON.stringify(payload));
		if (body.length > BROKER_REQUEST_MAX_BYTES) throw tooLarge();
		return body;
	} catch (error) {
		signal?.throwIfAborted();
		if (error instanceof BrokerRequestBodyError) throw error;
		throw new BrokerRequestBodyError("The images could not be prepared within the 1 MiB request limit. Image processing failed or timed out; no request was sent. Try fewer or smaller images. Your saved conversation and original images are unchanged.");
	} finally { clearTimeout(timeout); }
}
