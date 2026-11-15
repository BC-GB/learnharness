import { normalizeContext } from "@earendil-works/pi-ai";
import type { PluginInference } from "../src/core/plugins.ts";
import type { PiEngine } from "../src/agent/models.ts";
export const inferenceFor = (engine: Pick<PiEngine, "model" | "streamFn">): PluginInference => ({ catalog: async () => { throw Error("Fixture has no catalog"); }, stream: () => { throw Error("Fixture uses completion"); }, complete: request => engine.streamFn(engine.model, normalizeContext(request.context), { ...request.options, signal: request.signal }).result() });
