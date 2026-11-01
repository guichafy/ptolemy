import { describe, expect, it } from "vitest";
import { describeTool, shortPath } from "./tool-display";

describe("describeTool", () => {
	it("unwraps Codex shell commands", () => {
		expect(
			describeTool("Shell", { command: "bash -lc 'ls -la src'" }),
		).toMatchObject({ title: "Terminal", subtitle: "ls -la src" });
	});

	it("summarizes file tools with a short path", () => {
		expect(describeTool("Edit", { file_path: "/a/b/c/d/e.ts" }).subtitle).toBe(
			"…/d/e.ts",
		);
		expect(
			describeTool("ApplyPatch", {
				changes: [{ path: "/x/y/z/a.ts" }, { path: "/x/b.ts" }],
			}).subtitle,
		).toBe("…/z/a.ts +1");
	});

	it("counts completed plan items", () => {
		expect(
			describeTool("TodoWrite", {
				todos: [{ status: "completed" }, { status: "pending" }],
			}).subtitle,
		).toBe("1/2 concluídas");
	});

	it("names MCP tools by server and tool", () => {
		expect(describeTool("mcp__github__search_repos", {}).title).toBe(
			"github · search_repos",
		);
	});

	it("falls back to the raw name", () => {
		expect(describeTool("Mystery", undefined)).toEqual({
			title: "Mystery",
			icon: "generic",
		});
	});
});

describe("shortPath", () => {
	it("keeps short paths and trims long ones", () => {
		expect(shortPath("src/a.ts")).toBe("src/a.ts");
		expect(shortPath("/Users/me/p/src/a.ts")).toBe("…/src/a.ts");
		expect(
			shortPath(
				"/x/projects/crie-o-arquivo-ola-codex-txt-na-pasta-at-7c338d/ola.txt",
			),
		).toBe("…/crie-o-arquivo-ola-code…/ola.txt");
	});
});
