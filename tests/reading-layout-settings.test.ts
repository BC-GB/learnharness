import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { parseAppearanceSettingsBody } from "../src/server/settings-body.ts";
import { DEFAULT_THEME } from "../src/core/themes.ts";
import { appearanceVars, resolveAppearance } from "../components/settings/appearance.tsx";

describe("saved reading layout", () => {
	it("preserves a left-aligned custom width through parse, persistence and both resolvers", () => {
		const parsed = parseAppearanceSettingsBody({ readingWidth: 960, readingCentered: false, proseFontSize: 18 });
		assert.ok(parsed.ok);
		const stored = sanitizeUserSettings(JSON.parse(JSON.stringify({ version: 1, appearance: parsed.settings })));
		assert.ok(stored);
		assert.equal(stored.appearance?.proseFontSize, 18);
		const effective = resolveSettings(stored).appearance;
		assert.equal(effective.readingWidth, 960);
		assert.equal(effective.readingCentered, false);
		const client = resolveAppearance(stored.appearance);
		assert.equal(client.readingWidth, effective.readingWidth);
		assert.equal(client.readingCentered, effective.readingCentered);
		const vars = appearanceVars(client, DEFAULT_THEME);
		assert.equal(vars["--lh-reading-width"], "960px");
		assert.equal(vars["--lh-reading-margin"], "0px");
	});

	it("rejects malformed API writes and safely normalizes corrupt stored widths", () => {
		for (const readingWidth of ["900", "900px; background:url(https://example.invalid)", null, NaN, Infinity, 559, 1201, 800.5]) {
			assert.equal(parseAppearanceSettingsBody({ readingWidth }).ok, false);
		}
		for (const readingCentered of ["false", 0, null]) {
			assert.equal(parseAppearanceSettingsBody({ readingCentered }).ok, false);
		}
		for (const width of [560, 1200]) assert.equal(parseAppearanceSettingsBody({ readingWidth: width }).ok, true);
		const stored = sanitizeUserSettings({ version: 1, appearance: { readingWidth: 99999, readingCentered: false } });
		assert.equal(stored?.appearance?.readingWidth, 1200);
		assert.equal(stored?.appearance?.readingCentered, false);
	});

	it("uses the wider centred default for existing records and resets", () => {
		for (const appearance of [undefined, {}]) {
			const client = resolveAppearance(appearance);
			assert.equal(client.readingWidth, 864);
			assert.equal(client.readingCentered, true);
			assert.equal(appearanceVars(client, DEFAULT_THEME)["--lh-reading-margin"], "auto");
		}
		const parsed = parseAppearanceSettingsBody({});
		assert.ok(parsed.ok);
		assert.deepEqual(parsed.settings, {});
	});
});
