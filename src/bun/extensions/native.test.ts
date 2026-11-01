import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	inventoryCodexHooks,
	parseNativeHookInventory,
} from "./codex-hook-inventory";
import {
	claudeBuiltinControls,
	denyUnselectedSlash,
	parseCodexPlugins,
	suppressCodexPlugins,
} from "./native";

test("only installed plugins are inventoried and exact IDs override inherited enablement", () => {
	const plugins = parseCodexPlugins({
		installed: [
			{
				pluginId: "a.b@market",
				name: "demo",
				installed: true,
				enabled: true,
				source: { source: "local", path: "/plugins/demo" },
			},
			{
				pluginId: "disabled@market",
				name: "off",
				installed: true,
				enabled: false,
				source: { source: "local", path: "/plugins/off" },
			},
		],
		available: [{ pluginId: "cached@market", installed: false }],
	});
	expect(plugins.map((p) => p.id)).toEqual(["a.b@market", "disabled@market"]);
	expect(plugins[1].enabled).toBe(false);
	expect(suppressCodexPlugins(plugins)).toContain(
		'"a.b@market"={"enabled"=false}',
	);
});
test("empty selection disables Skill tool and slash processing; partial controls execution honestly", () => {
	expect(claudeBuiltinControls(["debug"], [], false)).toMatchObject({
		disallowedTools: ["Skill"],
		extraArgs: { "disable-slash-commands": null },
	});
	expect(
		claudeBuiltinControls(["debug", "batch"], ["debug"], true),
	).toMatchObject({ disallowedTools: ["Skill(batch)"] });
	expect(() =>
		denyUnselectedSlash("/batch details", ["debug", "batch"], ["debug"]),
	).toThrow("desabilitado");
	expect(() =>
		denyUnselectedSlash("normal /batch", ["batch"], []),
	).not.toThrow();
});

test("native hook inventory rejects missing sources and managed load errors", () => {
	expect(
		parseNativeHookInventory({
			data: [
				{
					hooks: [
						{
							key: "/mdm:pre_tool_use:0:0",
							source: "mdm",
							isManaged: true,
							enabled: true,
						},
					],
					errors: [],
					warnings: [],
				},
			],
		}),
	).toEqual([
		{
			key: "/mdm:pre_tool_use:0:0",
			source: "mdm",
			managed: true,
			enabled: true,
		},
	]);
	expect(() =>
		parseNativeHookInventory({
			data: [
				{ hooks: [], errors: [{ message: "private policy" }], warnings: [] },
			],
		}),
	).toThrow("inventariar");
	expect(() =>
		parseNativeHookInventory({
			data: [
				{
					hooks: [
						{
							key: "unknown",
							source: "unknown",
							enabled: true,
							isManaged: false,
						},
					],
					errors: [],
					warnings: [],
				},
			],
		}),
	).toThrow();
});

test("inventory refuses missing or invalid installation IDs before starting the CLI", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-hook-id-"));
	try {
		await expect(
			inventoryCodexHooks("/never-execute", root, { CODEX_HOME: root }),
		).rejects.toThrow("installation_id");
		await writeFile(join(root, "installation_id"), "invalid");
		await expect(
			inventoryCodexHooks("/never-execute", root, { CODEX_HOME: root }),
		).rejects.toThrow("installation_id");
		expect(await readFile(join(root, "installation_id"), "utf8")).toBe(
			"invalid",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
