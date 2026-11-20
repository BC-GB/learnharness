/** Learning Path — native session bridge.
 *
 * A native tool contribution, scoped to `prober`, `teacher`
 * and `practice` turns:
 * - a per-turn tool factory. It returns `[]` for every unlinked chat, so regular
 *   LearnHarness sessions are untouched. For a linked chat it exposes the node
 *   brief plus progress, error and advisory-pivot writes.
 *
 * A link is only a plugin record. The native chat remains host-owned: every
 * lookup re-reads `ctx.learning.getSession` so a deleted chat stops injecting
 * tools instead of resurrecting stale context. Pivot suggestions never mutate
 * the path; only the learner can accept one.
 */
import { randomUUID } from "node:crypto";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  PluginAgentKind,
  PluginBackendContext,
  PluginToolContext,
  PluginTools,
} from "../.sdk/index.d.ts";
import {
  ERROR_CATEGORIES,
  artifactCatalogEntry,
  formatSourceAnchor,
} from "./domain.ts";
import type { ChildSessionKind, LearningPath, PathModule, PathNode } from "./domain.ts";
import { buildChildSessionBrief, buildModuleSessionBrief } from "./framework.ts";
import {
  appendError,
  appendPivot,
  findChatLink,
  findModuleChatLink,
  findNode,
  kindMatchesAgent,
  newErrorEntry,
  newPivotSuggestion,
  updateNodeProgress,
} from "./session-links.ts";
import type { LearningPathStore } from "./store.ts";
import { CHILD_PIVOT_TYPES } from "./tool-names.ts";

export const NATIVE_AGENTS: readonly PluginAgentKind[] = ["prober", "teacher", "practice"];

export interface NativeBridgeOptions {
  readonly store: LearningPathStore;
  /** Backend hook for live path notifications after a tool write. */
  readonly onPathChanged?: (
    path: LearningPath,
    detail: { readonly nodeId: string; readonly chatId: string; readonly change: string },
  ) => void;
  readonly onPositionChanged?: (chatId: string) => void;
}

interface NodeStart {
  readonly chatId: string;
  readonly pathId: string;
  readonly moduleId: string;
  readonly nodeId: string;
  readonly toolCallId: string;
}

type JsonRecord = Record<string, unknown>;

const objectSchema = (
  properties: JsonRecord,
  required: readonly string[] = [],
): JsonRecord => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

const textResult = <T>(value: T, text: string): AgentToolResult<T> => ({
  content: [{ type: "text", text }],
  details: value,
});

const errorResult = (message: string): AgentToolResult<{ error: string }> => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  details: { error: message },
  isError: true,
});

function readObject(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object argument.");
  }
  return value as JsonRecord;
}

function readTrimmedText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const text = value.trim();
  if (text.length === 0) throw new Error(`${field} must not be blank.`);
  if (text.length > max) throw new Error(`${field} must be at most ${max} characters.`);
  return text;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function assertLive(ctx: PluginBackendContext, signal: AbortSignal | undefined): void {
  if (ctx.signal.aborted || signal?.aborted) {
    throw new Error("The Learning Path plugin is shutting down; no change was made.");
  }
}

/** `null` means the native chat is gone; an invalid id is treated the same way. */
function nativeChatExists(ctx: PluginBackendContext, chatId: string): boolean {
  try {
    return ctx.learning.getSession(chatId) !== null;
  } catch {
    return false;
  }
}

interface LocatedChat {
  readonly path: LearningPath;
  readonly node: PathNode;
  readonly kind: ChildSessionKind;
  readonly pathModule?: PathModule;
}

/** Fresh lookup: links can be removed or chats deleted while a turn is running. */
function locateChat(store: LearningPathStore, chatId: string, nodeId?: unknown): LocatedChat | null {
  const located = findChatLink(store.paths(), chatId);
  if (located) return { path: located.path, node: located.node, kind: located.link.kind };
  const scope = findModuleChatLink(store.paths(), chatId);
  if (!scope) return null;
  const id = readTrimmedText(nodeId, "nodeId", 128);
  const node = scope.pathModule.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error("Select an activity in this session's module.");
  return { path: scope.path, pathModule: scope.pathModule, node, kind: scope.link.kind };
}

const activityId = { type: "string", maxLength: 128, description: "ID of an activity in this module." };
const BRIEF_TOOL = "learning_path_get_brief";

