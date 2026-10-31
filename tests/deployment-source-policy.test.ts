import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSourcePath } from "../src/agent/tools/fs-shared.ts";

test("configured source root permits relative reads and rejects traversal and symlink escapes", (t) => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"source-policy-"));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),"source-outside-"));
 const previous=process.env.LH_SOURCE_ROOT;
 try {
  process.env.LH_SOURCE_ROOT=root;
  fs.writeFileSync(path.join(root,"lesson.txt"),"synthetic lesson");
  fs.writeFileSync(path.join(outside,"private.txt"),"synthetic outside file");
  assert.equal(resolveSourcePath("lesson.txt"),fs.realpathSync(path.join(root,"lesson.txt")));
  assert.throws(()=>resolveSourcePath(path.join(outside,"private.txt")),/restricted/);
  assert.throws(()=>resolveSourcePath(path.relative(root,path.join(outside,"private.txt"))),/restricted/);
  try { fs.symlinkSync(path.join(outside,"private.txt"),path.join(root,"escape")); }
  catch(error) { if(process.platform==="win32"&&(error as NodeJS.ErrnoException).code==="EPERM"){t.diagnostic("Symlink check unavailable without Windows symlink privileges; traversal checks passed.");return;}throw error; }
  assert.throws(()=>resolveSourcePath("escape"),/restricted/);
 } finally { if(previous===undefined)delete process.env.LH_SOURCE_ROOT;else process.env.LH_SOURCE_ROOT=previous;fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true}); }
});