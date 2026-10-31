import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopAPIAuthorized } from "../src/server/desktop-access.ts";
import { resolveSourcePath } from "../src/agent/tools/fs-shared.ts";
import { readBoundedFile } from "../src/agent/tools/bounded-file.ts";
import { compileSafePattern } from "../src/agent/tools/safe-pattern.ts";
import { publicIPv4, publicURL } from "../src/agent/tools/public-fetch.ts";

test("all launch modes fail closed without a capability", () => {
	for (const env of [{}, { LH_DESKTOP_SERVER: "0" }, { LH_DESKTOP_API_SECRET: "short" }])
		assert.equal(desktopAPIAuthorized(new Headers(), env), false);
	const secret = "a".repeat(64);
	assert.equal(desktopAPIAuthorized(new Headers({ "x-learnharness-desktop": secret }), { LH_DESKTOP_API_SECRET: secret }), true);
	assert.equal(desktopAPIAuthorized(new Headers({ "x-learnharness-desktop": "b".repeat(64) }), { LH_DESKTOP_API_SECRET: secret }), false);
});

test("source access is denied unless explicitly configured", () => {
	const previous = process.env.LH_SOURCE_ROOT;
	delete process.env.LH_SOURCE_ROOT;
	try { assert.throws(() => resolveSourcePath(os.homedir()), /explicitly configured/); }
	finally { if (previous !== undefined) process.env.LH_SOURCE_ROOT = previous; }
});

test("bounded reads reject oversized files, directories and links", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "bounded-input-"));
	try {
		const file = path.join(root, "text");
		await fs.writeFile(file, "12345");
		assert.equal((await readBoundedFile(file, 5)).toString(), "12345");
		await assert.rejects(readBoundedFile(file, 4), /size limit/);
		await assert.rejects(readBoundedFile(root, 5));
		if (process.platform !== "win32") {
			await fs.symlink(file, path.join(root, "link"));
			await assert.rejects(readBoundedFile(path.join(root, "link"), 5));
		}
		await assert.rejects(readBoundedFile(file, 5, AbortSignal.abort()));
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("dangerous regex syntax is rejected before matching", () => {
	for (const pattern of ["(a+)+$", "(a|aa)+$", "a*a*a*b", "(a)\\1", "a{1000000}"])
		assert.throws(() => compileSafePattern(pattern, false, false), /unsupported/);
	assert(compileSafePattern("^hello$", false, true).test("HELLO"));
	assert(compileSafePattern("(a+)+$", true, false).test("literal (a+)+$"));
});

test("non-public and ambiguous research destinations are rejected", () => {
	for (const address of ["127.0.0.1", "10.0.0.1", "172.31.2.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::ffff:127.0.0.1"])
		assert.equal(publicIPv4(address), false, address);
	assert(publicIPv4("8.8.8.8"));
	for (const url of ["http://example.com", "https://127.1", "https://2130706433", "https://0x7f000001", "https://[::1]", "https://example.com:444", "https://user:secret@example.com", "file:///etc/passwd", "https://localhost"])
		assert.throws(() => publicURL(url), url);
	assert.equal(publicURL("https://example.com/path").hostname, "example.com");
});