/** Deleted chats stop tools mid-turn instead of writing against a vanished session. */
function missingNativeResult(
  ctx: PluginBackendContext,
  chatId: string,
): AgentToolResult<{ error: string }> | null {
  return nativeChatExists(ctx, chatId)
    ? null
    : errorResult(`Native chat "${chatId}" no longer exists; no Learning Path change was made.`);
}

function nodeSummary(path: LearningPath, node: PathNode): JsonRecord {
  return {
    pathId: path.id,
    pathTitle: path.title,
    pathGoal: path.goal,
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    nodeGoal: node.goal,
    progression: node.progression,
  };
}

function briefTool(
  ctx: PluginBackendContext,
  store: LearningPathStore,
  chatId: string,
  moduleSession: boolean,
  recordStart?: (start: NodeStart) => void,
): AgentTool {
  return {
    name: BRIEF_TOOL,
    label: "Learning Path brief",
    description: moduleSession
      ? "Read this module's typed activities. Use nodeId for the selected activity's teaching guidance and source anchor. " +
        "Use the learner's recent answers to choose the next activity, and continue in this same chat."
      :
      "Read the current Learning Path node brief: node goal, canonical source anchor, loose micro-priming hook, " +
      "meso-interleaving callbacks, active error watchpoints and the generative artifact configuration. " +
      "Call this before teaching or posing practice in a linked child session.",
    parameters: objectSchema(moduleSession ? {
      nodeId: activityId,
      offset: { type: "integer", minimum: 0, description: "The next offset from a module outline with more activities." },
      ...(recordStart ? { begin: {
        type: "boolean",
        description: "Set true with nodeId when starting or returning to this activity in the next teaching reply. Leave unset when previewing an activity or continuing the same one.",
      } } : {}),
    } : {}),
    execute: async (toolCallId, rawParams, signal) => {
      assertLive(ctx, signal);
      const missing = missingNativeResult(ctx, chatId);
      if (missing) return missing;
      const params = moduleSession ? readObject(rawParams ?? {}) : {};
      if (params.begin !== undefined &&
          (!recordStart || typeof params.begin !== "boolean" || params.nodeId === undefined)) {
        return errorResult("Starting an activity requires a teaching chat and a nodeId.");
      }
      const scope = moduleSession ? findModuleChatLink(store.paths(), chatId) : null;
      if (scope && params.nodeId === undefined) {
        const offset = params.offset ?? 0;
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) ||
            offset < 0 || offset >= scope.pathModule.nodes.length) {
          return errorResult("Select an offset in this module's outline.");
        }
        const brief = buildModuleSessionBrief(scope.path, scope.pathModule, scope.link.kind, offset);
        return textResult({
          moduleId: scope.pathModule.id,
          moduleTitle: scope.pathModule.title,
          nodes: brief.nodes,
          nextOffset: brief.nextOffset,
        }, brief.text);
      }
      let located: LocatedChat | null;
      try {
        located = locateChat(store, chatId, params.nodeId);
      } catch (error) {
        if (error instanceof Error) return errorResult(error.message);
        throw error;
      }
      if (!located) {
        return errorResult("This session is no longer linked to a Learning Path node.");
      }
      const { path, node, kind } = located;
      const brief = buildChildSessionBrief({
        path,
        nodeId: node.id,
        kind,
        settings: store.settings(),
        moduleTitle: located.pathModule?.title,
      });
      const catalog = artifactCatalogEntry(brief.artifact.type);
      const anchor = formatSourceAnchor(node.sourceAnchor);
      const details = {
        ...nodeSummary(path, node),
        kind,
        sourceAnchor: anchor,
        artifact: {
          type: brief.artifact.type,
          label: catalog.label,
          justification: catalog.justification,
          ...(brief.artifact.instructions === undefined
            ? {}
            : { instructions: brief.artifact.instructions }),
        },
        interleaved: brief.interleavedNodes.map((entry) => ({
          nodeId: entry.id,
          title: entry.title,
          type: entry.type,
        })),
        watchpoints: brief.watchpoints.map((watchpoint) => ({
          nodeId: watchpoint.nodeId,
          nodeTitle: watchpoint.nodeTitle,
          errorId: watchpoint.entry.id,
          category: watchpoint.entry.category,
          summary: watchpoint.entry.summary,
        })),
        unresolvedErrors: node.errors.filter((entry) => !entry.resolved).length,
      };
      if (params.begin === true && located.pathModule && kind === "teaching") {
        recordStart?.({ chatId, pathId: path.id, moduleId: located.pathModule.id, nodeId: node.id, toolCallId });
      }
      return textResult(details, brief.text);
    },
  };
}

