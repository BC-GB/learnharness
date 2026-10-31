import assert from "node:assert/strict";
import test from "node:test";
import { createPdfReadTools } from "../src/agent/tools/pdf-read.ts";
import { createWebTools } from "../src/agent/tools/web.ts";
import { fakePublicFetch } from "./public-fetch-fixture.ts";
test("PDF download refuses before making a network request", async () => {
 let calls = 0;
 const restore = fakePublicFetch(() => { calls++; throw new Error("unexpected request"); });
 try {
  const tools = createPdfReadTools("/unused");
  for (const url of ["https://example.com/test.pdf", "https://127.0.0.1/private.pdf", "file:///secret"]) {
   const result = await tools.web_fetch_pdf!.execute("test", { url });
   assert.match(JSON.stringify(result), /disabled/);
  }
  assert.equal(calls, 0);
 } finally { restore(); }
});
test("web retrieval reports disabled PDF processing and retains source attribution for text", async () => {
 const restore = fakePublicFetch(url => new Response("Synthetic source", { headers: { "content-type": url.endsWith(".pdf") ? "application/pdf" : "text/plain" } }));
 try {
  const tools = createWebTools(() => null);
  assert.match(JSON.stringify(await tools.web_fetch!.execute("pdf", { url: "https://example.com/test.pdf" })), /PDF processing is disabled/);
  assert.match(JSON.stringify(await tools.web_fetch!.execute("text", { url: "https://example.com/text" })), /Source: https:\/\/example.com\/text/);
 } finally { restore(); }
});
