"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PlusIcon, FolderOpenIcon } from "lucide-react";
import { useCourse } from "./course-navigation";
import { courseFetch, courseUrlForId } from "@/lib/course-client";
import { isCourseId, type CourseInfo } from "@/src/core";

/** Navigation and material management only; never a model/tool call or a
 * prompt addition. A course switch reloads the document and all local views. */
export function CoursePicker() {
	const current = useCourse();
	const [courses, setCourses] = useState<CourseInfo[]>([]);
	const [mode, setMode] = useState<"add" | "materials" | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [files, setFiles] = useState<{ name: string; bytes: number }[]>([]);
	const [notice, setNotice] = useState("");
	const dialog = useRef<HTMLDialogElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const controller = new AbortController();
		void courseFetch("/api/courses", { signal: controller.signal, cache: "no-store" }).then(async response => {
			if (!response.ok) throw new Error("Could not load courses.");
			const data = await response.json();
			if (!Array.isArray(data.courses)) throw new Error("Could not load courses.");
			setCourses(data.courses.filter((course: CourseInfo) => isCourseId(course.id) && typeof course.name === "string"));
		}).catch(() => { if (!controller.signal.aborted) setError("Could not load courses. Reload to try again."); });
		return () => controller.abort();
	}, []);
	useEffect(() => {
		if (!mode) { if (dialog.current?.open) dialog.current.close(); return; }
		if (!dialog.current?.open) dialog.current?.showModal();
		setError(""); setNotice("");
		if (mode !== "materials") return;
		const controller = new AbortController();
		void courseFetch("/api/course-materials", { cache: "no-store", signal: controller.signal }).then(async response => {
			const data = await response.json();
			if (!response.ok) throw new Error(data.error ?? "Could not load materials.");
			setFiles(data.files);
		}).catch(error => { if (!controller.signal.aborted) setError(error.message); });
		return () => controller.abort();
	}, [mode]);
	async function create(event: FormEvent) {
		event.preventDefault(); if (busy) return;
		setBusy(true); setError("");
		try {
			const response = await courseFetch("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? "Could not add course.");
			window.location.assign(courseUrlForId("/", result.course.id));
		} catch (error) { setError(error instanceof Error ? error.message : "Could not add course."); setBusy(false); }
	}
	async function upload(event: FormEvent) {
		event.preventDefault(); if (busy || !picker.current?.files?.length) return;
		const body = new FormData();
		for (const file of picker.current.files) body.append("files", file);
		setBusy(true); setError(""); setNotice("");
		try {
			const response = await courseFetch("/api/course-materials", { method: "POST", body });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error ?? "Could not add materials.");
			const refreshed = await courseFetch("/api/course-materials", { cache: "no-store" });
			if (!refreshed.ok) throw new Error("Files were added, but the list could not refresh. Reopen Materials.");
			setFiles((await refreshed.json()).files);
			if (picker.current) picker.current.value = "";
			setNotice("Materials added to this course.");
		} catch (error) { setError(error instanceof Error ? error.message : "Could not add materials."); }
		finally { setBusy(false); }
	}
	const listed = courses.length ? courses : [{ ...current, createdAt: "" }];
	return <div className="px-4 pb-3" data-testid="course-picker">
		<label htmlFor="course-selection" className="mb-1 block text-xs text-muted-foreground">Course</label>
		<div className="flex gap-1">
			<select id="course-selection" aria-label="Course" value={current.id} className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-2 text-sm" onChange={event => { if (event.target.value !== current.id) window.location.assign(courseUrlForId("/", event.target.value)); }}>
				{listed.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
			</select>
			<button type="button" aria-label="Add course" title="Add course" className="rounded-md p-2 hover:bg-accent" onClick={() => { setName(""); setMode("add"); }}><PlusIcon className="size-4" /></button>
		</div>
		<button type="button" className="mt-1 flex items-center gap-2 rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode("materials")}><FolderOpenIcon className="size-3.5" />{current.readOnlyLibrary ? "Course materials" : "Add / view materials"}</button>
		{error && !mode && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
		<dialog ref={dialog} aria-labelledby="course-dialog-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => setMode(null)} className="fixed inset-0 m-auto max-h-[85dvh] w-[min(92vw,32rem)] overflow-y-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/60">
			<h2 id="course-dialog-title" className="mb-4 text-lg font-semibold">{mode === "add" ? "Add course" : `${current.name} materials`}</h2>
			{mode === "add" ? <form onSubmit={create}>
				<label htmlFor="new-course-name" className="mb-2 block text-sm">Course name</label>
				<input id="new-course-name" autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Corporate Finance" className="w-full rounded-md border bg-background px-3 py-2" disabled={busy} />
				<p className="mt-2 text-xs text-muted-foreground">Starts with separate materials, conversations and knowledge graph.</p>
				<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="rounded-md border px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Adding…" : "Add course"}</button></div>
			</form> : <>
				{!current.readOnlyLibrary && <form onSubmit={upload} className="mb-4 space-y-3"><label className="block text-sm">Choose this course’s files<input ref={picker} type="file" multiple className="mt-2 block w-full text-xs" accept=".pdf,.txt,.md,.csv,.json,.r,.rmd,.tex,.png,.jpg,.jpeg,.webp,.gif,.bmp" disabled={busy} /></label><button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Adding…" : "Add materials"}</button></form>}
				{files.length ? <ul aria-label="Course files" className="max-h-60 space-y-2 overflow-y-auto text-sm">{files.map(file => <li key={file.name} className="break-words rounded border px-3 py-2">{file.name}</li>)}</ul> : <p className="text-sm text-muted-foreground">No materials added yet.</p>}
				<p className="mt-3 text-xs text-muted-foreground">{current.readOnlyLibrary ? "Your existing material library is read-only." : "Files are available only in this course. PDF files: up to 20 MB each."}</p>
				<div className="mt-4 flex justify-end"><button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="rounded-md border px-3 py-2 text-sm">Close</button></div>
			</>}
			{error && mode && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
			{notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
		</dialog>
	</div>;
}