function progressTool(
  ctx: PluginBackendContext,
  options: NativeBridgeOptions,
  chatId: string,
  moduleSession: boolean,
): AgentTool {
  return {
    name: "learning_path_update_progress",
    label: "Update node progress",
    description:
      (moduleSession ? "Record progress on the supplied activity in this module: " : "Record progress on this session's node: ") +
      "in_progress or consolidated. " +
      "Optionally include a short artifactNote when the node's generative artifact was actually produced. " +
      "This is learner-controlled and ungated; do not mark consolidated without evidence of independent reconstruction.",
    parameters: objectSchema(
      {
        ...(moduleSession ? { nodeId: activityId } : {}),
        progression: {
          type: "string",
          enum: ["in_progress", "consolidated"],
          description: "The new progression state for this node.",
        },
        artifactNote: {
          type: "string",
          maxLength: 2000,
          description: "Optional short note about the produced artifact.",
        },
      },
      moduleSession ? ["nodeId", "progression"] : ["progression"],
    ),
    execute: async (_toolCallId, rawParams, signal) => {
      assertLive(ctx, signal);
      const missing = missingNativeResult(ctx, chatId);
      if (missing) return missing;
      try {
        const params = readObject(rawParams);
        const located = locateChat(options.store, chatId, params.nodeId);
        if (!located) return errorResult("This session is no longer linked to Learning Paths.");
        const progression = readEnum(
          params.progression,
          ["in_progress", "consolidated"] as const,
          "progression",
        );
        const artifactNote =
          params.artifactNote === undefined
            ? undefined
            : readTrimmedText(params.artifactNote, "artifactNote", 2000);
        const previous = located.node.progression;
        const now = new Date().toISOString();
        const next = updateNodeProgress(
          located.path,
          located.node.id,
          { progression, ...(artifactNote === undefined ? {} : { artifactNote }) },
          now,
        );
        const saved = options.store.savePath(next);
        options.onPathChanged?.(saved, {
          nodeId: located.node.id,
          chatId,
          change: "progress",
        });
        const node = findNode(saved, located.node.id);
        const details = {
          ...(node ? nodeSummary(saved, node) : nodeSummary(saved, located.node)),
          previousProgression: previous,
          ...(artifactNote === undefined ? {} : { artifactNote }),
        };
        return textResult(
          details,
          `Recorded ${progression} for "${located.node.title}" (was ${previous}).` +
            (artifactNote === undefined ? "" : " Artifact note saved."),
        );
      } catch (error) {
        if (error instanceof Error) return errorResult(error.message);
        throw error;
      }
    },
  };
}

