import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Test-only seam for an exact git-archive snapshot without Git/.git.
 * The external harness records every archived regular file and its SHA256.
 * Never synthesize a partial inventory or treat unavailable Git as a passing test.
 * Return undefined for normal checkouts, whose tests retain their real Git path.
 */
export function verifiedArchivedSourceFiles(root: string, include: (filename: string) => boolean = () => true): string[] | undefined {
	const manifest = process.env.LEARNHARNESS_TEST_TRACKED_FILES;
	if (!manifest) return undefined;
	const entries: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
	assert.ok(Array.isArray(entries) && entries.length > 0, "Expected complete archived source inventory");
	const seen = new Set<string>();
	const files: string[] = [];
	const sourceRoot = fs.realpathSync(root);
	for (const entry of entries) {
		assert.ok(entry && typeof entry.path === "string" && typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256));
		assert.ok(entry.path.length > 0 && !path.isAbsolute(entry.path) && !entry.path.includes("\\") && !entry.path.includes(":") && !entry.path.split("/").some((part: string) => !part || part === "." || part === "..") && !seen.has(entry.path));
		seen.add(entry.path);
		if (!include(entry.path)) continue;
		const filename = path.join(sourceRoot, entry.path);
		assert.ok(fs.lstatSync(filename).isFile() && fs.realpathSync(filename).startsWith(sourceRoot + path.sep), entry.path);
		assert.equal(createHash("sha256").update(fs.readFileSync(filename)).digest("hex"), entry.sha256, entry.path);
		files.push(entry.path);
	}
	return files;
}
