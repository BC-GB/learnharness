import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOutlineModelSpec, resolveRoleSpec, resolveSettings } from "../src/core/settings-resolution.ts";
import { sanitizeUserSettings, type UserSettings } from "../src/core/settings.ts";
import { parseGeneralSettingsBody } from "../src/server/settings-body.ts";

const original: UserSettings = { version: 1, general: { autoUpdate: false, lessonOutline: true },
	models: { strong: { model: { provider: "teacher-provider", id: "teacher-model" }, thinkingLevel: "high" }, cheap: { model: { provider: "background-provider", id: "background-model" }, thinkingLevel: "low" } },
	agent: { models: { extractor: { model: { provider: "extractor-provider", id: "extractor-model" }, thinkingLevel: "medium" } } } };

test("outline defaults preserve the actual configured background extraction choice", () => {
	assert.deepEqual(resolveOutlineModelSpec(original), resolveRoleSpec("extractor", original));
	assert.deepEqual(resolveOutlineModelSpec({ version: 1 }), undefined);
});
test("independent model/reasoning changes preserve teacher, extractor and other settings", () => {
	const before = JSON.stringify(original); const preference = { model: { provider: "outline-provider", id: "outline-model" }, thinkingLevel: "off" as const };
	const next = { ...original, general: { ...original.general, outlineModel: preference } };
	assert.deepEqual(resolveOutlineModelSpec(next), { provider: "outline-provider", id: "outline-model", thinkingLevel: "off" });
	assert.deepEqual(resolveRoleSpec("extractor", next), resolveRoleSpec("extractor", original));
	assert.deepEqual(resolveRoleSpec("teacher", next), resolveRoleSpec("teacher", original));
	assert.deepEqual(resolveSettings(next).general.outlineModel, preference); assert.equal(JSON.stringify(original), before);
	assert.deepEqual(resolveOutlineModelSpec({ ...original, general: { ...original.general, outlineModel: { thinkingLevel: "high" } } }), { provider: "extractor-provider", id: "extractor-model", thinkingLevel: "high" });
});
test("outline preferences parse and survive sanitization without changing factory defaults", () => {
	const general = { ...original.general, outlineModel: { model: { provider: "openai", id: "fixture-model" }, thinkingLevel: "low" as const } };
	const parsed = parseGeneralSettingsBody(general); assert.ok(parsed.ok); assert.deepEqual(parsed.settings, general);
	assert.deepEqual(sanitizeUserSettings({ version: 1, general })!.general, general);
	assert.deepEqual(resolveSettings({ version: 1 }).general, { autoUpdate: true });
	for (const outlineModel of [null, "model", { model: { provider: "openai" } }, { thinkingLevel: 17 }]) assert.equal(parseGeneralSettingsBody({ outlineModel }).ok, false);
});
