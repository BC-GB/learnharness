import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { BASE_DATA_ROOT } from "../../config.ts";
import { sharedPreferencePath } from "../runtime/global-preferences-path.ts";
import { AsyncResource } from "node:async_hooks";
import type { PluginBackendContext } from "../core/plugins.ts";

type Preferences = NonNullable<PluginBackendContext["preferences"]>;
interface Global { __lhCorePreferenceListeners?: Map<string, Set<() => void>> }
/** Explicit reviewed core IDs only. No general filesystem or path capability. */
export function createCorePluginPreferences(id: string, root = BASE_DATA_ROOT): Preferences | undefined {
 if (!["drawing-pad", "rich-code-blocks", "flashcards"].includes(id)) return undefined;
 const filename = () => sharedPreferencePath(root, `global-plugin-${id}.json`);
 const global = globalThis as typeof globalThis & Global;
 const registry = global.__lhCorePreferenceListeners ??= new Map();
 const key = filename();
 let listeners = registry.get(key);
 if (!listeners) { listeners = new Set(); registry.set(key, listeners); }
 return {
  read() {
   try { return JSON.parse(fs.readFileSync(filename(), "utf8")); }
   catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  },
  write(value) {
   const text = JSON.stringify(value);
   if (!text || Buffer.byteLength(text) > 16 * 1024) throw new Error("Invalid or oversized plugin preferences.");
   const file = filename(), temporary = `${file}.${randomUUID()}.tmp`;
   try { fs.writeFileSync(temporary, text, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); }
   finally { try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
   for (const listener of [...listeners!]) { try { listener(); } catch { console.error("[plugins] Preference observer failed; reload the affected plugin."); } }
  },
  subscribe(listener) {
   // Bind even an unbound startup context: legacy must not borrow the emitter course.
   const bound = AsyncResource.bind(listener);
   listeners!.add(bound);
   return () => { listeners!.delete(bound); };
  },
 };
}
