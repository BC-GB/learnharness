/** Run the same fake-input gate used for the traced standalone dependency graph. */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCompressionRuntime } from "../scripts/smoke-compression-runtime.mjs";

test("Next compression keeps drain listeners bounded through backpressure, payload delivery and disconnect", { timeout: 35_000 }, () => {
	const root = fileURLToPath(new URL("../", import.meta.url));
	// Sandboxed source snapshots may link their installed dependencies from a
	// pinned image. Probe that actual installation root; the runtime helper
	// still rejects any dependency escaping its payload, unchanged.
	const installedRoot = path.dirname(fs.realpathSync(path.join(root, "node_modules")));
	const report = verifyCompressionRuntime(installedRoot);
	assert.deepEqual(report.cases.map((item: { mode: string }) => item.mode), ["/node", "/web", "/identity", "/no-transform", "/abort"]);
});
