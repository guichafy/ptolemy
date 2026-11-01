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

describe("review regressions: complete declarations and safe diagnostics", () => {
	it("inventories every native and portable manifest with harness provenance and explicit Skill constraints", () => {
		const result = normalizePackage(
			records({
				".claude-plugin/plugin.json": JSON.stringify({
					name: "demo",
					skills: ["./skills/one"],
					mcpServers: "./claude.json",
				}),
				".codex-plugin/plugin.json": JSON.stringify({
					name: "demo",
					skills: ["./skills/two"],
					mcpServers: "./codex.json",
				}),
				"plugin.json": JSON.stringify({
					name: "demo",
					skills: [],
					commands: "./portable",
				}),
				"claude.json": '{"api":{"command":"claude-server"}}',
				"codex.json": '{"api":{"command":"codex-server"}}',
				"skills/one/SKILL.md": skill("one"),
				"skills/two/SKILL.md": skill("two"),
				"skills/three/SKILL.md": skill("three"),
				"portable/run.md": "portable",
			}),
			"demo",
		);
		const skills = result.components.filter((c) => c.kind === "skill");
		expect(skills.map((c) => c.name)).toEqual(["one", "two"]);
		expect(skills[0].sources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					manifest: ".claude-plugin/plugin.json",
					harness: "claude",
					skillPaths: ["skills/one"],
				}),
			]),
		);
		expect(skills[1].sources).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					manifest: ".codex-plugin/plugin.json",
					harness: "codex",
					skillPaths: ["skills/two"],
				}),
			]),
		);
		expect(
			result.components.find((c) => c.kind === "command")?.sources[0].harness,
		).toBe("portable");
		const mcps = result.components.filter((c) => c.kind === "mcp");
		expect(mcps).toHaveLength(2);
		expect(new Set(mcps.map((c) => c.id)).size).toBe(2);
		expect(
			mcps.every((c) =>
				c.diagnostics.some((d) => d.code === "component-conflict"),
			),
		).toBe(true);
	});
	it("applies explicit inline Skill overrides to every native variant without adding implicit siblings", () => {
		const result = normalizePackage(
			records({
				".claude-plugin/plugin.json":
					'{"name":"demo","skills":["./skills/two"]}',
				".codex-plugin/plugin.json": '{"name":"demo"}',
				"skills/one/SKILL.md": skill("one"),
				"skills/two/SKILL.md": skill("two"),
			}),
			"demo",
			{ name: "suite", strict: false, skills: ["./skills/one"] },
		);
		expect(
			result.components
				.filter((c) => c.kind === "skill")
				.every((c) => c.name === "one"),
		).toBe(true);
		expect(
			result.components
				.filter((c) => c.kind === "skill")
				.map((c) => c.sources[0].catalogSkillPaths),
		).toEqual([["skills/one"], ["skills/one"]]);
		expect(result.manifests[".claude-plugin/plugin.json"].skills).toEqual([
			"./skills/two",
		]);
	});
	it("scans custom MCP config files referenced only by later or superseded manifests", () => {
		for (const inline of [{}, { mcpServers: { api: { command: "safe" } } }]) {
			const result = normalizePackage(
				records({
					".claude-plugin/plugin.json":
						'{"name":"demo","mcpServers":{"api":{"command":"safe"}}}',
					".codex-plugin/plugin.json":
						'{"name":"demo","mcpServers":"./custom-codex.json"}',
					"custom-codex.json":
						'{"api":{"command":"node","env":{"API_TOKEN":"literal-credential-probe"}}}',
				}),
				"demo",
				inline,
			);
			expect(result.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
				true,
			);
		}
	});
	it.each([
		false,
		true,
	])("retains default/explicit same-name differing MCP declarations (%s)", (explicit) => {
		const files = {
			"plugin.json": JSON.stringify({
				name: "demo",
				...(explicit ? { mcpServers: ["./.mcp.json", "./mcp.json"] } : {}),
			}),
			".mcp.json": '{"api":{"command":"first"}}',
			"mcp.json": '{"api":{"command":"second"}}',
		};
		const result = normalizePackage(records(files), "demo");
		const mcps = result.components.filter((c) => c.kind === "mcp");
		expect(mcps).toHaveLength(2);
		expect(new Set(mcps.map((c) => c.id)).size).toBe(2);
		expect(
			mcps.every((c) =>
				c.diagnostics.some((d) => d.code === "component-conflict"),
			),
		).toBe(true);
		expect(
			normalizePackage(records(files), "demo").components.map((c) => c.id),
		).toEqual(result.components.map((c) => c.id));
	});
	it("retains provenance for identical MCP definitions without falsely diagnosing a conflict", () => {
		const result = normalizePackage(
			records({
				"plugin.json": '{"name":"demo"}',
				".mcp.json": '{"api":{"command":"same"}}',
				"mcp.json": '{"api":{"command":"same"}}',
			}),
			"demo",
		);
		const mcps = result.components.filter((c) => c.kind === "mcp");
		expect(mcps.length).toBeGreaterThan(0);
		expect(mcps.flatMap((c) => c.sources).map((s) => s.configPath)).toEqual(
			expect.arrayContaining([".mcp.json", "mcp.json"]),
		);
		expect(
			result.diagnostics.some((d) => d.code === "component-conflict"),
		).toBe(false);
	});
	it("does not put YAML parser source excerpts in public diagnostics", () => {
		const result = normalizePackage(
			records({
				"skills/one/SKILL.md":
					"---\nname: one\ndescription: test\nsecret: credential-probe: invalid\n---\nbody",
			}),
			"demo",
		);
		expect(result.diagnostics.some((d) => d.code === "invalid-skill")).toBe(
			true,
		);
		expect(JSON.stringify(result.diagnostics)).not.toContain(
			"credential-probe",
		);
	});
});

