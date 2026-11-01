import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { McpRegistry } from "./registry";
import {
	buildCodexMcpOverrides,
	localMcpEnv,
	mcpRuntimeName,
	prepareSessionMcp,
} from "./runtime";
import { MemorySecretVault } from "./secrets";

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of clean.splice(0).reverse()) await close();
});
test("only selected registry snapshots reach SDK configuration and credentials stay behind gateway env references", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-runtime-"));
	clean.push(() => rm(root, { recursive: true, force: true }));
	const registry = new McpRegistry({
		path: join(root, "registry.json"),
		legacyPath: join(root, "legacy.json"),
		vault: new MemorySecretVault(),
	});
	for (const id of ["selected", "other"])
		await registry.save({
			id,
			name: id,
			transport: "http",
			url: "http://127.0.0.1:1/mcp",
			headers: { Authorization: `Bearer ${id}-secret` },
			defaults: { claude: false, codex: false },
		});
	const context = await prepareSessionMcp(
		"one",
		root,
		await registry.snapshot(["selected"]),
		"claude",
		{ registry },
	);
	clean.push(() => context.dispose());
	expect(Object.keys(context.servers)).toEqual(["selected"]);
	expect(context.servers.selected).toMatchObject({
		type: "http",
		headers: {
			Authorization: expect.stringMatching(
				/^Bearer \$\{PTOLEMY_MCP_[A-Z0-9]+\}$/,
			),
		},
	});
	const serialized = JSON.stringify([context.servers, context.codexConfig]);
	expect(serialized).not.toContain("selected-secret");
	expect(serialized).not.toContain("other");
	expect(serialized).not.toContain(Object.values(context.env)[0]);
	expect(Object.keys(context.env)).toHaveLength(1);
	const overrides = buildCodexMcpOverrides(context.codexConfig, [
		"inherited.with.dot",
		"selected",
	]);
	expect(overrides[0]).toContain('"inherited.with.dot"={enabled=false}');
	expect(overrides[0]).toContain(
		`${JSON.stringify(mcpRuntimeName("selected", "selected"))}={enabled=true,`,
	);
	expect(overrides[0]).not.toContain("secret");
	expect(overrides[0]).toContain('default_tools_approval_mode="approve"');
});
test("empty selection disables all inherited config and needs no server or secret resolution", async () => {
	const context = await prepareSessionMcp(
		"none",
		"/tmp",
		{ version: 1, servers: [] },
		"codex",
	);
	clean.push(() => context.dispose());
	expect(context.servers).toEqual({});
	expect(context.env).toEqual({});
	expect(
		buildCodexMcpOverrides(context.codexConfig, ["user", "project.with.dot"]),
	).toEqual([
		'mcp_servers={"user"={enabled=false},"project.with.dot"={enabled=false}}',
	]);
});
test("local CLI transport bypasses proxy while preserving existing per-case exemptions", () => {
	const env = localMcpEnv({ NO_PROXY: "example.com", no_proxy: "internal" });
	expect(env.NO_PROXY).toBe("example.com,127.0.0.1,localhost,::1");
	expect(env.no_proxy).toBe("internal,127.0.0.1,localhost,::1");
});

test("Codex uses stable reserved aliases and rejects inherited alias collisions instead of merging transport credentials", () => {
	const alias = mcpRuntimeName("one", "Name with spaces/and.dot");
	expect(alias).toMatch(/^ptolemy_[a-f0-9]+_name_with_spaces_and_dot$/);
	expect(alias).toBe(mcpRuntimeName("one", "Name with spaces/and.dot"));
	expect(() =>
		buildCodexMcpOverrides(
			{
				[alias]: {
					enabled: true,
					url: "http://127.0.0.1:1/mcp",
					bearer_token_env_var: "LOCAL",
				},
			},
			[alias],
		),
	).toThrow("Conflito");
});
