import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createSmokeServerRequest } from "../scripts/smoke-server-request.mjs";
import { verifyPluginServer } from "../scripts/smoke-plugin-runtime.mjs";
import { verifyCorePlugins } from "../scripts/smoke-core-plugins.mjs";

const origin = "http://127.0.0.1:32123";
const headers = { "x-learnharness-desktop": "synthetic-test-capability" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("smoke requests bind capability to the exact loopback origin and refuse redirects", async (t) => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
		calls++;
		assert.equal(url.origin, origin);
		assert.equal(new Headers(options.headers).get("x-learnharness-desktop"), headers["x-learnharness-desktop"]);
		assert.equal(new Headers(options.headers).get("content-type"), "application/json");
		assert.equal(options.redirect, "error");
		return json({});
	});
	const request = createSmokeServerRequest(origin, headers);
	await request("/api/plugins", { headers: { "content-type": "application/json" }, redirect: "follow" });
	for (const route of ["http://127.0.0.1:32124/v1", "https://example.com/", "//example.com/", "http://user@127.0.0.1:32123/api"]) assert.throws(() => request(route), /escaped/);
	for (const url of ["https://127.0.0.1:32123", "http://localhost:32123", "http://127.0.0.1", origin + "/api", origin + "?x=1"]) assert.throws(() => createSmokeServerRequest(url, headers), /loopback/);
	assert.equal(calls, 1);
});

test("community smoke checks denial and detects activation, asset exposure and data changes", async (t) => {
	for (const defect of ["none", "activation", "asset", "mutation", "unauthorized", "wrong-policy", "state-mutation"]) {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-denial-test-"));
		const directory = path.join(home, "data", "plugins", "native-smoke", "data");
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(path.join(directory, "private.json"), "preserve");
		let listings = 0;
		const mock = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
			assert.equal(url.origin, origin);
			assert.equal(new Headers(options.headers).get("x-learnharness-desktop"), headers["x-learnharness-desktop"]);
			assert.equal(options.redirect, "error");
			if (defect === "unauthorized") return json({ error: "Unauthorized" }, 403);
			if (url.pathname === "/api/plugins") {
				listings++;
				if (defect === "state-mutation" && listings === 2) fs.writeFileSync(path.join(home, "data", "plugins-state.json"), "changed");
				if (defect === "mutation" && listings === 2) fs.writeFileSync(path.join(directory, "private.json"), "changed");
				return json({ plugins: [{ id: "native-smoke", origin: "community", enabled: false, status: "error", error: "Community executable plugins are unsupported in this hardened deployment; source review is required." }] });
			}
			if (url.pathname.endsWith("/native-smoke")) return json({ error: defect === "wrong-policy" ? "unrelated failure" : "Community executable plugins require source review" }, defect === "activation" ? 200 : 409);
			if (url.pathname.endsWith("/call")) return json({ error: "Plugin is disabled or unavailable" }, 409);
			return json({ error: "Plugin assets are disabled or unavailable" }, defect === "asset" ? 200 : 409);
		});
		try {
			if (defect === "none") await verifyPluginServer(origin, home, headers);
			else await assert.rejects(verifyPluginServer(origin, home, headers));
		} finally { mock.mock.restore(); fs.rmSync(home, { recursive: true, force: true }); }
	}
});

test("core smoke authenticates list, toggles, refresh and asset requests while preserving storage checks", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-core-smoke-test-"));
	const dataDirectory = path.join(root, "data"), code = path.join(root, "core-plugins", "one");
	fs.mkdirSync(code, { recursive: true }); fs.mkdirSync(dataDirectory);
	fs.writeFileSync(path.join(root, "core-plugins.json"), JSON.stringify(["one"]));
	fs.writeFileSync(path.join(code, "main.js"), "core fixture");
	let enabled = false;
	const methods = new Set<string>();
	t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
		assert.equal(url.origin, origin);
		assert.equal(new Headers(options.headers).get("x-learnharness-desktop"), headers["x-learnharness-desktop"]);
		assert.equal(options.redirect, "error");
		methods.add(options.method ?? "GET");
		if (url.pathname.includes("/assets/")) return new Response(url.pathname.endsWith("main.js") ? "core fixture" : "private", { status: url.pathname.endsWith("main.js") ? 200 : 404 });
		if (options.method === "PUT") {
			enabled = JSON.parse(String(options.body)).enabled;
			if (enabled) fs.mkdirSync(path.join(dataDirectory, "core-plugin-data", "one"), { recursive: true });
		}
		return json({ plugins: [{ id: "one", origin: "core", enabled, status: enabled ? "active" : "disabled", manifest: { main: "main.js" } }], conflicts: [{ id: "one", error: "reserved" }] });
	});
	try {
		await verifyCorePlugins({ root, standalone: root, dataDirectory, url: origin, headers });
		assert.deepEqual([...methods].sort(), ["GET", "POST", "PUT"]);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
});
