import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import { verifiedArchivedSourceFiles } from "./helpers/archived-source-fixture.ts";

function fixture(run: (root: string, manifest: string, entry: { path: string; sha256: string }) => void) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-archive-inventory-"));
	const previous = process.env.LEARNHARNESS_TEST_TRACKED_FILES;
	try {
		const manifest = path.join(root, "inventory.json");
		const entry = { path: "source.ts", sha256: createHash("sha256").update("exact source").digest("hex") };
		fs.writeFileSync(path.join(root, entry.path), "exact source");
		fs.writeFileSync(manifest, JSON.stringify([entry]));
		process.env.LEARNHARNESS_TEST_TRACKED_FILES = manifest;
		run(root, manifest, entry);
	} finally {
		if (previous === undefined) delete process.env.LEARNHARNESS_TEST_TRACKED_FILES;
		else process.env.LEARNHARNESS_TEST_TRACKED_FILES = previous;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

it("uses only verified selected archive files and preserves the normal Git fallback", () => fixture(root => {
	assert.deepEqual(verifiedArchivedSourceFiles(root), ["source.ts"]);
	assert.deepEqual(verifiedArchivedSourceFiles(root, name => name.startsWith("other/")), []);
	delete process.env.LEARNHARNESS_TEST_TRACKED_FILES;
	assert.equal(verifiedArchivedSourceFiles(root), undefined);
}));

it("refuses changed bytes instead of allowing an invented tracked-source result", () => fixture(root => {
	fs.writeFileSync(path.join(root, "source.ts"), "different source");
	assert.throws(() => verifiedArchivedSourceFiles(root), /source\.ts/);
}));

it("rejects empty, duplicate, ambiguous and traversal inventory paths", () => fixture((root, manifest, entry) => {
	for (const value of [[], [entry, entry], [{ ...entry, path: "../outside" }], [{ ...entry, path: "./source.ts" }], [{ ...entry, path: "C:/outside" }], [{ ...entry, sha256: "wrong" }]]) {
		fs.writeFileSync(manifest, JSON.stringify(value));
		assert.throws(() => verifiedArchivedSourceFiles(root));
	}
}));

it("rejects a symlink substituted for archived source", () => fixture(root => {
	fs.renameSync(path.join(root, "source.ts"), path.join(root, "original.ts"));
	fs.symlinkSync(path.join(root, "original.ts"), path.join(root, "source.ts"));
	assert.throws(() => verifiedArchivedSourceFiles(root), /source\.ts/);
}));
