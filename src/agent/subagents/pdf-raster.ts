import { isolatedRender } from "./render-client.ts";

export interface PdfRaster { page: number; png: string; dpi?: number }
type PdfRasterRequest = { op: "render"; pdf: string; pages: number[]; dpi: number };
type RequestRaster = (request: PdfRasterRequest) => Promise<PdfRaster[]>;

/** One page per existing worker deadline/output budget. Large scan page boxes
 * can exceed the canvas ceiling even at ordinary DPI; retry only rendering
 * failures, at bounded lower resolutions the same worker already accepts. */
export async function renderPdfRasters(
 pdf: string, pages: readonly number[], dpi = 120,
 request?: RequestRaster, signal?: AbortSignal,
): Promise<PdfRaster[]> {
 signal?.throwIfAborted();
 if (!pages.length || pages.length > 8 || pages.some(page => !Number.isInteger(page) || page < 1 || page > 200)) throw new Error("Invalid PDF page selection.");
 if (!Number.isFinite(dpi) || dpi < 36 || dpi > 200) throw new Error("Invalid PDF render DPI.");
 const resolutions = [...new Set([dpi, Math.min(dpi, 72), 36])];
 const dispatch = request ?? (payload => isolatedRender<PdfRaster[]>(payload, { signal }));
 const result: PdfRaster[] = [];
 for (const page of pages) {
  for (let attempt = 0; attempt < resolutions.length; attempt++) {
   signal?.throwIfAborted();
   let rendered: PdfRaster[];
   try { rendered = await dispatch({ op: "render", pdf, pages: [page], dpi: resolutions[attempt]! }); }
   catch (error) {
    signal?.throwIfAborted();
    const retryable = error instanceof Error && (error.message === "Isolated rendering failed." || error.message === "Isolated renderer timed out.");
    if (!retryable || attempt === resolutions.length - 1) throw error;
    continue;
   }
   signal?.throwIfAborted();
   if (!Array.isArray(rendered) || rendered.length !== 1 || rendered[0]?.page !== page || typeof rendered[0].png !== "string" || !rendered[0].png.length) throw new Error("Invalid renderer response.");
   result.push({ ...rendered[0], dpi: resolutions[attempt]! }); break;
  }
 }
 return result;
}
