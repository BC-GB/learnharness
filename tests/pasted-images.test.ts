import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { runInCourse, type CourseScope } from "../src/runtime/course-context.ts";
import { pastedImagePath, readPastedImage, storePastedImage } from "../src/runtime/pasted-images.ts";
import { uploadPastedImage, pastedImageResponse } from "../src/server/pasted-images.ts";
import { loadLearnerImage } from "../src/agent/tools/learner-image.ts";
import { createReadTool } from "../src/agent/tools/read.ts";
import { resolveSourcePath } from "../src/agent/tools/fs-shared.ts";
import { CourseError } from "../src/store/courses.ts";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-pasted-images-")));
const scopes: CourseScope[] = ["a", "b"].map(id => {
	const dataRoot = path.join(root, id); const sourceRoot = path.join(root, `${id}-source`);
	fs.mkdirSync(dataRoot); fs.mkdirSync(sourceRoot);
	return { id: `pasted-image-test-${id}`, name: id, dataRoot, sourceRoot };
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
function png() { const canvas = createCanvas(64, 32); canvas.getContext("2d").fillRect(0, 0, 64, 32); return canvas.toBuffer("image/png"); }
function request(bytes: Uint8Array, extra: RequestInit = {}) { return new Request("http://localhost/api/pasted-images", { method: "POST", body: new Uint8Array(bytes), ...extra }); }

test("paste normalizes bytes, keeps the source library untouched, previews and reads through the normal image tool", async () => {
	await runInCourse(scopes[0]!, async () => {
		const response = await uploadPastedImage(request(png(), { headers: { "Content-Type": "text/html" } }));
		assert.equal(response.status, 201);
		const saved = await response.json();
		assert.match(saved.name, /^[a-f0-9]{64}\.(png|jpg)$/);
		assert.equal(pastedImagePath(saved.path), saved.path);
		assert.deepEqual(fs.readdirSync(scopes[0]!.sourceRoot!), []);
		const preview = pastedImageResponse(new Request(`http://localhost/api/pasted-images?name=${saved.name}`));
		assert.equal(preview.headers.get("content-type"), "image/png");
		assert.equal(preview.headers.get("cache-control"), "no-store");
		const image = await loadLearnerImage(saved.path);
		assert.equal(image.width, 64); assert.equal(image.height, 32);
		const read = await createReadTool({ input: ["text", "image"] }).execute("read-pasted", { path: saved.path });
		assert.ok(read.content.some(part => part.type === "image"), "The provider receives native image content, not only a filename");
		assert.throws(() => resolveSourcePath(saved.path), "No general filesystem permission was expanded");
		const duplicate = await (await uploadPastedImage(request(png()))).json();
		assert.equal(duplicate.path, saved.path); assert.equal(fs.readdirSync(path.dirname(saved.path)).length, 1);
		await runInCourse(scopes[1]!, async () => {
			assert.throws(() => readPastedImage(saved.name));
			assert.equal(pastedImagePath(saved.path), undefined);
			await assert.rejects(() => loadLearnerImage(saved.path));
			await assert.rejects(() => createReadTool().execute("foreign", { path: saved.path }));
		});
	});
});

test("arbitrary paths, active formats, MIME spoofing, bad geometry and oversized chunked bodies fail closed", async () => {
	await runInCourse(scopes[0]!, async () => {
		for (const text of ["<svg onload='alert(1)'/>", "<html>not an image</html>", "http://192.168.1.1/private"]) {
			await assert.rejects(() => uploadPastedImage(request(Buffer.from(text), { headers: { "Content-Type": "image/png" } })), CourseError);
		}
		await assert.rejects(() => uploadPastedImage(request(new Uint8Array())), CourseError);
		await assert.rejects(() => uploadPastedImage(request(png(), { headers: { "Content-Length": String(26 * 1024 * 1024) } })), error => error instanceof CourseError && error.status === 413);
		const huge = png(); huge.writeUInt32BE(9000, 16);
		await assert.rejects(() => uploadPastedImage(request(huge)), CourseError);
		const chunked = new Request("http://localhost/api/pasted-images", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(25 * 1024 * 1024 + 1)); c.close(); } }), duplex: "half" } as RequestInit);
		await assert.rejects(() => uploadPastedImage(chunked), error => error instanceof CourseError && error.status === 413);
		for (const name of ["../settings.json", "/etc/passwd", "x.svg", "", "a".repeat(64) + ".png"]) assert.throws(() => readPastedImage(name));
		assert.throws(() => pastedImageResponse(new Request("http://localhost/api/pasted-images?name=a&name=b")), CourseError);
		const aborted = new AbortController(); aborted.abort();
		await assert.rejects(() => uploadPastedImage(request(png(), { signal: aborted.signal })), CourseError);
	});
});

test("stored files are immutable, hash-checked and cannot alias state or outside files", () => {
	runInCourse(scopes[1]!, () => {
		const stored = storePastedImage(png(), "image/png");
		fs.writeFileSync(stored.path, "tampered");
		assert.throws(() => readPastedImage(stored.name), /changed/);
		assert.throws(() => storePastedImage(png(), "image/png"), /changed/);
		fs.unlinkSync(stored.path);
		if (process.platform !== "win32") {
			const outside = path.join(root, "private"); fs.writeFileSync(outside, "outside-secret");
			fs.symlinkSync(outside, stored.path);
			assert.throws(() => readPastedImage(stored.name)); fs.unlinkSync(stored.path);
			fs.rmdirSync(path.dirname(stored.path)); fs.symlinkSync(scopes[0]!.dataRoot, path.dirname(stored.path));
			assert.throws(() => storePastedImage(png(), "image/png"));
		}
		assert.throws(() => storePastedImage(png(), "image/svg+xml"));
		assert.throws(() => storePastedImage(new Uint8Array(1024 * 1024 + 1), "image/png"));
	});
});
