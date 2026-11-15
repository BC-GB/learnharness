import { courseRoute, uploadChatPdf, chatPdfResponse } from "@/src/server";

export const runtime = "nodejs";
export const POST = courseRoute(uploadChatPdf);
export const GET = courseRoute(chatPdfResponse);
