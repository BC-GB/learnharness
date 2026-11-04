import assert from "node:assert/strict";
import { test } from "node:test";
import { validatedNativeSvg } from "../src/agent/subagents/native-svg-resources.ts";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`;

test("native previews accept static marks and the bounded learner raster", () => {
	assert.match(validatedNativeSvg(svg('<text x="1" y="2">β₁</text>')), /β₁/);
	assert.match(validatedNativeSvg(svg(`<image href="data:image/png;base64,${png}" width="1" height="1"/>`)), /data:image\/png/);
	assert.match(validatedNativeSvg(svg('<defs><marker id="arrow"/></defs><path marker-end="url(#arrow)" d="M0 0L1 1"/>')), /url\(#arrow\)/);
});

for (const body of [
	'<image href="file:///state/data/graph/nodes.jsonl"/>',
	'<image href="http://192.168.1.1/secret"/>',
	'<image href="&#102;ile:///etc/passwd"/>',
	'<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
	'<image href="data:image/png;base64,AAAA"/>',
	`<image href="data:image/png;base64,${png}"/><image href="data:image/png;base64,${png}"/>`,
	'<script>alert(1)</script>',
	'<foreignObject><iframe src="http://127.0.0.1"/></foreignObject>',
	'<path fill="url(file:///etc/passwd)"/>',
	'<style>@import "http://example.invalid/x";</style>',
	'<image xmlns:z="http://www.w3.org/1999/xlink" z:href="file:///etc/passwd"/>',
	'<rect onclick="alert(1)"/>',
]) test(`native SVG refuses unsafe resource ${body.slice(0, 65)}`, () => assert.throws(() => validatedNativeSvg(svg(body))));

test("native SVG refuses external entities before parsing", () => {
	assert.throws(() => validatedNativeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+svg("&x;")));
});