function logErrorTool(
  ctx: PluginBackendContext,
  options: NativeBridgeOptions,
  chatId: string,
  moduleSession: boolean,
): AgentTool {
  return {
    name: "learning_path_log_error",
    label: "Log a cognitive error",
    description:
      "Record one diagnosed cognitive error in this node's Error Ledger by root-cause category. " +
      (moduleSession ? "Pass the activity's nodeId. " : "Defaults to this session's node. ") +
      "Pass upstreamNodeId only for an interleaved earlier node when " +
      "recall or transfer of that earlier idea failed. Entries stay unresolved until the learner resolves them.",
    parameters: objectSchema(
      {
        ...(moduleSession ? { nodeId: activityId } : {}),
        category: {
          type: "string",
          enum: [...ERROR_CATEGORIES],
          description: "Cognitive root cause, never a grade.",
        },
        summary: {
          type: "string",
          maxLength: 2000,
          description: "What specifically went wrong, concretely and briefly.",
        },
        upstreamNodeId: {
          type: "string",
          description: "An interleaved earlier node id when the failure belongs there.",
        },
      },
      moduleSession ? ["nodeId", "category", "summary"] : ["category", "summary"],
    ),
    execute: async (_toolCallId, rawParams, signal) => {
      assertLive(ctx, signal);
      const missing = missingNativeResult(ctx, chatId);
      if (missing) return missing;
      try {
        const params = readObject(rawParams);
        const located = locateChat(options.store, chatId, params.nodeId);
        if (!located) return errorResult("This session is no longer linked to Learning Paths.");
        const category = readEnum(params.category, ERROR_CATEGORIES, "category");
        const summary = readTrimmedText(params.summary, "summary", 2000);
        let target = located.node;
        if (params.upstreamNodeId !== undefined) {
          const upstreamId = readTrimmedText(params.upstreamNodeId, "upstreamNodeId", 128);
          if (located.pathModule && !located.pathModule.nodes.some((node) => node.id === upstreamId)) {
            return errorResult("Record errors only against an activity in this module.");
          }
          if (!located.node.interleavesNodeIds.includes(upstreamId)) {
            return errorResult(
              `"${upstreamId}" is not an interleaved earlier node of "${located.node.title}". ` +
                `Valid upstream ids: ${located.node.interleavesNodeIds.join(", ") || "none"}.`,
            );
          }
          const upstream = findNode(located.path, upstreamId);
          if (!upstream) return errorResult(`Unknown upstream node "${upstreamId}".`);
          target = upstream;
        }
        const now = new Date().toISOString();
        const entry = newErrorEntry({
          id: randomUUID(),
          category,
          summary,
          chatId,
          now,
        });
        const saved = options.store.savePath(
          appendError(located.path, target.id, entry, now),
        );
        options.onPathChanged?.(saved, {
          nodeId: target.id,
          chatId,
          change: "error",
        });
        return textResult(
          {
            ...nodeSummary(saved, target),
            errorId: entry.id,
            category: entry.category,
            summary: entry.summary,
            resolved: entry.resolved,
            sessionChatId: chatId,
          },
          `Logged a ${category} on "${target.title}": ${summary}`,
        );
      } catch (error) {
        if (error instanceof Error) return errorResult(error.message);
        throw error;
      }
    },
  };
}

function suggestPivotTool(
  ctx: PluginBackendContext,
  options: NativeBridgeOptions,
  chatId: string,
  moduleSession: boolean,
): AgentTool {
  return {
    name: "learning_path_suggest_pivot",
    label: "Suggest an advisory pivot",
    description:
      "Record an advisory pivot suggestion when a topic is not sticking for a specific diagnosed reason. " +
      (moduleSession ? "Pass the current activity's nodeId. Use short repairs within this chat directly. " : "") +
      "Proposal types are bridge (missing prerequisite), contrast (boundary confusion) or skill (mechanical bottleneck). " +
      "The suggestion starts pending; this tool never inserts, reorders or deletes anything. The learner decides.",
    parameters: objectSchema(
      {
        ...(moduleSession ? { nodeId: activityId } : {}),
        proposalType: {
          type: "string",
          enum: [...CHILD_PIVOT_TYPES],
          description: "The kind of surgical detour being suggested.",
        },
        title: { type: "string", maxLength: 300, description: "Short node-sized title." },
        rationale: {
          type: "string",
          maxLength: 2000,
          description: "Why this diagnosis calls for the proposed detour.",
        },
      },
      moduleSession ? ["nodeId", "proposalType", "title", "rationale"] : ["proposalType", "title", "rationale"],
    ),
    execute: async (_toolCallId, rawParams, signal) => {
      assertLive(ctx, signal);
      const missing = missingNativeResult(ctx, chatId);
      if (missing) return missing;
      try {
        const params = readObject(rawParams);
        const located = locateChat(options.store, chatId, params.nodeId);
        if (!located) return errorResult("This session is no longer linked to Learning Paths.");
        const proposalType = readEnum(params.proposalType, CHILD_PIVOT_TYPES, "proposalType");
        const title = readTrimmedText(params.title, "title", 300);
        const rationale = readTrimmedText(params.rationale, "rationale", 2000);
        const duplicate = located.node.pivotSuggestions.find(
          (pivot) =>
            pivot.status === "pending" &&
            pivot.proposalType === proposalType &&
            pivot.title === title,
        );
        if (duplicate) {
          return errorResult(`A pending ${proposalType} pivot with this title already exists.`);
        }
        const now = new Date().toISOString();
        const pivot = newPivotSuggestion({
          id: randomUUID(),
          proposalType,
          title,
          rationale,
          now,
        });
        const saved = options.store.savePath(
          appendPivot(located.path, located.node.id, pivot, now),
        );
        options.onPathChanged?.(saved, {
          nodeId: located.node.id,
          chatId,
          change: "pivot",
        });
        return textResult(
          {
            ...nodeSummary(saved, findNode(saved, located.node.id) ?? located.node),
            pivotId: pivot.id,
            proposalType: pivot.proposalType,
            title: pivot.title,
            rationale: pivot.rationale,
            status: pivot.status,
            advisory: true,
            pathMutated: false,
          },
          `Recorded an advisory ${proposalType} suggestion: "${title}". It is pending; the path was not changed. ` +
            "The learner may accept, refine or dismiss it in the Path Hub.",
        );
      } catch (error) {
        if (error instanceof Error) return errorResult(error.message);
        throw error;
      }
    },
  };
}

