import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
import { extensionRequestHandlers } from "./ui-service";

test("all three schemas consume the same extension request contract and expose no plaintext v1 methods", () => {
	const root = resolve(import.meta.dirname, "../../..");
	for (const path of [
		"src/bun/rpc.ts",
		"src/mainview/providers/rpc.ts",
		"src/chatview/rpc.ts",
	]) {
		const source = readFileSync(resolve(root, path), "utf8");
		expect(source).toMatch(/requests: ExtensionRequests &/);
		expect(source).not.toMatch(/agent(?:List|Save)McpServers/);
		expect(source).toMatch(/"extensions"/);
	}
	const text = readFileSync(
		resolve(root, "src/shared/extension-rpc.ts"),
		"utf8",
	);
	const ast = ts.createSourceFile("rpc.ts", text, ts.ScriptTarget.Latest, true);
	const decl = ast.statements.find(
		(s) => ts.isTypeAliasDeclaration(s) && s.name.text === "ExtensionRequests",
	) as ts.TypeAliasDeclaration;
	const members = (decl.type as ts.TypeLiteralNode).members.map(
		(m) => (m.name as ts.Identifier).text,
	);
	expect(members.sort()).toEqual(
		[
			...Object.keys(extensionRequestHandlers),
			"agentSessionCommands",
			"agentSessionResources",
		].sort(),
	);
});
