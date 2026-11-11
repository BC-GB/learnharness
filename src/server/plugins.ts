import { AsyncResource } from "node:async_hooks";
import { createCorePluginPreferences } from "./plugin-preferences.ts";
import { courseLocal, courseStatePath, forEachKnownCourse } from "../runtime/course-context.ts";
import { sharedPreferencePath } from "../runtime/global-preferences-path.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS, BASE_DATA_ROOT } from "../../config.ts";
import packageJson from "../../package.json";
import { emit, subscribe } from "../core/events.ts";
import { createPluginAgentService } from "../agent/plugin-agents.ts";
import { createPluginWorkerService } from "../agent/plugin-workers.ts";
import { registerJobAbort, unregisterJobAbort } from "../agent/subagents/aborts.ts";
import { createPluginAgentRecordStore } from "../store/plugin-agent-records.ts";
import { createPluginTaskRecordStore, readPluginTaskRecord, recoverPluginTaskRecords } from "../store/plugin-task-records.ts";
import corePluginIds from "../../core-plugins.json";
import { assertGraphFormat } from "../store/graph-format.ts";
import { createPluginLearningData } from "./plugin-learning.ts";
import { createPluginInference } from "./plugin-inference.ts";
import { createPluginBackgroundTool, recoverPluginBackgroundJob } from "./plugin-background-tools.ts";
import { registerPluginWorkerActivity } from "./plugin-worker-activity.ts";
import { deliverJobResult, setPluginJobRecovery } from "./jobs.ts";
import { createPluginHost } from "./plugin-host.ts";
import { createPluginTransport } from "./plugin-transport.ts";
import { createPluginDocumentConverter } from "./plugin-documents.ts";
import type { JobRecord } from "../core/contracts.ts";
import type { AgentBuildOptions } from "../agent/teacher-agent.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { compactionInFlight } from "./compaction.ts";

export function pluginDirectory(): string { return courseStatePath(path.join(/* turbopackIgnore: true */ PATHS.data, "plugins")); }
type Host = ReturnType<typeof createPluginHost>;
interface Runtime { host: Host; ready: Promise<void> }

