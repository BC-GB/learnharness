import { isolatedRender, isolatedRendererEnabled } from "./render-client.ts";
import { approvedPdfBytes } from "./pdf-ops.ts";
export interface DemoRunResult {
	/** console.error / console messages of type "error". */
	consoleErrors: string[];
	/** Uncaught exceptions (window.onerror / unhandled rejections). */
	pageErrors: string[];
	/** Network requests that failed (CDN scripts that didn't load, …). */
	failedRequests: string[];
	/** Value of the optional probe expression, when requested and successful. */
	probeResult?: unknown;
	/** True when nothing above recorded anything. */
	ok: boolean;
}

export interface RunDemoOptions {
	/** How long to let the page settle (animations, async CDN loads) — default 2s. */
	settleMs?: number;
	/** Optional JS expression evaluated in the page after settling; its value
	 * is returned to the builder so it can assert on internal state. */
	probe?: string;
}

export interface RenderSvgOptions {
	/** Viewport size — defaults to the SVG's width/height attrs, else 900×700. */
	width?: number;
	height?: number;
}

export interface RenderPdfOptions {
	/** Render DPI — 72 is 100% zoom; the skill's guidance is 100/150/200. */
	dpi?: number;
}

export interface RenderedPdfPage {
	page: number;
	png: Buffer;
}

export interface HeadlessApi {
	/** True when a browser helper or Chrome is resolvable (cheap, no launch). */
	available(): boolean;
	/** Why not — for error messages. */
	unavailableReason(): string | null;
	/** Execute HTML in a browser, capture errors, optionally probe. */
	runDemo(html: string, opts?: RunDemoOptions): Promise<DemoRunResult>;
	/** Rasterize an SVG to a PNG buffer (for verify-by-looking). */
	renderSvg(svg: string, opts?: RenderSvgOptions): Promise<Buffer>;
	/** Render PDF pages to PNGs natively (pdfjs + Skia) for the pdf-reader. */
	renderPdfPages(pdfPath: string, pages: number[], opts?: RenderPdfOptions): Promise<RenderedPdfPage[]>;
}

/** Test seam — undefined in production. */
export const headlessOverride: { current?: HeadlessApi } = {};

export function getHeadless(): HeadlessApi {
	return headlessOverride.current ?? realHeadless;
}

// ─── Chrome resolution ───────────────────────────────────────────────────────

export function parseBrowserServiceLine(line: string): number | null {
	const m = line.match(/^BROWSER_SERVICE_CDP (\d+)$/);
	if (!m) return null;
	const port = Number(m[1]);
	return port >= 1 && port <= 65535 ? port : null;
}

/** Spawn env sanitizer (pure; exported for tests): the helper must run as a
 *  FULL Electron app — ELECTRON_RUN_AS_NODE must not leak — and must not
 *  inherit the dev-shell userData redirect. */
export function browserServiceSpawnEnv(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = { ...env };
	delete out.ELECTRON_RUN_AS_NODE;
	delete out.LH_DEV_URL;
	// The artifact renderer is not an authorized app API client.
	delete out.LH_DESKTOP_API_SECRET;
	delete out.LH_DESKTOP_SERVER;
	return out;
}