/** Build the tools for one frozen turn, or `[]` for an unlinked/deleted chat. */
export function createNativeTools(
  ctx: PluginBackendContext,
  options: NativeBridgeOptions,
  context: PluginToolContext,
  recordStart?: (start: NodeStart) => void,
): AgentTool[] {
  const paths = options.store.paths();
  const moduleSession = findModuleChatLink(paths, context.chatId);
  const kind = moduleSession?.link.kind ?? findChatLink(paths, context.chatId)?.link.kind;
  if (!kind || !kindMatchesAgent(kind, context.agent)) return [];
  if (!nativeChatExists(ctx, context.chatId)) return [];
  return [
    briefTool(ctx, options.store, context.chatId, moduleSession !== null,
      moduleSession?.link.kind === "teaching" ? recordStart : undefined),
    progressTool(ctx, options, context.chatId, moduleSession !== null),
    logErrorTool(ctx, options, context.chatId, moduleSession !== null),
    suggestPivotTool(ctx, options, context.chatId, moduleSession !== null),
  ];
}

function saveTeachingPosition(
  ctx: PluginBackendContext,
  options: NativeBridgeOptions,
  start: NodeStart,
  messageId: string,
): void {
  const scope = findModuleChatLink(options.store.paths(), start.chatId);
  if (!scope || scope.link.kind !== "teaching" || scope.link.currentNodeId === start.nodeId ||
      scope.path.id !== start.pathId || scope.pathModule.id !== start.moduleId ||
      !scope.pathModule.nodes.some((node) => node.id === start.nodeId)) return;
  const record = ctx.learning.getSession(start.chatId);
  if (!record || record.kind === "practice") return;
  const reply = record.messages.findIndex((message) => message.role === "assistant" && message.id === messageId);
  const brief = record.messages.findLastIndex((message) => message.role === "toolResult" &&
    message.toolCallId === start.toolCallId && message.toolName === BRIEF_TOOL && !message.isError);
  if (brief < 0 || reply <= brief) return;

  options.store.savePath({
    ...scope.path,
    modules: scope.path.modules.map((entry) => entry.id === scope.pathModule.id ? {
      ...entry,
      sessions: entry.sessions?.map((link) => link.chatId === start.chatId ? {
        ...link, currentNodeId: start.nodeId,
      } : link),
    } : entry),
  });
  options.onPositionChanged?.(start.chatId);
}

/** Register linked-session tools without changing any native system prompt. */
export function registerNativeBridge(
  ctx: PluginBackendContext,
  options: NativeBridgeOptions,
): () => void {
  const pending = new Map<string, NodeStart>();
  const unsubscribe = ctx.events.on((event) => {
    if (ctx.signal.aborted) return;
    if (event.type === "turn-started") pending.delete(event.chatId);
    if (event.type === "turn-settled") {
      const start = pending.get(event.chatId);
      if (!start) return;
      // The host emits response-ready synchronously after turn-settled on a
      // successful reply. Drop starts from all other settlements.
      queueMicrotask(() => {
        if (pending.get(event.chatId) === start) pending.delete(event.chatId);
      });
    }
    if (event.type === "response-ready") {
      const start = pending.get(event.chatId);
      if (!start) return;
      pending.delete(event.chatId);
      saveTeachingPosition(ctx, options, start, event.messageId);
    }
  });
  const contribution: PluginTools = {
    agents: [...NATIVE_AGENTS],
    create: (context) => createNativeTools(ctx, options, context, (start) => pending.set(start.chatId, start)),
  };
  const unregisterTools = ctx.registerTools(contribution);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
    pending.clear();
    unregisterTools();
  };
}
