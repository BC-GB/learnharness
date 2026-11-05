"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseFilePaths } from "@/src/core";
import { courseFetch as fetch, courseUrlForId, documentCourse } from "@/lib/course-client";
import { useCourse } from "@/components/course-navigation";
import { INSERT_FILE_PATHS_EVENT } from "@/components/path-input";

export function usePastedImages(editor: React.RefObject<HTMLDivElement | null>, value: string, onChange: (value: string) => void) {
	const { id: course } = useCourse();
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");
	const pending = useRef<AbortController | null>(null);
	useEffect(() => () => { pending.current?.abort(); }, [course]);
	const images = parseFilePaths(value).flatMap(part => {
		if (part.kind !== "path") return [];
		const name = /(?:^|[/\\])pasted-images[/\\]([a-f0-9]{64}\.(?:png|jpg))$/.exec(part.path)?.[1];
		return name ? [{ ...part, name, url: courseUrlForId(`/api/pasted-images?name=${name}`, course) }] : [];
	});
	const paste = useCallback(async (files: File[]) => {
		if (pending.current) return;
		if (files.length + images.length > 4) { setError("Attach up to four images per message."); return; }
		if (files.some(file => !/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(file.type) || !file.size || file.size > 25 * 1024 * 1024)) {
			setError("Use PNG, JPEG, GIF, WebP or BMP images under 25 MiB."); return;
		}
		const target = editor.current;
		const location = window.location.href;
		const controller = new AbortController(); pending.current = controller;
		setUploading(true); setError("");
		try {
			for (const file of files) {
				const response = await fetch(courseUrlForId("/api/pasted-images", course), { method: "POST", body: file, signal: controller.signal });
				const result = await response.json();
				if (!response.ok) throw new Error(result.error ?? "Could not attach image.");
				if (controller.signal.aborted || documentCourse() !== course || window.location.href !== location || !target?.isConnected || editor.current !== target) return;
				// The existing path chip/send/read workflow stays intact. Uploading
				// alone never sends a chat message or calls a model.
				target.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: [result.path] }));
			}
		} catch (error) {
			if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not attach image.");
		} finally {
			if (pending.current === controller) { pending.current = null; setUploading(false); }
		}
	}, [course, editor, images.length]);
	return { images, uploading, error, paste,
		remove: (start: number, end: number) => onChange(value.slice(0, start) + value.slice(end)),
	};
}
