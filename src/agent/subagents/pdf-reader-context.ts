import type { Message } from "@earendil-works/pi-ai";

/** One owned page image plus bounded, cited observations. Never discard an
 * image before a successful model response and explicit notes for that page. */
export class PdfReaderPageMemory {
 private current?: { page: number; message: Message; delivered: boolean; recorded: boolean };
 private observations = new Map<number, string>();

 confirmDelivery(): number | undefined {
  if (!this.current) return;
  this.current.delivered = true;
  return this.current.page;
 }

 recordBefore(nextPage: number, receipt: unknown): string {
  const previous = this.current;
  if (!previous) {
   if (receipt !== undefined) throw new Error("No previous page is awaiting observations.");
   return "";
  }
  if (!previous.delivered) throw new Error("Read the current page image before rendering another page.");
  if (receipt === undefined) {
   if (nextPage === previous.page || previous.recorded) return "";
   throw new Error(`Record previous_page_notes for page ${previous.page} before moving to another page. Include question wording, selections, annotations and uncertainties needed for the final brief.`);
  }
  const value = receipt as { page?: unknown; notes?: unknown };
  if (!value || typeof value !== "object" || Array.isArray(value) || value.page !== previous.page
   || typeof value.notes !== "string" || !value.notes.trim() || Buffer.byteLength(value.notes, "utf8") > 4096) {
   throw new Error(`previous_page_notes must identify page ${previous.page} and contain 1–4096 UTF-8 bytes of observations.`);
  }
  this.observations.set(previous.page, value.notes.trim());
  previous.recorded = true;
  return `Recorded observations (p. ${previous.page}):\n${value.notes.trim()}\n\n`;
 }

 attach(messages: Message[], message: Message, page: number): Message[] {
  if (this.current && page !== this.current.page && (!this.current.delivered || !this.current.recorded)) {
   throw new Error("A viewed page and its recorded observations are required before replacing its image.");
  }
  const retained = messages.filter(item => item !== this.current?.message);
  this.current = { page, message, delivered: false, recorded: false };
  return [...retained, message];
 }

 partialBrief(error: string): string {
  if (!this.observations.size) return `PDF failed: ${error}`;
  return `Partial PDF reading; ${error}\n\n` + [...this.observations].map(([page, text]) => `Page ${page} observations (p. ${page}):\n${text}`).join("\n\n");
 }
}
