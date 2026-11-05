import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

/** Catch first-class transport references as well as direct calls: passing
 * the browser's fetch into SessionStarter once bypassed course scoping even
 * though the home component contained no fetch("/api/...") expression. */
test("browser components cannot use an unscoped global fetch, including callback arguments", () => {
	const failures: string[] = [];
	const inspect = (file: string) => {
		const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
		if (relative === "lib/course-client.ts") return; // the single native transport adapter
		const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
		const scopedImport = source.statements.some(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.endsWith("/course-client") && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) && statement.importClause.namedBindings.elements.some(binding => binding.name.text === "fetch" && binding.propertyName?.text === "courseFetch"));
		const report = (node: ts.Node) => failures.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
		const visit = (node: ts.Node): void => {
			if (ts.isTypeQueryNode(node) || ts.isImportDeclaration(node)) return;
			if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ["globalThis", "window", "self"].includes(node.expression.text) && node.name.text === "fetch") report(node);
			if (ts.isIdentifier(node) && node.text === "fetch" && !scopedImport) {
				const parent = node.parent;
				const propertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || ((ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)) && parent.name === node);
				if (!propertyName) report(node);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	};
	const walk = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) walk(file); else if (/\.tsx?$/.test(entry.name)) inspect(file); } };
	for (const directory of ["components", "lib"]) walk(path.join(process.cwd(), directory));
	assert.deepEqual(failures, [], "Use courseFetch for browser app requests; type-only and injected transport fields remain valid.");
});
