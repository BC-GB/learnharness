/** Platform window chrome + packaging policy, without launching Electron. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const mainFile = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
const mainSource = readFileSync(mainFile, "utf8");
const mainRequire = createRequire(mainFile);

/** Decline the single-instance lock so normal boot never spawns a server.
 * Then call the REAL createWindow with a stub Electron API and inspect its
 * constructor options. No rewritten copy of the production logic. */
function windowOptions(platform: string, env: Record<string, string> = {}) {
	class FakeWindow {
		constructor(readonly options: unknown) {}
		webContents = { on() {}, setWindowOpenHandler() {} };
		loadURL() {}
		once() {}
	}
	const electron = {
		app: { setName() {}, getPath: () => "/fixture/LearnHarness", setPath() {}, requestSingleInstanceLock: () => false, quit() {} },
		BrowserWindow: FakeWindow,
		session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
	};
	const context = {
		require: (id: string) => id === "electron" ? electron : mainRequire(id),
		process: { platform, argv: [], env, on() {} },
		__dirname: dirname(mainFile),
	};
	runInNewContext(mainSource, context, { filename: mainFile });
	const win = runInNewContext('createWindow("http://127.0.0.1:9000")', context) as FakeWindow;
	// The options originate in a VM realm; normalize prototypes for assertions.
	return JSON.parse(JSON.stringify(win.options));
}

describe("desktop window chrome", () => {
	it("macOS keeps the proven traffic lights and does not enable WCO", () => {
		const options = windowOptions("darwin");
		assert.equal(options.titleBarStyle, "hiddenInset");
		assert.deepEqual(options.trafficLightPosition, { x: 16, y: 22.5 });
		assert.equal(options.titleBarOverlay, undefined);
		assert.equal(options.autoHideMenuBar, undefined);
	});

	for (const platform of ["win32", "linux"]) {
		it(`${platform} uses native-height right-side controls with an Alt-accessible menu`, () => {
			const options = windowOptions(platform);
			assert.equal(options.titleBarStyle, "hidden");
			assert.deepEqual(options.titleBarOverlay, { color: "#141414", symbolColor: "#e5e5e5" });
			assert.equal(Object.hasOwn(options.titleBarOverlay, "height"), false, "omit height so the OS selects its native default");
			assert.equal(options.trafficLightPosition, undefined);
			assert.equal(options.autoHideMenuBar, true);
			assert.equal(options.webPreferences.contextIsolation, true);
			assert.equal(options.webPreferences.sandbox, true);
			assert.equal(options.webPreferences.nodeIntegration, false);
		});
	}

	it("only the external dev shell receives the web subscription transport marker", () => {
		assert.equal(windowOptions("darwin").webPreferences.additionalArguments, undefined);
		assert.deepEqual(windowOptions("darwin", { LH_DEV_URL: "http://localhost:3000" }).webPreferences.additionalArguments, ["--lh-web-subscriptions"]);
	});

	it("dev preload routes opaque sign-in actions through its narrow external-browser channel", async () => {
		let bridge!: { subscriptionTransport: string; openSubscriptionBrowser(action: string): Promise<void> };
		const invoked: unknown[][] = [];
		runInNewContext(readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
			process: { platform: "darwin", argv: ["--lh-web-subscriptions"] },
			require: () => ({ contextBridge: { exposeInMainWorld: (_: string, value: typeof bridge) => { bridge = value; } }, ipcRenderer: { on() {}, invoke: async (...args: unknown[]) => { invoked.push(args); } } }),
		});
		assert.equal(bridge.subscriptionTransport, "web");
		const action = "/api/subscriptions/browser?id=00000000-0000-4000-8000-000000000001";
		await bridge.openSubscriptionBrowser(action);
		assert.deepEqual(invoked, [["lh:subscriptions:web-browser", action]]);
	});

	it("preload exposes OS identity without exposing Node/Electron to the renderer", () => {
		let bridge: Record<string, unknown> = {};
		const context = {
			process: { platform: "win32" },
			require: () => ({
				contextBridge: {
					exposeInMainWorld(name: string, api: Record<string, unknown>) {
						assert.equal(name, "lh");
						bridge = api;
					},
				},
				ipcRenderer: { on() {} },
			}),
		};
		runInNewContext(readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"), context);
		assert.equal(bridge.platform, "win32");
		assert.deepEqual(Object.keys(bridge).sort(), [
			"chatgpt", "checkForUpdates", "expandWindow", "getPathForFile", "getUpdateState", "getZoom", "installUpdate", "onOpenSettings", "onUpdateStatus", "onZoom", "platform", "subscriptions",
		]);
		assert.deepEqual(Object.keys(bridge.subscriptions as object).sort(), ["cancel", "consent", "disconnect", "login", "onChange", "open", "respond", "retry", "status"]);
	});
});

