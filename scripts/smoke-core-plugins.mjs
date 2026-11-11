/** Actual packaged core loader/asset/storage gate. Call ONLY with the smoke's
 * disposable profile; no model calls, real learner data, or app installation. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createSmokeServerRequest } from "./smoke-server-request.mjs";
import { readCoreCatalog } from "./build-core-plugins.mjs";

function hashes(root) {
	const result = {};
	function walk(directory) {
		for (const name of fs.readdirSync(directory).sort()) {
			const file = path.join(directory, name), stat = fs.lstatSync(file);
			assert.equal(stat.isSymbolicLink(), false, file);
			if (stat.isDirectory()) walk(file);
			else result[path.relative(root, file)] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
		}
	}
	walk(root); return result;
}
const CODING_UNAVAILABLE = "Native code execution is unavailable in this hardened deployment. An isolated execution service is required.";

export async function verifyCorePlugins({ root, standalone, dataDirectory, url, headers = {} }) {
	const serverRequest = createSmokeServerRequest(url, headers);
	const ids = readCoreCatalog(root), code = path.join(standalone, "core-plugins"), before = hashes(code);
	const request = async (route, body, expected = 200, method = route === "/api/plugins" ? "POST" : "PUT") => {
		const response = await serverRequest(route, body === undefined ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
	};
	const initial = await request("/api/plugins");
	assert.deepEqual(initial.plugins.filter(p => p.origin === "core").map(p => p.id).sort(), [...ids].sort());
	for (const id of ids) {
		const info = initial.plugins.find(p => p.id === id);
		assert.equal(info.enabled, false, id);
		if (id === "coding-questions") {
			assert.equal(info.status, "error", JSON.stringify(info));
			assert.equal(info.error, `Plugin startup failed: ${CODING_UNAVAILABLE}`);
		} else assert.equal(info.status, "disabled", JSON.stringify(info));
		assert.equal(fs.existsSync(path.join(dataDirectory, "plugins", id)), false, "core code must not be installed into user data");
	}
	assert.equal(fs.existsSync(path.join(dataDirectory, "core-plugin-data")), false, "disabled fresh discovery creates no core records");
	if (ids.includes("coding-questions")) {
		const dataBefore = hashes(dataDirectory);
		const denied = await request("/api/plugins/coding-questions", { enabled: true }, 409);
		assert.equal(denied.error, CODING_UNAVAILABLE);
		const stopped = await request("/api/plugins/coding-questions/call", { operation: "proof" }, 409, "POST");
		assert.equal(stopped.error, "Plugin is disabled or unavailable");
		for (const asset of ["main.js", "backend.cjs"]) {
			const response = await serverRequest(`/api/plugins/coding-questions/assets/${asset}`);
			assert.equal(response.status, 409);
			assert.equal((await response.json()).error, "Plugin assets are disabled or unavailable");
		}
		const info = (await request("/api/plugins")).plugins.find(p => p.id === "coding-questions");
		assert.equal(info.enabled, false); assert.equal(info.status, "error");
		assert.equal(info.error, `Plugin startup failed: ${CODING_UNAVAILABLE}`);
		assert.equal(fs.existsSync(path.join(dataDirectory, "core-plugin-data", "coding-questions")), false);
		assert.deepEqual(hashes(dataDirectory), dataBefore, "Unavailable Coding Questions must not change profile data");
	}
	const available = ids.filter(id => id !== "coding-questions");
	const shadow = path.join(dataDirectory, "plugins", ids[0]);
	fs.mkdirSync(path.join(shadow, "dist"), { recursive: true });
	fs.writeFileSync(path.join(shadow, "dist", "manifest.json"), "{invalid shadow must never substitute for core}");
	const dataMarker = path.join(shadow, "data", "private.txt"); fs.mkdirSync(path.dirname(dataMarker)); fs.writeFileSync(dataMarker, "do not migrate or change");
	try {
		const refreshed = await request("/api/plugins", { action: "refresh" });
		assert.ok(refreshed.conflicts.some(conflict => conflict.id === ids[0] && /reserved/i.test(conflict.error)));
		for (const id of available) {
			const catalog = await request(`/api/plugins/${id}`, { enabled: true });
			const info = catalog.plugins.find(p => p.id === id); assert.equal(info.origin, "core"); assert.equal(info.status, "active", JSON.stringify(info));
			assert.ok(fs.statSync(path.join(dataDirectory, "core-plugin-data", id)).isDirectory());
			for (const entry of [info.manifest.main, info.manifest.styles].filter(Boolean)) {
				const response = await serverRequest(`/api/plugins/${id}/assets/${entry}`);
				const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(response.status, 200, `${id}/${entry}`);
				assert.deepEqual(bytes, fs.readFileSync(path.join(code, id, entry)));
			}
			for (const privateFile of ["backend.cjs", "data/private.txt"]) {
				const response = await serverRequest(`/api/plugins/${id}/assets/${privateFile}`); await response.text(); assert.equal(response.status, 404);
			}
		}
		assert.equal(fs.readFileSync(dataMarker, "utf8"), "do not migrate or change");
		for (const id of available) await request(`/api/plugins/${id}`, { enabled: false });
		assert.deepEqual(hashes(code), before, "core activation/settings/storage must not change app-owned code");
	} finally {
		for (const id of available) await request(`/api/plugins/${id}`, { enabled: false });
		fs.rmSync(shadow, { recursive: true }); await request("/api/plugins", { action: "refresh" });
	}
	console.log("[smoke-core-plugins] Coding Questions unavailable and denied; available core activation/assets/private-file refusal, separate data, reserved-ID collision and disable; code byte-identical");
}
