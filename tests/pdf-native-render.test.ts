import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PDF_CANVAS_PIXELS, MAX_PDF_CANVAS_SIDE, pdfCanvasGeometry, realHeadless } from "../src/agent/subagents/headless.ts";
describe("PDF pre-allocation canvas geometry", () => {
	it("uses decimal 16 megapixels and an 8192-pixel side limit", () => {
		assert.equal(MAX_PDF_CANVAS_PIXELS, 16_000_000);
		assert.equal(MAX_PDF_CANVAS_SIDE, 8192);
	});

	it("preserves ordinary requested DPI, including fractional ceil dimensions and low DPI", () => {
		for (const dpi of [11, 72, 144, 150, 300]) {
			const geometry = pdfCanvasGeometry(595.28, 841.89, dpi);
			assert.deepEqual(geometry, {
				scale: dpi / 72,
				width: Math.ceil(595.28 * dpi / 72),
				height: Math.ceil(841.89 * dpi / 72),
			});
		}
	});

	it("bounds extreme aspect ratios, huge geometry, sides, and rounded pixel area without upscaling", () => {
		const cases: readonly (readonly [number, number, number])[] = [
			[1e12, 0.000001, 300],
			[0.000001, 1e12, 300],
			[1e308, 1e308, Number.MAX_VALUE],
			[8192.000001, 10, 72],
			[6100, 3900, 72], // ceil at the area-limited scale exceeds 16MP
			[4000.000001, 4000.000001, 72],
			[4000, 4000, 72], // exactly 16MP stays unchanged
		];
		for (const [width, height, dpi] of cases) {
			const result = pdfCanvasGeometry(width, height, dpi);
			assert.ok(result.scale > 0 && result.scale <= dpi / 72);
			assert.equal(result.width, Math.max(1, Math.ceil(width * result.scale)));
			assert.equal(result.height, Math.max(1, Math.ceil(height * result.scale)));
			assert.ok(result.width <= MAX_PDF_CANVAS_SIDE && result.height <= MAX_PDF_CANVAS_SIDE);
			assert.ok(result.width * result.height <= MAX_PDF_CANVAS_PIXELS);
		}
		assert.deepEqual(pdfCanvasGeometry(4000, 4000, 72), { scale: 1, width: 4000, height: 4000 });
	});

	it("uses rotated viewport dimensions symmetrically", () => {
		const normal = pdfCanvasGeometry(20000, 10000, 144);
		const rotated = pdfCanvasGeometry(10000, 20000, 144);
		assert.equal(rotated.scale, normal.scale);
		assert.equal(rotated.width, normal.height);
		assert.equal(rotated.height, normal.width);
	});

	it("rejects nonfinite or nonpositive dimensions and DPI cleanly", () => {
		for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
			assert.throws(() => pdfCanvasGeometry(invalid, 792, 72), /dimensions must be finite and positive/);
			assert.throws(() => pdfCanvasGeometry(612, invalid, 72), /dimensions must be finite and positive/);
			assert.throws(() => pdfCanvasGeometry(612, 792, invalid), /DPI must be finite and positive/);
		}
	});
});

it("PDF renderer refuses execution even when legacy flags request it", async () => {
 process.env.LH_DISABLE_PDF_RENDERING = "0";
 process.env.LH_DISABLE_PDF_PROCESSING = "0";
 await assert.rejects(realHeadless.renderPdfPages("missing.pdf", [1]), /PDF rasterization is disabled/);
});
