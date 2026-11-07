/**
 * The prompt-override STORE (settings-storage wave, 2026-09-19; P2
 * reconciliation same day): the override-file CRUD behind the core port —
 * list/read/write/delete under config.promptsOverrideDir().
 *
 * The CANONICAL segment discovery + resolution (listSourceSegments,
 * effectivePromptSegments, allSegmentPaths) lives in the agent layer
 * (src/agent/prompt-segments.ts) — composition is an agent concern, and
 * the architecture law pins the layers apart (store may not import agent;
 * agent may not import store). Both sides share the pure path grammar
 * (src/core/prompt-segments.ts); the store's readOverride and the agent's
 * readPromptOverride read the SAME mirror layout.
 *
 * SEGMENTS: a prompt composes from the SHARED base
 * (src/agent/system-prompt.md), the shared/ fragments (composed by both
 * agents), plus every numeric-prefix *.md fragment in the agent's own
 * directory — see the agent module for the full rules.
 *
 * OVERRIDES: override files mirror the source layout under
 * config.promptsOverrideDir() — "system-prompt.md" at the root,
 * "shared/<file>", "teacher/<file>" / "prober/<file>" (POSIX-relative
 * paths, the same keys as the settings record's agent.prompts switches).
 * File presence is NOT the override: the switch is (owner decision) — the
 * user keeps their file and flips back to the source default to compare.
 *
 * Path discipline: only .md under the override dir, no traversal (no "..",
 * absolute, or empty segments) — a hand-crafted path outside the mirror
 * layout is rejected (null / no-op), never written.
 */

import fs from "node:fs";
import path from "node:path";
import { promptsOverrideDir } from "../../config.ts";
import { courseStatePath } from "../runtime/course-context.ts";
import { isValidSegmentPath } from "../core/prompt-segments.ts";
import type { PromptMode } from "../core/prompt-segments.ts";
import { promptCustomizationFile, readPromptCustomization, promptStoreDirectory } from "../runtime/prompt-customizations.ts";
import type { PromptOverrideStore } from "../core/ports.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

/** Absolute path for an override file (unchecked — validate first). */
/** The store adapter (core/ports.ts). */
export const promptOverrides: PromptOverrideStore = {
	listOverrides(): string[] {
		const out: string[] = [];
		const walk = (dir: string, prefix: string) => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(promptStoreDirectory(dir), { withFileTypes: true });
			} catch {
				return; // no dir yet = no overrides
			}
			for (const entry of entries) {
				if (entry.name === ".additions") continue;
				const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
				else if (entry.isFile() && entry.name.endsWith(".md") && isValidSegmentPath(rel)) out.push(rel);
			}
		};
		walk(promptsOverrideDir(), "");
		walk(path.join(promptsOverrideDir(), ".additions"), "");
		return [...new Set(out)].filter(segment => readPromptCustomization(segment) !== null).sort();
	},

	readOverride(segmentPath: string): string | null {
		return readPromptCustomization(segmentPath)?.text ?? null;
	},

	writeOverride(segmentPath: string, text: string, mode: PromptMode = "replace"): void {
		if (!isValidSegmentPath(segmentPath)) return;
		const file = promptCustomizationFile(segmentPath, mode);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		writeFileAtomicSync(file, text, { allowInPlaceFallback: true });
		if (mode === "replace") {
			// Publish the replacement first, then remove the addition. A
			// crash before removal leaves the source-preserving addition active.
			const addition = promptCustomizationFile(segmentPath, "append");
			try { fs.unlinkSync(addition); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
			removeLeftoverTemps(addition);
		}
	},

	deleteOverride(segmentPath: string): void {
		if (!isValidSegmentPath(segmentPath)) return;
		for (const mode of ["append", "replace"] as const) {
			const file = promptCustomizationFile(segmentPath, mode);
			try { fs.unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
			removeLeftoverTemps(file);
		}
	},
};