it("diagnoses same-name Skills with different bodies while keeping both stable identities", () => {
	const files = records({
		"skills/a/one/SKILL.md": `${skill("one")}\nfirst body`,
		"skills/b/one/SKILL.md": `${skill("one")}\nsecond body`,
	});
	const result = normalizePackage(files, "demo");
	const skills = result.components.filter((c) => c.kind === "skill");
	expect(skills).toHaveLength(2);
	expect(new Set(skills.map((c) => c.id)).size).toBe(2);
	expect(
		skills.every((c) =>
			c.diagnostics.some((d) => d.code === "component-conflict"),
		),
	).toBe(true);
});

it("credential-checks every custom JSON config in declared component path arrays", () => {
	const result = normalizePackage(
		records({
			"plugin.json":
				'{"name":"demo","apps":["./first-app.json","./second-app.json"]}',
			"first-app.json": '{"apps":[{"id":"public-app"}]}',
			"second-app.json":
				'{"headers":{"Authorization":"Bearer literal-credential-probe"}}',
		}),
		"demo",
	);
	expect(result.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
		true,
	);
});

it("keeps overridden non-Skill definitions visible as inactive with original source", () => {
	const result = normalizePackage(
		records({
			".codex-plugin/plugin.json":
				'{"name":"demo","mcpServers":"./native.json"}',
			"native.json": '{"api":{"command":"original"}}',
		}),
		"demo",
		{ mcpServers: { api: { command: "catalog" } } },
	);
	const mcps = result.components.filter((c) => c.kind === "mcp");
	expect(mcps).toHaveLength(2);
	expect(
		mcps.find((c) => c.definition?.config.command === "original")?.sources[0],
	).toMatchObject({
		manifest: ".codex-plugin/plugin.json",
		harness: "codex",
		effective: false,
		overriddenBy: "@catalog",
		configPath: "native.json",
	});
	expect(
		mcps.find((c) => c.definition?.config.command === "catalog")?.sources[0]
			.effective,
	).toBe(true);
	expect(
		result.diagnostics.some((d) => d.code === "superseded-declaration"),
	).toBe(true);
});

it("keeps inline MCP declaration identities stable when their configuration changes", () => {
	const normalize = (command: string) =>
		normalizePackage(
			records({
				"plugin.json": JSON.stringify({
					name: "demo",
					mcpServers: [{ api: { command } }, { api: { command: "sibling" } }],
				}),
			}),
			"demo",
		);
	const before = normalize("before").components.filter((c) => c.kind === "mcp");
	const after = normalize("after").components.filter((c) => c.kind === "mcp");
	expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
	expect(new Set(after.map((c) => c.id)).size).toBe(2);
});

describe("inline-only package defaults overridden by marketplace declarations", () => {
	it("keeps superseded default hooks inactive and scans their credentials without adding sibling Skills", () => {
		const result = normalizePackage(
			records({
				"README.md": "plugin resources",
				"hooks/hooks.json": JSON.stringify({
					hooks: {
						PreToolUse: [
							{
								hooks: [
									{
										type: "http",
										url: "https://example.test",
										headers: { Authorization: "Bearer credential-probe" },
									},
								],
							},
						],
					},
				}),
				"skills/one/SKILL.md": skill("one"),
				"skills/two/SKILL.md": skill("two"),
			}),
			"demo",
			{
				name: "demo",
				strict: false,
				skills: ["./skills/one"],
				hooks: {
					hooks: {
						PreToolUse: [
							{ hooks: [{ type: "command", command: "echo safe" }] },
						],
					},
				},
			},
		);
		const hooks = result.components.filter((c) => c.kind === "hook");
		expect(hooks).toHaveLength(2);
		expect(
			hooks.find((c) => c.definition?.handler.type === "http")?.sources[0],
		).toMatchObject({
			manifest: "@directory",
			harness: "directory",
			effective: false,
			overriddenBy: "@catalog",
			configPath: "hooks/hooks.json",
		});
		expect(
			hooks.find((c) => c.definition?.handler.type === "command")?.sources[0],
		).toMatchObject({
			manifest: "@catalog",
			harness: "catalog",
			effective: true,
		});
		expect(
			result.components.filter((c) => c.kind === "skill").map((c) => c.name),
		).toEqual(["one"]);
		expect(result.diagnostics.map((d) => d.code)).toEqual(
			expect.arrayContaining(["embedded-secret", "superseded-declaration"]),
		);
		expect(result.manifests["hooks/hooks.json"]).toBeDefined();
	});
	it.each([
		[
			"apps",
			".app.json",
			{
				apps: [
					{ id: "app", headers: { Authorization: "Bearer credential-probe" } },
				],
			},
		],
		[
			"lspServers",
			".lsp.json",
			{ ts: { command: "server", env: { API_TOKEN: "credential-probe" } } },
		],
		[
			"mcpServers",
			".mcp.json",
			{ api: { command: "server", env: { API_TOKEN: "credential-probe" } } },
		],
	] as const)("scans and preserves original default %s configs when inline-only declarations override them", (field, path, config) => {
		const result = normalizePackage(
			records({ "README.md": "resources", [path]: JSON.stringify(config) }),
			"demo",
			{
				name: "demo",
				strict: false,
				[field]: { replacement: { command: "safe" } },
			},
		);
		expect(result.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
			true,
		);
		expect(
			result.components.some((c) =>
				c.sources.some(
					(s) =>
						s.manifest === "@directory" &&
						s.configPath === path &&
						!s.effective,
				),
			),
		).toBe(true);
	});
});
