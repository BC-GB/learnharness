import { chatPdfPath } from "../../runtime/chat-pdfs.ts";
import { resolveSourcePath } from "./fs-shared.ts";

/** Only PDF operations can read uploaded PDFs outside the source library. */
export function resolvePdfPath(raw: string): string { return chatPdfPath(raw) ?? resolveSourcePath(raw); }
