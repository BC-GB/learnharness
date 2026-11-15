import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
/** Canonical ancestor guard applies before every read/write, including legacy fallback. */
export function safePath(root: string, relative: string): string {
 if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === "." || p === ".." || p.startsWith("."))) throw new Error("Invalid plugin record path");
 const target = path.join(root, relative); let at = target;
 for (;;) {
  try { if (fs.realpathSync(at) !== path.resolve(at)) throw new Error("Aliased plugin records"); break; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const parent = path.dirname(at); if (parent === at) throw new Error("Record directory unavailable"); at = parent;
 }
 return target;
}
export function atomicWrite(target: string, text: string) {
 const temp = target + "." + randomUUID() + ".tmp";
 try { fs.writeFileSync(temp, text, { flag: "wx", mode: 0o600 }); fs.renameSync(temp, target); }
 finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
