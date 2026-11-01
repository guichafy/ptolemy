import { describe, expect, it } from "vitest";
import { normalizePackage } from "./manifests";

import { records, skill } from "./test-fixtures";

describe("complete plugin declarations", () => {
	it("preserves explicit skills, root assets, native metadata and all component kinds", () => {
		const files = records({
			".claude-plugin/plugin.json": JSON.stringify({
				name: "demo",
				skills: ["./skills/one"],
				commands: "./custom",
				agents: "./agents",
				hooks: "./hooks/hooks.json",
				mcpServers: "./config/mcp.json",
				apps: "./.app.json",
				lspServers: { ts: { command: "tsserver" } },
				outputStyles: "./styles",
				futureConnector: { id: "unknown" },
			}),
			"skills/one/SKILL.md": skill("one"),
			"skills/two/SKILL.md": skill("two"),
			"custom/run.md": "---\nargument-hint: [file]\n---\nRun $ARGUMENTS",
			"agents/reviewer.md": "---\nmodel: sonnet\ntools: Read\n---\nReview",
			"hooks/hooks.json": JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{
									type: "command",
									// biome-ignore lint/suspicious/noTemplateCurlyInString: Package placeholders must remain unexpanded.
									command: "${CLAUDE_PLUGIN_ROOT}/scripts/check.sh",
									timeout: 10,
								},
							],
						},
					],
				},
			}),
			"config/mcp.json": JSON.stringify({
				mcpServers: {
					api: {
						command: "node",
						args: ["./server.js"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: Package placeholders must remain unexpanded.
						env: { TOKEN: "${TOKEN}" },
					},
				},
			}),
			".app.json": JSON.stringify({ apps: [{ id: "proprietary" }] }),
			"styles/style.md": "style",
			"scripts/check.sh": "echo ok",
			"assets/logo.png": "image",
		});
		const result = normalizePackage(files, "demo");
		expect(
			result.components.filter((c) => c.kind === "skill").map((c) => c.name),
		).toEqual(["one"]);
		expect(new Set(result.components.map((c) => c.kind))).toEqual(
			new Set(["skill", "command", "agent", "hook", "mcp", "other"]),
		);
		expect(
			result.components.find((c) => c.kind === "skill")?.definition,
		).toMatchObject({
			metadata: { "user-invocable": false, "allowed-tools": ["Read", "Bash"] },
		});
		expect(
			result.components.find((c) => c.kind === "hook")?.definition,
		).toMatchObject({ event: "PreToolUse", matcher: "Bash" });
		expect(
			result.components.find((c) => c.kind === "mcp")?.definition,
		).toMatchObject({ config: { command: "node", args: ["./server.js"] } });
		expect(
			result.components.filter((c) => c.kind === "other").map((c) => c.name),
		).toEqual(
			expect.arrayContaining([
				"apps",
				"lspServers",
				"outputStyles",
				"futureConnector",
			]),
		);
		expect(
			result.diagnostics.some(
				(d) => d.code === "unknown-component" && d.path === "futureConnector",
			),
		).toBe(true);
	});
	it.each([
		false,
		true,
	])("accepts direct and wrapped MCP maps (%s)", (wrapped) => {
		const mcp = { api: { url: "https://example.test/mcp" } };
		const result = normalizePackage(
			records({
				"plugin.json": '{"name":"demo"}',
				".mcp.json": JSON.stringify(wrapped ? { mcpServers: mcp } : mcp),
			}),
			"demo",
		);
		expect(result.components.find((c) => c.kind === "mcp")?.name).toBe("api");
	});
	it("accepts portable and Codex roots with explicit directory skills", () => {
		for (const manifest of ["plugin.json", ".codex-plugin/plugin.json"]) {
			const result = normalizePackage(
				records({
					[manifest]: JSON.stringify({ name: "demo", skills: "./skills/" }),
					"skills/one/SKILL.md": skill("one"),
				}),
				"demo",
			);
			expect(result.components[0]).toMatchObject({
				kind: "skill",
				name: "one",
			});
		}
	});
	it("diagnoses missing, nested, escaping references and malformed metadata without hiding siblings", () => {
		const result = normalizePackage(
			records({
				"plugin.json": JSON.stringify({
					name: "demo",
					skills: ["../outside", "./missing", "./skills/one"],
					mcpServers: "./first.json",
				}),
				"skills/one/SKILL.md": skill("one"),
				"first.json": JSON.stringify({ mcpServers: "./second.json" }),
				"second.json": '{"api":{"command":"node"}}',
			}),
			"demo",
		);
		expect(
			result.components.some((c) => c.kind === "skill" && c.name === "one"),
		).toBe(true);
		expect(result.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining([
				"unsafe-reference",
				"missing-reference",
				"nested-reference",
			]),
		);
	});
	it("keeps individual skill limits and diagnoses invalid declarations", () => {
		const result = normalizePackage(
			records({
				"plugin.json": JSON.stringify({
					skills: 17,
					hooks: {
						hooks: { PreToolUse: [{ hooks: [{ type: "future", thing: 1 }] }] },
					},
				}),
				"skills/one/SKILL.md": "invalid",
			}),
			"demo",
		);
		expect(result.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining([
				"invalid-declaration",
				"unsupported-hook-handler",
			]),
		);
	});
});

