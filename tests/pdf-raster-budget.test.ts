import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPdfRasters } from "../src/agent/subagents/pdf-raster.ts";

test("five scan pages keep separate IPC budgets, order and requested DPI when it fits", async () => {
 let active = 0;
 const seen: number[] = [];
 const result = await renderPdfRasters("scan", [1, 2, 3, 4, 5], 150, async request => {
  assert.equal(active++, 0); assert.equal(request.pages.length, 1); assert.equal(request.dpi, 150);
  const page = request.pages[0]!; seen.push(page); await Promise.resolve(); active--;
  return [{ page, png: "page-" + page }];
 });
 assert.deepEqual(seen, [1, 2, 3, 4, 5]); assert.deepEqual(result.map(page => page.page), seen);
});

test("oversized scan retries lower DPI without dropping or duplicating page identities", async () => {
 const seen: [number, number][] = [];
 const result = await renderPdfRasters("scan", [2, 5], 150, async request => {
  const page = request.pages[0]!; seen.push([page, request.dpi]);
  if (request.dpi > (page === 2 ? 72 : 36)) throw new Error("Isolated rendering failed.");
  return [{ page, png: "visible-annotations" }];
 });
 assert.deepEqual(seen, [[2, 150], [2, 72], [5, 150], [5, 72], [5, 36]]);
 assert.deepEqual(result.map(page => page.page), [2, 5]);
 assert.deepEqual(result.map(page => page.dpi), [72, 36]);
});

test("Stop prevents further pages and fallback after the current worker finishes", async () => {
 const controller = new AbortController(); let calls = 0;
 await assert.rejects(renderPdfRasters("scan", [1, 2], 150, async () => {
  calls++; controller.abort(); throw new Error("Isolated rendering failed.");
 }, controller.signal), { name: "AbortError" });
 assert.equal(calls, 1);
});

test("render deadlines can fall back, while queue, cancellation and transport failures do not retry", async () => {
 for (const message of ["Isolated renderer timed out.", "Renderer output too large."]) {
  const seen: number[] = [];
  await renderPdfRasters("scan", [1], 100, async request => {
   seen.push(request.dpi); if (request.dpi === 100) throw new Error(message);
   return [{ page: 1, png: "readable" }];
  });
  assert.deepEqual(seen, [100, 72]);
 }
 for (const error of [new Error("Renderer queue is full. Try again when current imports finish."), new DOMException("Stopped", "AbortError"), new Error("connect ENOENT"), new Error("Invalid renderer response.")]) {
  let calls = 0;
  await assert.rejects(renderPdfRasters("scan", [1], 150, async () => { calls++; throw error; }), error);
  assert.equal(calls, 1);
 }
});

test("fallback is finite and malformed page responses cannot be counted as read", async () => {
 let calls = 0;
 await assert.rejects(renderPdfRasters("scan", [1], 150, async () => { calls++; throw new Error("Isolated rendering failed."); }), /Isolated rendering failed/);
 assert.equal(calls, 3);
 for (const response of [[], [{ page: 2, png: "wrong page" }], [{ page: 1, png: "" }]]) {
  await assert.rejects(renderPdfRasters("scan", [1], 150, async () => response), /Invalid renderer response/);
 }
});

test("the existing page and DPI ceilings remain enforced before dispatch", async () => {
 let calls = 0; const request = async () => { calls++; return []; };
 for (const pages of [[], [0], [201], [1.5], Array(9).fill(1)]) await assert.rejects(renderPdfRasters("scan", pages, 120, request), /page selection/);
 for (const dpi of [0, 35, 201, NaN, Infinity]) await assert.rejects(renderPdfRasters("scan", [1], dpi, request), /DPI/);
 assert.equal(calls, 0);
});
