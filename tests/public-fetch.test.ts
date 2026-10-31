import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

test("research transport pins DNS, rechecks redirects and bounds streamed bodies", async () => {
	const originalLookup = dns.lookup, originalRequest = https.request;
	let addresses = ["8.8.8.8"], calls = 0;
	let status = 200, headers: Record<string, string> = {}, chunks = [Buffer.from("ok")];
	dns.lookup = (async () => addresses.map(address => ({ address, family: 4 }))) as unknown as typeof dns.lookup;
	https.request = ((_url: URL, options: { lookup: (host: string, options: { all: boolean }, cb: (...args: unknown[]) => void) => void; agent: unknown }, callback: (res: Readable) => void) => {
		calls++;
		assert.equal(options.agent, false);
		options.lookup("ignored", { all: true }, (error, records) => {
			assert.equal(error, null);
			assert.deepEqual(records, [{ address: "8.8.8.8", family: 4 }]);
		});
		const req = new EventEmitter() as EventEmitter & { end: () => void };
		req.end = () => {
			const res = Object.assign(Readable.from(chunks), { statusCode: status, headers });
			callback(res);
		};
		return req;
	}) as unknown as typeof https.request;
	syncBuiltinESMExports();
	try {
		const { fetchPublic } = await import("../src/agent/tools/public-fetch.ts");
		assert.equal((await fetchPublic("https://example.com", 4)).bytes.toString(), "ok");
		assert.equal(calls, 1);
		addresses = ["8.8.8.8", "127.0.0.1"];
		await assert.rejects(fetchPublic("https://example.com", 4), /Non-public/);
		assert.equal(calls, 1, "mixed private DNS must never open a socket");
		addresses = ["8.8.8.8"];
		status = 302; headers = { location: "https://169.254.169.254/latest/meta-data" };
		await assert.rejects(fetchPublic("https://example.com", 4), /Non-public/);
		assert.equal(calls, 2, "redirect must be rejected before a second socket");
		status = 200; headers = {}; chunks = [Buffer.from("abc"), Buffer.from("def")];
		await assert.rejects(fetchPublic("https://example.com", 4), /too large/);
		headers = { "content-length": "2" };
		await assert.rejects(fetchPublic("https://example.com", 4), /too large/, "a lying Content-Length cannot bypass the stream cap");
		headers = { "content-encoding": "gzip" };
		await assert.rejects(fetchPublic("https://example.com", 4), /Unsupported/);
		status = 302; headers = { location: "/loop" };
		await assert.rejects(fetchPublic("https://example.com", 4), /redirects/);
	} finally {
		dns.lookup = originalLookup; https.request = originalRequest; syncBuiltinESMExports();
	}
});
