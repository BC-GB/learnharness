import { getPluginHost } from "./plugins.ts";
export async function optionalPluginCall(id: string, operation: string, input?: unknown) {
 const host = await getPluginHost(); return host.call(id, operation, input);
}