describe("update preload bridge", () => {
	it("buffers the menu request, unsubscribes safely, and uses the matching snapshot/check channels", async () => {
		let bridge!: {
			onOpenSettings: (cb: (section: string) => void) => () => void;
			getUpdateState: () => Promise<unknown>;
			checkForUpdates: () => Promise<void>;
		};
		const handlers = new Map<string, (event: unknown, value: string) => void>();
		const invoked: string[] = [];
		runInNewContext(readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
			process: { platform: "darwin" },
			require: () => ({
				contextBridge: { exposeInMainWorld: (_: string, value: typeof bridge) => { bridge = value; } },
				ipcRenderer: {
					on: (channel: string, listener: (event: unknown, value: string) => void) => handlers.set(channel, listener),
					invoke: async (channel: string) => { invoked.push(channel); },
				},
			}),
		});
		const send = () => handlers.get("lh:open-settings")!({}, "general");
		const seen: string[] = [];
		send(); const off = bridge.onOpenSettings(section => seen.push(section));
		assert.deepEqual(seen, ["general"], "pre-subscription request is delivered once");
		send(); assert.deepEqual(seen, ["general", "general"]);
		off(); send(); assert.equal(seen.length, 2);
		const next: string[] = []; const offNext = bridge.onOpenSettings(section => next.push(section));
		assert.deepEqual(next, ["general"]);
		off(); send(); assert.equal(next.length, 2, "old cleanup cannot remove a newer subscriber");
		offNext();
		await bridge.getUpdateState(); await bridge.checkForUpdates();
		assert.deepEqual(invoked, ["lh:update:get", "lh:update:check"]);
	});
});

describe("desktop packaging policy", () => {
	const yaml = require("js-yaml") as { load(source: string): Record<string, any> };
	const config = yaml.load(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));

	it("configuration is accepted by the INSTALLED electron-builder schema", async () => {
		const { validateConfiguration } = require("app-builder-lib/out/util/config/config.js");
		await validateConfiguration(config, { isEnabled: false });
	});

	it("ships Mac arm64, Windows NSIS x64, and both Linux x64 channels", () => {
		assert.deepEqual(config.mac.target, [
			{ target: "dmg", arch: ["arm64"] }, { target: "zip", arch: ["arm64"] },
		]);
		assert.deepEqual(config.win.target, [{ target: "nsis", arch: ["x64"] }]);
		assert.equal(config.win.signExecutable, false);
		assert.equal(config.win.verifyUpdateCodeSignature, false);
		assert.deepEqual(config.linux.target, [
			{ target: "AppImage", arch: ["x64"] }, { target: "deb", arch: ["x64"] },
		]);
		assert.equal(config.linux.syncDesktopName, true);
		assert.equal(config.publish[0].releaseType, "draft");
	});

	it("deb has public maintainer metadata and a matching desktop identity", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		assert.equal(pkg.author.name, "Amos Blomqvist");
		assert.equal(pkg.author.email, "255718537+amosblomqvist@users.noreply.github.com");
		assert.equal(pkg.homepage, "https://github.com/amosblomqvist/learnharness");
		assert.equal(pkg.desktopName, "learnharness.desktop");
	});
});

describe("workflow action versions", () => {
	type Step = { uses?: string; with?: Record<string, unknown> };
	type Workflow = { jobs: Record<string, { steps: Step[] }> };
	const yaml = require("js-yaml") as { load(source: string): Workflow };

	for (const filename of ["ci.yml", "release.yml"]) {
		it(`${filename} uses supported Action runtimes without changing the app's Node 26`, () => {
			const workflow = yaml.load(readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8"));
			const expected = ["actions/checkout@v7", "actions/setup-node@v7"];
			if (filename === "release.yml") {
				expected.push("actions/upload-artifact@v7", "maxim-lobanov/setup-xcode@v1");
			}
			const observed = new Set<string>();
			for (const job of Object.values(workflow.jobs)) {
				for (const step of job.steps) {
					if (!step.uses) continue;
					assert.ok(expected.includes(step.uses), `unexpected Action reference: ${step.uses}`);
					observed.add(step.uses);
					if (step.uses === "actions/setup-node@v7") {
						assert.equal(step.with?.["node-version"], "26");
						assert.equal(step.with?.cache, "npm");
					}
					if (step.uses === "actions/upload-artifact@v7") {
						assert.equal(step.with?.archive ?? true, true, "multi-file installers remain zipped artifacts");
					}
				}
			}
			assert.deepEqual([...observed].sort(), expected.sort());
		});
	}
});

describe("release build authority", () => {
 it("has no signing secrets, write token or automatic release trigger", () => {
  const yaml = require("js-yaml");
  const source = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.doesNotMatch(source, /secrets\.|contents: write|GH_TOKEN|--publish always|createRelease/);
  for (const job of Object.values(workflow.jobs) as any[]) {
   assert.notEqual(job.permissions?.contents, "write");
   for (const step of job.steps) {
    if (step.uses?.startsWith("actions/checkout")) assert.equal(step.with["persist-credentials"], false);
   }
  }
  assert.ok(workflow.jobs.package.steps.some((step: any) => step.uses?.startsWith("actions/upload-artifact")));
 });
});
