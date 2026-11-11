import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { DEFAULT_SETTINGS, FAMILIES, INSTRUCTIONS, parseChange, parseSettings, type Settings } from "./contract.ts";

export function activate(ctx: PluginBackendContext): () => void {
  const file = path.join(ctx.dataDirectory, "settings.json");
  let settings: Settings;
  try { settings = ctx.preferences ? parseSettings(ctx.preferences.read() ?? DEFAULT_SETTINGS) : parseSettings(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    settings = { ...DEFAULT_SETTINGS };
  }
  const projectedSettings = (): Settings => ctx.browserWorkersAvailable === false
    ? { ...settings, technicalDiagrams: false, technicalDiagramsUnavailable: true } : { ...settings };
  const instructionDisposers: (() => void)[] = [];
  const updateInstructions = () => {
    instructionDisposers.splice(0).forEach(dispose => dispose());
    for (const family of FAMILIES) if (settings[family] && !(family === "technicalDiagrams" && ctx.browserWorkersAvailable === false)) {
      instructionDisposers.push(ctx.registerInstructions({ agents: ["prober", "teacher", "practice"], text: INSTRUCTIONS[family] }));
    }
  };
  const assertActive = () => { if (ctx.signal.aborted) throw new Error("Rich code blocks is disabled."); };
  updateInstructions();
  const offPreferences = ctx.preferences?.subscribe(() => {
    settings = parseSettings(ctx.preferences!.read() ?? DEFAULT_SETTINGS);
    updateInstructions();
    ctx.events.emit("settings-changed", projectedSettings());
  });
  const unregisterGet = ctx.handle("get-settings", () => { assertActive(); return projectedSettings(); });
  const nextRevision = () => {
    if (settings.revision === Number.MAX_SAFE_INTEGER) throw new Error("Settings revision limit reached.");
    return settings.revision + 1;
  };
  const commit = (next: Settings, instructionsChanged = false) => {
    if (ctx.preferences) { ctx.preferences.write(next); return projectedSettings(); }
    fs.mkdirSync(ctx.dataDirectory, { recursive: true });
    const temporary = path.join(ctx.dataDirectory, `.settings-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(next) + "\n", { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
    settings = next;
    if (instructionsChanged) updateInstructions();
    ctx.events.emit("settings-changed", projectedSettings());
    return projectedSettings();
  };
  const unregisterSave = ctx.handle("set-family", input => {
    assertActive();
    const { family, enabled } = parseChange(input);
    if (family === "technicalDiagrams" && enabled && ctx.browserWorkersAvailable === false) throw new Error("Technical diagrams are unavailable under this deployment’s browser security policy. No browser permission has been changed.");
    if (settings[family] === enabled) return projectedSettings();
    return commit({ ...settings, revision: nextRevision(), [family]: enabled }, true);
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    offPreferences?.(); unregisterGet(); unregisterSave();
    instructionDisposers.splice(0).forEach(dispose => dispose());
  };
}
