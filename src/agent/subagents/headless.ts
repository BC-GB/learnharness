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
	/** PDF pages and generated demos execute only in the separate restricted worker. */
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
