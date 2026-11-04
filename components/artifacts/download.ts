/**
 * Artifact download helpers (release polish, 2026-10-07): the tiny
 * save-a-blob seam shared by the demo + figure cards, plus the filename
 * slug. The slug is pure; downloadFile rejects active-document exports.
 */

/** Slugify a demo title into a filename stem — lowercase, accents folded,
 *  runs of non-alphanumerics collapsed to "-", trimmed, capped at 64
 *  chars. Empty/fully-symbolic titles fall back to "demo". */
export function slugFilename(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "demo";
}

/** Hardened browser deployment: generated active documents must not be exported. */
export function downloadFile(_name: string, content: string | Uint8Array, mime: string): void {
	// Only bounded, signature-checked raster snapshots are exported. Generated
 // SVG/HTML/text documents keep the existing active-export denial.
 if (typeof content === "string" || content.byteLength > 1024 * 1024) throw new Error("Generated artifact downloads are disabled in this deployment.");
 const png = mime === "image/png" && content.length >= 8 && Array.from(content.slice(0, 8)).join(",") === "137,80,78,71,13,10,26,10";
 const jpeg = mime === "image/jpeg" && content.length >= 3 && content[0] === 255 && content[1] === 216 && content[2] === 255;
 if (!png && !jpeg) throw new Error("Only validated PNG or JPEG snapshots can be downloaded.");
 const url = URL.createObjectURL(new Blob([new Uint8Array(content)], { type: mime }));
 try {
  const a = document.createElement("a");
  a.href = url;
  const stem = _name.replace(/[\\/\x00-\x1f]/g, "_").replace(/\.[^.]*$/, "") || "image";
  a.download = `${stem}.${png ? "png" : "jpg"}`;
  a.click();
 } finally { URL.revokeObjectURL(url); }
}
