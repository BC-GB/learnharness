/**
 * The status-color law (theme wave, 2026-11-04): error / success / warning
 * chrome uses the theme tokens (text-error, bg-success/15, …) — never a
 * fixed Tailwind palette class, which would ignore the active theme.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { verifiedArchivedSourceFiles } from "./helpers/archived-source-fixture.ts";
import { describe, it } from "node:test";

describe("status colors are theme tokens", () => {
	it("no red/green/amber palette class is left under components/ or app/", () => {
		// Exact clean-source archives have neither Git nor an index. Verify
		// the supplied inventory's bytes before applying the same palette law.
		const root = path.resolve(import.meta.dirname, "..");
		const files = verifiedArchivedSourceFiles(root, file => file.startsWith("components/") || file.startsWith("app/"));
		if (files) {
			assert.ok(files.length > 0, "Missing archived application source");
			const matches: string[] = [];
			const palette = /\b(text|bg|border|fill|stroke|ring)-(red|green|amber)-[0-9]{3}/;
			for (const file of files) {
				fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).forEach((line, index) => {
					if (palette.test(line)) matches.push(`${file}:${index + 1}:${line}`);
				});
			}
			assert.equal(matches.join("\n"), "");
			return;
		}
		let out = "";
		try {
			out = execFileSync(
				"git",
				["grep", "--untracked", "-n", "-E", "\\b(text|bg|border|fill|stroke|ring)-(red|green|amber)-[0-9]{3}", "--", "components", "app"],
				{ cwd: new URL("..", import.meta.url), encoding: "utf8" },
			).trim();
		} catch (e) {
			// git grep exits 1 when nothing matches — the passing case.
			if ((e as { status?: number }).status !== 1) throw e;
		}
		assert.equal(out, "");
	});
});
