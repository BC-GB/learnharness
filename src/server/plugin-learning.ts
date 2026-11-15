import { AsyncResource } from "node:async_hooks";
import { derivePlanStatusesLh } from "../core/contracts.ts";
import { messageViewLines } from "../core/coverage.ts";
import type { PluginGraphFileData, PluginLearningData } from "../core/plugins.ts";
import type { ChatStore, GraphStore } from "../core/ports.ts";
import { graphSnapshot } from "../core/graph.ts";

export interface PluginLearningDeps {
	directory: string;
	chatStore: ChatStore;
	graphStore: GraphStore;
	isBusy(id: string): boolean;
	isCompacting(id: string): boolean;
	readMetadata(name: "render-settings.json" | "format.json"): unknown;
}

/** A deliberately thin, read-only facade. Every read is fresh; this is not a
 * transaction spanning several files. Native transcript content is preserved.
 * Raw ledgers use the same version guards and validation as the core store. */
export function createPluginLearningData(deps: PluginLearningDeps): PluginLearningData {
	const readers: { [K in keyof PluginGraphFileData]: () => PluginGraphFileData[K] } = {
		"nodes.jsonl": () => deps.graphStore.readNodes(),
		"chains.jsonl": () => deps.graphStore.readChains(),
		"sessions.jsonl": () => deps.graphStore.readCheckpoints(),
		"coverage.jsonl": () => deps.graphStore.readCoverage(),
		"sources.json": () => deps.graphStore.readSources(),
		"positions.json": () => deps.graphStore.readPositions(),
		"render-settings.json": () => deps.readMetadata("render-settings.json"),
		"format.json": () => deps.readMetadata("format.json"),
	};
	const api: PluginLearningData = {
		directory: deps.directory,
		listSessions: () => deps.chatStore.listChats().map((s) => ({ ...s, busy: deps.isBusy(s.id), compacting: deps.isCompacting(s.id) })),
		getSession: (id) => {
			if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid learning session id");
			return deps.chatStore.getChat(id);
		},
		getSessionSnapshot: id => {
            if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid learning session id");
            const record = deps.chatStore.getChat(id); if (!record) return null;
            const nodes = new Set(record.tree?.nodes.map(n => n.id)); let nodeId: string | null = null;
            const passages: { id: string; text: string; nodeId: string | null; index: number }[] = [];
            for (const [index, message] of record.messages.entries()) {
                if (message.role !== "assistant") continue;
                for (const part of message.content) {
                    if (part.type !== "toolCall" || !["quiz", "explain"].includes(part.name)) continue;
                    const candidate = (part.arguments as { nodeId?: unknown })?.nodeId;
                    if (typeof candidate === "string" && nodes.has(candidate)) nodeId = candidate;
                }
                const text = messageViewLines(message, message.id).join("\n").trim();
                if (text) passages.push({ id: message.id, text, nodeId, index });
            }
            return { record, passages, currentNode: record.tree ? derivePlanStatusesLh(record.tree, record.messages).current : null, busy: deps.isBusy(id) || deps.isCompacting(id) };
        },
		graph: () => graphSnapshot({ chatStore: deps.chatStore, graphStore: deps.graphStore }),
		readGraphFile: (name) => {
			if (!Object.hasOwn(readers, name)) throw new Error("Unknown learning-data file");
			return readers[name]();
		},
	};
    // Captures even an unbound legacy activation; callers cannot lend another
    // course to deferred reads through the shared store adapters.
    return { ...api, listSessions: AsyncResource.bind(api.listSessions), getSession: AsyncResource.bind(api.getSession), getSessionSnapshot: AsyncResource.bind(api.getSessionSnapshot!), graph: AsyncResource.bind(api.graph), readGraphFile: AsyncResource.bind(api.readGraphFile) };
}
