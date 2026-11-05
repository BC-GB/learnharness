import type { LhMessage } from "./native-messages.ts";
import { failedOutputCallIds, userFacingTextOf } from "./native-messages.ts";
import { QUESTION_TOOLS } from "./pending.ts";

/** New, durable learner-facing output only; never an old reply, thought,
 * background job, failed call, aborted stream or persistence failure. */
export function responseReadyId(messages: readonly LhMessage[], aborted: boolean): string | null {
	if (aborted) return null;
	const assistants = messages.filter((m) => m.role === "assistant");
	const last = assistants.at(-1);
	if (!last || last.stopReason === "error" || last.stopReason === "aborted") return null;
	const failed = new Set(failedOutputCallIds(messages));
	for (const message of messages) if (message.role === "toolResult" && message.isError) failed.add(message.toolCallId);
	for (const message of assistants.toReversed()) {
		if (message.stopReason === "error" || message.stopReason === "aborted") continue;
		if (userFacingTextOf(message.content, failed).length || message.content.some((block) =>
			block.type === "toolCall" && !failed.has(block.id) &&
			([...(QUESTION_TOOLS as readonly string[]), "problem"].includes(block.name)))) return message.id;
	}
	return null;
}

export interface ResponseReady { chatId: string; messageId: string }
export function isResponseReady(value: unknown): value is ResponseReady {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	return [item.chatId, item.messageId].every((s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(s));
}

/** Recheck after asynchronous deduplication: a focus/permission/setting
 * change while awaiting storage must prevent dispatch. */
export async function deliverResponseReady(event: unknown, deps: {
	allowed(): boolean; away(): boolean;
	claim(event: ResponseReady): Promise<boolean>;
	show(event: ResponseReady): void;
}): Promise<void> {
	if (!isResponseReady(event) || !deps.allowed() || !deps.away()) return;
	if (!await deps.claim(event) || !deps.allowed() || !deps.away()) return;
	deps.show(event);
}