/** Each activation owns exactly one course, including delayed service work. */
function runtime(): Runtime {
 return courseLocal("plugin-runtime", () => {
 const directory = pluginDirectory();
 const core = {
  directory: path.join(/* turbopackIgnore: true */ PATHS.root, "core-plugins"),
  dataDirectory: courseStatePath(path.join(/* turbopackIgnore: true */ PATHS.data, "core-plugin-data")),
  ids: corePluginIds,
 };
 const coreData = { directory: core.dataDirectory, ids: core.ids };
	const learning = createPluginLearningData({
		directory: PATHS.data, chatStore: stores.chatStore, graphStore: stores.graphStore,
		isBusy: isTurnRunning, isCompacting: compactionInFlight,
		readMetadata(name) {
			assertGraphFormat();
			try { return JSON.parse(fs.readFileSync(courseStatePath(path.join(/* turbopackIgnore: true */ PATHS.graph, name)), "utf8")); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
		},
	});
	const installationErrors: Record<string, string> = Object.assign(Object.create(null), {
        "coding-questions": "Native code execution is unavailable in this hardened deployment. An isolated execution service is required.",
    });
	const host = createPluginHost({
		directory, core, allowCommunity: false, browserWorkersAvailable: false, preferencesFor: createCorePluginPreferences,
        stateFile: () => sharedPreferencePath(BASE_DATA_ROOT, "global-plugins.json"), appVersion: packageJson.version, installationErrors,
		// The process-global runtime owns one admission slot across all plugins
		// and every separately compiled Next route module.
		convertDocument: documentConverter().convert,
		createServices({ manifest, dataDirectory, signal }) {
			const inference = createPluginInference({ signal, dataDirectory });
			const agents = createPluginAgentService({
				store: createPluginAgentRecordStore(path.join(/* turbopackIgnore: true */ dataDirectory, "agents")),
				engineFor: inference.engineFor, onUsage: inference.onUsage, signal,
				onChange: () => { if (!signal.aborted) emit("plugin-message", { pluginId: manifest.id, topic: "agents-changed" }); },
			});
			const workerActivity = registerPluginWorkerActivity({
				pluginId: manifest.id, pluginName: manifest.name, signal,
				cancel: taskId => workers.cancel(taskId),
			});
			const workers = createPluginWorkerService({
				store: createPluginTaskRecordStore(path.join(/* turbopackIgnore: true */ dataDirectory, "tasks")),
				engineFor: inference.engineFor, onUsage: inference.onUsage, signal,
				onChange: workerActivity,
			});
			return { learning, inference: inference.inference, agents, workers,
				createBackgroundTool(context, definition) {
					return createPluginBackgroundTool({
						pluginId: manifest.id, context, definition, workers, signal, jobStore: stores.jobStore,
						deliver: deliverJobResult, isActive: () => !signal.aborted,
						registerAbort: registerJobAbort, unregisterAbort: unregisterJobAbort,
					});
				},
			};
		},
		subscribeEvents: listener => {
            return subscribe(AsyncResource.bind(listener));
        },
		onChange: () => emit("plugins-changed", {}),
		onNotification: (notification) => emit("plugin-message", notification),
	});
	// Defer recovery/activation until the process-wide holder is published.
	const ready = Promise.resolve().then(async () => {
		setPluginJobRecovery(recoverCoursePluginJob);
		// Exclusive bootstrap sweep, including disabled packages whose services
		// will not construct. Read-only job recovery never activates plugin code.
		for (const [id, error] of Object.entries(recoverPluginTaskRecords(directory, coreData))) {
			installationErrors[id] = `Task recovery failed: ${error}`;
		}
		await host.initialize();
	});
	return { host, ready };
 });
}

export async function initializePlugins(): Promise<void> { await runtime().ready; }
export async function getPluginHost(): Promise<Host> {
	const { host, ready } = runtime();
	await ready;
    await host.syncEnabled();
	return host;
}
/** Await startup once; actual factories run synchronously during per-turn Agent construction. */
export async function getPluginAgentContributions(): Promise<NonNullable<AgentBuildOptions["pluginContributions"]>> {
	return (await getPluginHost()).agentContributions;
}
/** Await startup before reading canonical truth; the returned resolver itself is synchronous. */
export async function getPluginQuestionTypeResolver(): Promise<Host["resolveQuestionType"]> {
	return (await getPluginHost()).resolveQuestionType;
}
// Conversion has no learner state; its admission slot remains process-wide.
function documentConverter(): ReturnType<typeof createPluginDocumentConverter> {
 const global = globalThis as typeof globalThis & { __lhPluginDocuments?: ReturnType<typeof createPluginDocumentConverter> };
 return global.__lhPluginDocuments ??= createPluginDocumentConverter();
}
export const pluginTransport = createPluginTransport({
 getHost: getPluginHost, get directory() { return pluginDirectory(); },
 async afterSetEnabled() {
  const pending: Promise<void>[] = [];
  forEachKnownCourse(() => { pending.push(getPluginHost().then(host => host.syncEnabled())); });
  await Promise.all(pending);
 },
});

/** Recovery does not load or activate package code. Paths are selected per caller. */
export async function recoverCoursePluginJob(job: JobRecord): Promise<void> {
 const directory = pluginDirectory();
 const coreData = { directory: courseStatePath(path.join(/* turbopackIgnore: true */ PATHS.data, "core-plugin-data")), ids: corePluginIds };
 return recoverPluginBackgroundJob(job, {
  jobStore: stores.jobStore, deliver: deliverJobResult,
  readTask: (pluginId, taskId, requestId) => readPluginTaskRecord(directory, pluginId, taskId, requestId, coreData),
  registerAbort: registerJobAbort, unregisterAbort: unregisterJobAbort,
 });
}
