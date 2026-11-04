import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadFile } from "../components/artifacts/download.ts";

test("downloads cannot export executable documents or oversized/mislabeled images", () => {
	for (const [content, mime] of [["<script>alert(1)</script>", "text/html"], ["<svg/>", "image/svg+xml"], [new Uint8Array([60, 115, 99, 114]), "image/png"], [new Uint8Array(1024 * 1024 + 1), "image/png"]] as const) {
		assert.throws(() => downloadFile("payload.html", content, mime));
	}
});

test("raster downloads force an image extension and revoke their blob URL", (t) => {
	const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const anchor = { href: "", download: "", click() {} };
	const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
	Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => anchor } });
	const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
	t.mock.method(URL, "createObjectURL", () => "blob:synthetic");
	try {
		downloadFile("../../payload.html", bytes, "image/png");
		assert.match(anchor.download, /\.png$/);
		assert.doesNotMatch(anchor.download, /[\\/]/);
		assert.equal(revoke.mock.callCount(), 1);
	} finally {
		if (previous) Object.defineProperty(globalThis, "document", previous);
		else Reflect.deleteProperty(globalThis, "document");
	}
});
