import { courseRoute, uploadPastedImage, pastedImageResponse } from "@/src/server";

export const runtime = "nodejs";
export const POST = courseRoute(uploadPastedImage);
export const GET = courseRoute(pastedImageResponse);
