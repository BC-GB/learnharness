/**
 * Verify the static SVG renderer from the standalone payload, without models,
 * credentials, server browser execution, or the installed app.
 * node scripts/smoke-demo-runtime.mjs --standalone <dir> --runtime <node binary>
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire, registerHooks } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @param {Record<string, string | undefined>} env @param {string} home @returns {Record<string, string | undefined>} */
export function probeEnv(env, home) {
	const clean = Object.fromEntries(Object.entries(env).filter(([key]) =>
		!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
		!/^(AWS_|GOOGLE_|GCLOUD_|CLOUDSDK_|AZURE_|ANTHROPIC_|OPENAI_|OPENROUTER_|GEMINI_)/.test(key) &&
		!["NODE_OPTIONS", "NODE_PATH", "LH_DEV_URL", "ELECTRON_RUN_AS_NODE"].includes(key)));
	return {
		...clean,
		HOME: home, USERPROFILE: home,
		APPDATA: path.join(home, "config"), LOCALAPPDATA: path.join(home, "local"),
		XDG_CONFIG_HOME: path.join(home, "config"), XDG_CACHE_HOME: path.join(home, "cache"),
		LH_DATA_DIR: path.join(home, "data"), LH_AUTH_FILE: path.join(home, "auth.json"),
		LH_IGNORE_ENV_KEYS: "1", NODE_ENV: "production",
	};
}

// Keep fetch's nested cause (including AggregateError socket failures), but
// never dump arbitrary error properties such as request headers or environment.
export function formatProbeError(error, depth = 0) {
	if (depth > 5) return "[cause chain truncated]";
	if (!error || typeof error !== "object") return String(error);
	const lines = [typeof error.stack === "string" ? error.stack : `${error.name ?? "Error"}: ${error.message ?? "unknown error"}`];
	for (const field of ["code", "errno", "syscall", "address", "port"]) {
		if (["string", "number"].includes(typeof error[field])) lines.push(`${field}: ${error[field]}`);
	}
	if (error.cause !== undefined) lines.push(`cause: ${formatProbeError(error.cause, depth + 1)}`);
	if (Array.isArray(error.errors)) {
		for (const nested of error.errors.slice(0, 8)) lines.push(`aggregate: ${formatProbeError(nested, depth + 1)}`);
	}
	return lines.join("\n");
}

export function verifyDemoRuntime(standalone, runtime = process.execPath, browser = false) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-demo-runtime-"));
	try {
		fs.writeFileSync(path.join(home, "auth.json"), "{}\n", { mode: 0o600 });
		const result = spawnSync(runtime, [fileURLToPath(import.meta.url), "--probe", path.resolve(standalone), ...(browser ? ["--browser"] : [])], {
			cwd: home,
			env: { ...probeEnv(process.env, home), ELECTRON_RUN_AS_NODE: "1" },
			encoding: "utf8", timeout: 60_000, maxBuffer: 128 * 1024,
		});
		if (result.status !== 0 || result.error) {
			throw new Error(`demo runtime probe failed (${result.error?.message ?? result.status}):\n${result.stdout ?? ""}${result.stderr ?? ""}`);
		}
		process.stdout.write(result.stdout);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
}

async function importPayload(standalone) {
	const root = fs.realpathSync(standalone);
	const inside = (file) => {
		const relative = path.relative(root, fs.realpathSync(file));
		assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
			`dependency escaped standalone payload: ${file}`);
	};
	const require = createRequire(path.join(root, "server.js"));
	const entry = require.resolve("@resvg/resvg-js");
	inside(entry); // require.resolve must not silently fall back to checkout node_modules.
	const loaded = new Set();
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			const result = nextResolve(specifier, context);
			if (result.url.startsWith("file:")) {
				inside(fileURLToPath(result.url));
				loaded.add(result.url);
			} else {
				assert.ok(result.url.startsWith("node:"), `unexpected dependency URL: ${result.url}`);
			}
			return result;
		},
	});
	try {
		const { Resvg } = await import(pathToFileURL(entry).href);
		const png = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>').render().asPng();
		assert.equal(Buffer.from(png).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
		console.log(`[smoke-demo-runtime] static SVG runtime ok; ${loaded.size} modules confined to ${root}`);
		return { hooks };
	} catch (error) {
		hooks.deregister();
		throw error;
	}
}

// Explicit IPC disconnect can omit ChildProcess 'close' even after Electron
// exits. Wait for actual exit, boundedly; never infer shutdown intent from
// Node's automatic stdin cleanup after an unexpected child exit.
/** @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, requested: boolean}>} */
export async function stopBrowserService(helper) {
	if (!helper.pid || helper.exitCode !== null || helper.signalCode !== null) {
		return { code: helper.exitCode, signal: helper.signalCode, requested: false };
	}
	let onExit, onError;
	const exited = new Promise((resolve, reject) => {
		onExit = (code, signal) => resolve({ code, signal });
		onError = reject;
		helper.once("exit", onExit);
		helper.once("error", onError);
	});
	const wait = async (ms) => {
		let timer;
		try {
			return await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
		} finally { clearTimeout(timer); }
	};
	try {
		const requested = helper.connected;
		if (requested) {
			console.log("[smoke-demo-runtime] requesting parent IPC disconnect");
			helper.disconnect();
		}
		const result = await wait(5000);
		if (!result) {
			helper.kill("SIGKILL");
			if (!await wait(3000)) throw new Error("browser-service did not exit after forced cleanup");
			throw new Error("browser-service did not exit after IPC disconnect; force-killed");
		}
		return { ...result, requested };
	} finally {
		helper.removeListener("exit", onExit);
		helper.removeListener("error", onError);
	}
}

async function main() {
	const args = process.argv.slice(2);
	if (args[0] === "--probe") {
		const { hooks } = await importPayload(args[1]);
		try {
			if (args.includes("--browser")) throw new Error("Browser verification is disabled in this build.");
		} finally { hooks.deregister(); }
		return;
	}
	const value = (name, fallback) => {
		const index = args.indexOf(name);
		if (index < 0) return fallback;
		assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a path`);
		return path.resolve(args[index + 1]);
	};
	verifyDemoRuntime(value("--standalone", path.resolve(import.meta.dirname, "../.next/standalone")), value("--runtime", process.execPath), args.includes("--browser"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => { console.error(`[smoke-demo-runtime] FAIL: ${formatProbeError(err)}`); process.exitCode = 1; });
}
