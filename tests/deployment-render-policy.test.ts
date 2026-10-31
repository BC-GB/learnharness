import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import test from "node:test";

test("disabled browser/PDF policies stop execution before native imports and preserve static SVG",async()=>{
 const names=["LH_BROWSER_ENGINE","LH_DISABLE_PDF_RENDERING","LH_DISABLE_PDF_PROCESSING"] as const;
 const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 delete process.env.LH_BROWSER_ENGINE;delete process.env.LH_DISABLE_PDF_RENDERING;delete process.env.LH_DISABLE_PDF_PROCESSING;
 let launches=0,pdfImports=0;const original=childProcess.spawn;
 childProcess.spawn=((..._args: unknown[])=>{launches++;throw new Error("unexpected browser launch");}) as typeof childProcess.spawn;
 syncBuiltinESMExports();
 const hook=registerHooks({resolve(specifier,context,next){if(specifier.startsWith("@napi-rs/canvas")||specifier.startsWith("pdfjs-dist")){pdfImports++;throw new Error("unexpected PDF native import");}return next(specifier,context);}});
 try {
  const {realHeadless,browserServiceBinary}=await import("../src/agent/subagents/headless.ts");
  const pdf=await import("../src/agent/subagents/pdf-ops.ts");
  assert.equal(realHeadless.available(),false);assert.equal(browserServiceBinary(),null);
  await assert.rejects(realHeadless.runDemo("<script>alert(1)</script>"),/disabled by deployment policy/);
  await assert.rejects(realHeadless.renderSvg("<svg><unclosed>"),/disabled by deployment policy/);
  await assert.rejects(realHeadless.renderPdfPages("does-not-exist.pdf",[1]),/rasterization is disabled/);
  for(const run of [()=>pdf.pdfProbe("does-not-exist.pdf"),()=>pdf.pdfInfo("does-not-exist.pdf"),()=>pdf.pdfExtract("does-not-exist.pdf","all"),()=>pdf.pdfSearch("does-not-exist.pdf","example")])await assert.rejects(run(),/PDF processing is disabled/);
  const png=await realHeadless.renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>');
  assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");assert.equal(launches,0);assert.equal(pdfImports,0);
 }finally{hook.deregister();childProcess.spawn=original;syncBuiltinESMExports();for(const name of names){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
