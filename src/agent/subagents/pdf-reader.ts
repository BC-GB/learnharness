import type { Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import type { PdfResult, PdfToolInput } from "../../core/contracts.ts";
import type { HeadlessApi } from "./headless.ts";
export interface PdfReaderOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onActivity?: (line: string) => void;
	headless?: HeadlessApi;
	maxIterations?: number;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

export interface PdfReaderInput extends PdfToolInput {}


/** PDF parsing is intentionally unavailable until an independently isolated
 * parser exists. Do not resolve the supplied path or invoke a provider. */
export async function runPdfReaderAgent(input: PdfReaderInput, _opts: PdfReaderOptions = {}): Promise<PdfResult> {
 return { path: input.path, question: input.question, brief: "PDF failed: PDF processing is disabled: an isolated parser is required.", pagesRead: [], pagesConsulted: [] };
}

export function createPdfTools(_path: string): Record<string, never> { return {}; }
