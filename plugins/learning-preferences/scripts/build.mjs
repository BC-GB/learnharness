import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
const root = path.resolve(import.meta.dirname, "..");
const dependencyRoot = fs.realpathSync(path.join(root, "../../node_modules"));
const inside = (file, directory) => { const relative = path.relative(directory, file); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); };
const output = path.join(root, "dist");
if (fs.lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Aliased build output");
fs.mkdirSync(output, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
for (const [entry, platform, format] of [["main", "browser", "esm"], ["backend", "node", "cjs"]]) {
 if (!manifest[entry]) continue;
 const result = await build({ absWorkingDir: root, entryPoints: ["src/" + entry + (entry === "main" ? ".tsx" : ".ts")], outfile: path.join(output, manifest[entry]), bundle: true, minify: true, platform, format, target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: platform === "node" ? ["node:*"] : [], metafile: true });
 for (const name of Object.keys(result.metafile.inputs)) { const file = fs.realpathSync(path.resolve(root, name)); if (!inside(file, path.join(root, "src")) && !inside(file, dependencyRoot)) throw new Error("Private runtime import: " + name); }
}
fs.copyFileSync(path.join(root, "manifest.json"), path.join(output, "manifest.json"));
fs.copyFileSync(path.join(root, "README.md"), path.join(output, "README.md"));
