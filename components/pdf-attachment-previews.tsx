"use client";

export function PdfAttachmentPreviews({ pdfs, remove }: {
	pdfs: { name: string; start: number; end: number; details?: { filename: string; pages: number } }[];
	remove(start: number, end: number): void;
}) {
	if (!pdfs.length) return null;
	return <div className="flex w-full flex-wrap gap-2 px-2 pt-1" data-testid="pdf-attachment-previews">
		{pdfs.map(pdf => <div key={pdf.start} className="flex max-w-full items-center gap-3 rounded border bg-muted/50 px-3 py-2 text-sm">
			<div className="min-w-0"><div className="break-all font-medium">{pdf.details?.filename ?? "Attached PDF"}</div>
				<div className="text-xs text-muted-foreground">{pdf.details ? `${pdf.details.pages} ${pdf.details.pages === 1 ? "page" : "pages"} · PDF` : "PDF"}</div></div>
			<button type="button" aria-label="Remove attached PDF" onClick={() => remove(pdf.start, pdf.end)} className="shrink-0 rounded px-1.5 text-base hover:bg-accent">×</button>
		</div>)}
	</div>;
}
