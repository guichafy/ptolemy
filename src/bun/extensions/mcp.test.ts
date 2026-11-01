import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { McpRegistry } from "../mcp/registry";
import { MemorySecretVault } from "../mcp/secrets";
import { prepareSessionExtensions } from "./activation";
import { extensionMcpId, snapshotExtensionMcp } from "./mcp";

test("plugin MCP uses the shared registry, preserves argv and freezes vault references", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-plugin-mcp-"));
	try {
		const registry = new McpRegistry({
			path: join(root, "registry.json"),
			legacyPath: join(root, "legacy.json"),
			vault: new MemorySecretVault(),
		});
		const prepared = await prepareSessionExtensions("test", root, [], "codex");
		prepared.mcpComponents.push({
			packageId: "package",
			revision: "revision",
			root: "/project/package",
			data: "/project/data",
			componentId: "server",
			name: "one",
			config: {
				command: "bun",
				args: ["one two", "quoted"],
				env: { PUBLIC_SETTING: "value" },
			},
		});
		const snap = await snapshotExtensionMcp(prepared, registry);
		expect(snap.servers[0].id).toBe(
			extensionMcpId("package", "server", "revision"),
		);
		expect(JSON.stringify(snap)).not.toContain('"PUBLIC_SETTING":"value"');
		expect((await registry.resolve(snap))[0]).toMatchObject({
			command: "bun",
			args: ["one two", "quoted"],
			env: { PUBLIC_SETTING: "value" },
		});
		prepared.mcpComponents[0].config.env = { TOKEN: `\${UNRESOLVED}` };
		prepared.mcpComponents[0].componentId = "different";
		await expect(snapshotExtensionMcp(prepared, registry)).rejects.toThrow(
			"configuração",
		);
		expect(await registry.list()).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
