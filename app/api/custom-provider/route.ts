import { courseRoute } from "@/src/server";
/** PR #62's single custom endpoint: discover/manual connect, offline pins,
 * and disconnect. Host boundaries and mutations live behind the server barrel. */
import { customProviderGet, customProviderMutation } from "@/src/server";

export const dynamic = "force-dynamic";
export const GET = courseRoute(customProviderGet);
export const POST = courseRoute(customProviderMutation);
export const PATCH = courseRoute(customProviderMutation);
export const DELETE = courseRoute(customProviderMutation);
