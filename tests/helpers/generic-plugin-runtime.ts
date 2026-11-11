/** Explicit test-only generic host composition. Production community policy is
 * tested separately and never changed by this fixture. Any unrequested service
 * use fails instead of reaching network, models or production stores. */
import { createPluginHost, type PluginHostDependencies } from "../../src/server/plugin-host.ts";
import { courseLocal } from "../../src/runtime/course-context.ts";
export async function installGenericPluginRuntime(directory: string) {
 const unavailable = new Proxy({}, { get(_target, key) { if (key === "dispose") return () => {}; throw Error("Unexpected fixture service: " + String(key)); } });
 const host = createPluginHost({ directory, appVersion: "0.6.0", createServices: () => ({ learning: unavailable, inference: unavailable, agents: unavailable, workers: unavailable, createBackgroundTool: () => { throw Error("Unexpected background task"); } }) as ReturnType<PluginHostDependencies["createServices"]> });
 const value = { host, ready: host.initialize() };
 if (courseLocal("plugin-runtime", () => value) !== value) throw Error("Fixture runtime already initialized");
 await value.ready;
 return host;
}

/** Override only the current course fixture; restore the initialized production
 * runtime afterward. No process-global host or production policy bypass. */
export async function replacePluginRuntimeForTest(host: object) {
 const { getPluginHost } = await import("../../src/server/plugins.ts");
 await getPluginHost();
 const runtime = courseLocal<{ host: unknown; ready: Promise<void> }>("plugin-runtime", () => { throw Error("Missing initialized fixture runtime"); });
 const previous = { ...runtime };
 runtime.host = { async syncEnabled() {}, ...host };
 runtime.ready = Promise.resolve();
 return () => { runtime.host = previous.host; runtime.ready = previous.ready; };
}
