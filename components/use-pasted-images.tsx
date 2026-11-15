"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseFilePaths } from "@/src/core";
import { courseFetch as fetch, courseUrlForId, documentCourse } from "@/lib/course-client";
import { useCourse } from "@/components/course-navigation";
import { INSERT_FILE_PATHS_EVENT } from "@/components/path-input";

import { ATTACH_BROWSER_FILES_EVENT } from "@/lib/browser-file-attachments";
type PdfDetails = { filename: string; pages: number };

export function usePastedImages(editor: React.RefObject<HTMLDivElement | null>, value: string, onChange: (value: string) => void, enabled = true) {
	const { id: course } = useCourse();
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");
	const pending = useRef<AbortController | null>(null);
	const [pdfDetails, setPdfDetails] = useState<Record<string, PdfDetails>>({});
	useEffect(() => () => { pending.current?.abort(); }, [course]);
	const images = parseFilePaths(value).flatMap(part => {
		if (part.kind !== "path") return [];
		const name = /(?:^|[/\\])pasted-images[/\\]([a-f0-9]{64}\.(?:png|jpg))$/.exec(part.path)?.[1];
		return name ? [{ ...part, name, url: courseUrlForId(`/api/pasted-images?name=${name}`, course) }] : [];
	});
	const pdfs = parseFilePaths(value).flatMap(part => {
		if (part.kind !== "path") return [];
		const name = /(?:^|[/\\])chat-pdfs[/\\]([a-f0-9]{64}\.pdf)$/.exec(part.path)?.[1];
		return name ? [{ ...part, name, details: pdfDetails[`${course}/${name}`] }] : [];
	});
	const pdfKey = pdfs.map(pdf => pdf.name).join(",");
	useEffect(() => {
		const controller = new AbortController();
		for (const name of pdfKey.split(",").filter(Boolean)) {
			void fetch(courseUrlForId(`/api/chat-pdfs?name=${name}&metadata=1`, course), { signal: controller.signal, cache: "no-store" }).then(async response => {
				if (!response.ok) return;
				const result = await response.json();
				if (!controller.signal.aborted && documentCourse() === course && typeof result.filename === "string" && Number.isSafeInteger(result.pages) && result.pages >= 1 && result.pages <= 200)
					setPdfDetails(previous => ({ ...previous, [`${course}/${name}`]: { filename: result.filename, pages: result.pages } }));
			}).catch(() => undefined);
		}
		return () => controller.abort();
	}, [course, pdfKey]);
	const paste = useCallback(async (files: File[]) => {
		if (!enabled || pending.current || files.length === 0) return;
		const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
		const pdfCount = files.filter(isPdf).length;
		if (pdfCount + pdfs.length > 4) { setError("Attach up to four PDFs per message."); return; }
		if (files.length - pdfCount + images.length > 4) { setError("Attach up to four images per message."); return; }
		if (files.some(file => !file.size || (isPdf(file) ? file.size > 20 * 1024 * 1024 : !/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(file.type) || file.size > 25 * 1024 * 1024))) {
			setError("Use PDFs up to 20 MB, or PNG, JPEG, GIF, WebP or BMP images under 25 MiB."); return;
		}
		const target = editor.current;
		const location = window.location.href;
		const controller = new AbortController(); pending.current = controller;
		setUploading(true); setError("");
		try {
			for (const file of files) {
				controller.signal.throwIfAborted();
				const pdf = isPdf(file);
				const endpoint = pdf ? `/api/chat-pdfs?filename=${encodeURIComponent(file.name)}` : "/api/pasted-images";
				const response = await fetch(courseUrlForId(endpoint, course), { method: "POST", body: file, signal: controller.signal });
				const result = await response.json();
				if (!response.ok) throw new Error(result.error ?? "Could not attach file.");
				if (controller.signal.aborted || documentCourse() !== course || window.location.href !== location || !target?.isConnected || editor.current !== target) return;
				// The existing path chip/send/read workflow stays intact. Uploading
				// alone never sends a chat message or calls a model.
				target.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: [result.path] }));
				if (pdf) setPdfDetails(previous => ({ ...previous, [`${course}/${result.name}`]: { filename: result.filename, pages: result.pages } }));
			}
		} catch (error) {
			if (!controller.signal.aborted && documentCourse() === course && window.location.href === location) setError(error instanceof Error ? error.message : "Could not attach file.");
		} finally {
			if (pending.current === controller) { pending.current = null; setUploading(false); }
		}
	}, [course, editor, images.length, pdfs.length, enabled]);
	useEffect(() => {
		const target = editor.current;
		if (!target || !enabled) return;
		const attach = (event: Event) => { void paste((event as CustomEvent<File[]>).detail); };
		target.dataset.browserFileAttachments = "";
		target.addEventListener(ATTACH_BROWSER_FILES_EVENT, attach);
		return () => { delete target.dataset.browserFileAttachments; target.removeEventListener(ATTACH_BROWSER_FILES_EVENT, attach); };
	}, [editor, paste, enabled]);
	return { images, pdfs, uploading, error, paste,
		remove: (start: number, end: number) => onChange(value.slice(0, start) + value.slice(end)),
	};
}
