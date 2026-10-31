import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { downloadFile, slugFilename } from "../components/artifacts/download.ts";

test("generated active-document export refuses before creating a blob",()=>{
 const original=URL.createObjectURL;let attempts=0;
 URL.createObjectURL=()=>{attempts++;throw new Error("unexpected export");};
 try {
  for(const [name,mime] of [["figure.svg","image/svg+xml"],["demo.html","text/html"],["figure.txt","text/plain"]] as const)assert.throws(()=>downloadFile(name,"<svg onload='alert(1)'/>",mime),/downloads are disabled/);
  assert.equal(attempts,0);assert.equal(slugFilename("Example Figure"),"example-figure");
 }finally{URL.createObjectURL=original;}
});
test("artifact cards retain static display but remove raw-download controls",()=>{
 const dir=path.join(import.meta.dirname,"..","components","artifacts");
 for(const name of ["visual-card.tsx","demo-card.tsx"]){const source=fs.readFileSync(path.join(dir,name),"utf8");assert.ok(!source.includes("downloadFile"));assert.ok(!source.includes("DownloadIcon"));}
 const figure=fs.readFileSync(path.join(dir,"visual-card.tsx"),"utf8");assert.ok(figure.includes("SvgImage"));assert.ok(figure.includes("overlay.openFigure"));
});