function svgViewport(svg: string, opts: RenderSvgOptions): { width: number; height: number } {
	if (opts.width && opts.height) return { width: opts.width, height: opts.height };
	const width = Number(svg.match(/\bwidth\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	const height = Number(svg.match(/\bheight\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	return {
		width: Math.ceil(Number.isFinite(width) && width > 0 ? width : 900),
		height: Math.ceil(Number.isFinite(height) && height > 0 ? height : 700),
	};
}

/** Canonicalize a raw Chrome screenshot for the model's eyes (2026-09-19 fix).
 *
 *  WHY: Chrome writes PNGs with a SPLIT IDAT stream (4KB chunks) — and
 *  Alibaba's vision decoder (behind OpenRouter's qwen3.8-flash, the
 *  visual-maker's look-model) rejected those outright during the
 *  2026-09-18/19 window: "The image format is illegal and cannot be opened",
 *  deterministically, at every size (50–800px) — while every single-IDAT
 *  form passed (a handcrafted 1×1, and sharp re-encodes). On a later re-test
 *  raw Chrome PNGs passed too (the upstream decoder was fixed or is flaky
 *  per backend), but the canonical form stays: PNG spec says the IDAT chunks
 *  are an arbitrary SPLIT of one zlib stream, so merging them is the more
 *  standard shape, byte-identical stream, zero re-encoding.
 *
 *  Pure Node on purpose (no sharp): historically the process already carried
 *  a native image lib via @huggingface/transformers' nested sharp + libvips,
 *  and importing the root sharp (Next's optional dependency) put a SECOND
 *  libvips into the process — macOS's ObjC runtime warns (duplicate
 *  GNotificationCenterDelegate, "mysterious crashes"). The transformers
 *  embedder died with wave 6 (2026-09-23) but the rule lives on: one native
 *  image lib per process; app code carries none. */
export function providerSafePng(png: Buffer): Buffer {
	const SIG_LEN = 8;
	if (png.length < SIG_LEN + 12 || png.subarray(0, SIG_LEN).toString("hex") !== "89504e470d0a1a0a") return png;
	// Walk the chunks once, merging the IDAT split into its canonical
	// single-chunk form (first IDAT's position, concatenated payload).
	const parts: Array<{ type: string; data: Buffer }> = [];
	let off = SIG_LEN;
	while (off + 12 <= png.length) {
		const len = png.readUInt32BE(off);
		if (off + 12 + len > png.length) break; // truncated tail — leave as-is
		parts.push({ type: png.subarray(off + 4, off + 8).toString("ascii"), data: png.subarray(off + 8, off + 8 + len) });
		off += 12 + len;
	}
	const idats = parts.filter((p) => p.type === "IDAT");
	if (idats.length < 2) return png; // already canonical
	const merged = Buffer.concat(idats.map((p) => p.data));
	let emittedIdat = false;
	const out: Buffer[] = [png.subarray(0, SIG_LEN)];
	for (const p of parts) {
		if (p.type !== "IDAT") out.push(chunk(p.type, p.data));
		else if (!emittedIdat) {
			out.push(chunk("IDAT", merged));
			emittedIdat = true;
		}
	}
	return Buffer.concat(out);
}

/** One PNG chunk (length + type + data + CRC32) — the spec's exact layout. */
function chunk(type: string, data: Buffer): Buffer {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

/** CRC-32 (PNG's polynomial, table-less) for chunk checksums. */
function crc32(buf: Buffer): number {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

export const MAX_PDF_CANVAS_PIXELS = 16_000_000;
export const MAX_PDF_CANVAS_SIDE = 8192;

/** Plan the allocation from the scale-1 viewport (including PDF rotation).
 *  Keep ordinary DPI/ceil arithmetic unchanged; oversized pages lose scale,
 *  never gain it. Exported as a pure seam so extreme geometry needs no canvas. */
export function pdfCanvasGeometry(baseWidth: number, baseHeight: number, dpi: number): {
	scale: number;
	width: number;
	height: number;
} {
	if (![baseWidth, baseHeight].every((n) => Number.isFinite(n) && n > 0)) {
		throw new Error("PDF page dimensions must be finite and positive");
	}
	if (!Number.isFinite(dpi) || dpi <= 0 || dpi / 72 === 0) {
		throw new Error("PDF render DPI must be finite and positive");
	}
	// Limit sides first, so the area calculation cannot overflow even when
	// the unscaled page dimensions or requested DPI are enormous.
	let scale = Math.min(dpi / 72, MAX_PDF_CANVAS_SIDE / baseWidth, MAX_PDF_CANVAS_SIDE / baseHeight);
	const area = (baseWidth * scale) * (baseHeight * scale);
	if (area > MAX_PDF_CANVAS_PIXELS) scale *= Math.sqrt(MAX_PDF_CANVAS_PIXELS / area);
	const dimensions = (s: number) => ({
		width: Math.max(1, Math.ceil(baseWidth * s)),
		height: Math.max(1, Math.ceil(baseHeight * s)),
	});
	const fits = ({ width, height }: { width: number; height: number }) =>
		width <= MAX_PDF_CANVAS_SIDE && height <= MAX_PDF_CANVAS_SIDE && width * height <= MAX_PDF_CANVAS_PIXELS;
	// Ceil can put an otherwise bounded floating-point viewport over budget.
	// Find a safe scale rather than clipping the viewport or allocating first.
	if (!fits(dimensions(scale))) {
		let low = 0;
		let high = scale;
		for (let i = 0; i < 64; i++) {
			const mid = low + (high - low) / 2;
			if (fits(dimensions(mid))) low = mid;
			else high = mid;
		}
		scale = low;
	}
	if (scale <= 0 || baseWidth * scale === 0 || baseHeight * scale === 0) {
		throw new Error("PDF page dimensions cannot be rendered at a positive scale");
	}
	return { scale, ...dimensions(scale) };
}

/** Render PDF pages to PNGs — the sources-v0 pdf-reader's eyes.
 *
 *  History: pdfjs ALWAYS painted the pages (scale = dpi/72, the skill's
 *  zoom arithmetic) — first inside a headless Chrome tab (canvas shim,
 *  toDataURL, 2026-09-19), now into @napi-rs/canvas in this process (Wave
 *  E, 2026-10-10). The paint engine never changed; only the canvas host:
 *  Skia in-process via pdfjs-dist v6's own Node integration. No browser,
 *  no temp files, no base64 hop. */

const BROWSER_DISABLED_MESSAGE = "Browser execution is disabled by deployment policy.";
export function browserServiceBinary(): string | null { return null; }
export function resolveChromeExecutablePath(): string | null { return null; }
async function runDemo(html: string, opts: RunDemoOptions = {}): Promise<DemoRunResult> {
 if(!isolatedRendererEnabled())throw new Error(BROWSER_DISABLED_MESSAGE);
 return isolatedRender({op:"demo",html,...opts});
}
async function renderPdfPages(file: string, pages: number[], opts: RenderPdfOptions = {}): Promise<RenderedPdfPage[]> {
 if(!isolatedRendererEnabled())throw new Error("PDF rasterization is disabled: an isolated parser is required.");
 const result=await isolatedRender<{page:number;png:string}[]>({op:"render",pdf:await approvedPdfBytes(file),pages,...opts});return result.map(x=>({page:x.page,png:providerSafePng(Buffer.from(x.png,"base64"))}));
}
async function renderSvg(svg: string, opts: RenderSvgOptions = {}): Promise<Buffer> {
 if (Buffer.byteLength(svg) > 1024 * 1024) throw new Error("SVG input too large.");
 if (/(?:href\s*=|url\s*\(|<!ENTITY|<!DOCTYPE)/i.test(svg)) throw new Error("External or embedded SVG resources are unsupported.");
 const { width, height } = svgViewport(svg, opts);
 if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 4096) || width * height > 16000000) throw new Error("SVG dimensions exceed limits.");
 try {
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "white", font: { loadSystemFonts: true } });
  if (resvg.width > 4096 || resvg.height > 4096 || resvg.width * resvg.height > 16000000) throw new Error("SVG dimensions exceed limits.");
  return providerSafePng(resvg.render().asPng());
 } catch { throw new Error(BROWSER_DISABLED_MESSAGE + " SVG could not be rendered safely."); }
}
export const realHeadless: HeadlessApi = {
 available: isolatedRendererEnabled,
 unavailableReason: () => isolatedRendererEnabled()?null:BROWSER_DISABLED_MESSAGE,
 runDemo, renderSvg, renderPdfPages,
};