describe("package review and credential boundaries", () => {
	it("retains unsupported command and agent declarations as visible components", () => {
		const result = normalizePackage(
			records({
				"plugin.json": JSON.stringify({
					name: "demo",
					commands: { named: { prompt: "hello" } },
					agents: 17,
				}),
			}),
			"demo",
		);
		expect(result.components.map((c) => c.kind)).toEqual(
			expect.arrayContaining(["command", "agent"]),
		);
		expect(
			result.components.every((c) =>
				c.diagnostics.some((d) => d.code === "invalid-declaration"),
			),
		).toBe(true);
	});
	it("discovers apps, LSP and output styles without losing directory definitions", () => {
		const result = normalizePackage(
			records({
				"plugin.json": '{"name":"demo","outputStyles":"./output-styles"}',
				".app.json": '{"apps":[{"id":"app_123"}]}',
				".lsp.json": '{"ts":{"command":"tsserver"}}',
				"output-styles/style.md": "Style prompt",
			}),
			"demo",
		);
		expect(
			result.components.filter((c) => c.kind === "other").map((c) => c.name),
		).toEqual(expect.arrayContaining(["apps", "lspServers", "outputStyles"]));
		expect(result.diagnostics.some((d) => d.code === "missing-reference")).toBe(
			false,
		);
	});
	it("reports literal credentials even in MCP declarations hidden by explicit paths", () => {
		const result = normalizePackage(
			records({
				"plugin.json": '{"name":"demo","mcpServers":"./config/mcp.json"}',
				"config/mcp.json": '{"api":{"command":"node"}}',
				".mcp.json":
					'{"hidden":{"url":"https://example.test","headers":{"Authorization":"Bearer sensitive"}}}',
			}),
			"demo",
		);
		expect(result.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
			true,
		);
	});
	it("accepts environment references while rejecting literal credential headers and URLs", () => {
		for (const config of [
			{
				url: "https://example.test",
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Package placeholders must remain unexpanded.
				headers: { Authorization: "Bearer ${TOKEN}" },
			},
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Package placeholders must remain unexpanded.
			{ command: "node", env: { API_KEY: "${API_KEY}" } },
		]) {
			const result = normalizePackage(
				records({
					"plugin.json": JSON.stringify({ mcpServers: { api: config } }),
				}),
				"demo",
			);
			expect(result.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
				false,
			);
		}
		for (const config of [
			{ url: "https://token:password@example.test" },
			{ url: "https://example.test?api_key=secret" },
			{ url: "https://example.test", headers: { "X-API-Key": "secret" } },
		]) {
			const result = normalizePackage(
				records({
					"plugin.json": JSON.stringify({ mcpServers: { api: config } }),
				}),
				"demo",
			);
			expect(result.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
				true,
			);
		}
	});
	it("keeps invalid and oversized Skill siblings visible", () => {
		const result = normalizePackage(
			records({
				"plugin.json": '{"name":"demo"}',
				"skills/one/SKILL.md": skill("one"),
				"skills/bad/SKILL.md": "bad",
				"skills/one/huge.bin": "x".repeat(1024 * 1024 + 1),
			}),
			"demo",
		);
		expect(result.components.filter((c) => c.kind === "skill")).toHaveLength(2);
		expect(
			result.diagnostics.filter((d) => d.code === "invalid-skill"),
		).toHaveLength(2);
	});
});
