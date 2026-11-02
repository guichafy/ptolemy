import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const context = vi.hoisted(() => ({
	root: "",
	saved: undefined as string[] | undefined,
}));
vi.mock("../paths", () => ({ ptolemyDataDir: () => context.root }));
vi.mock("../skills/store", () => ({
	skillsStore: { savedDefaults: async () => context.saved },
}));
vi.mock("../claude/claude-cli", () => ({
	findClaudeCli: async () => "/fixture/claude",
}));
vi.mock("./native", () => ({
	inventoryClaudeBuiltins: async () => [{ name: "discovered", kind: "skill" }],
	inventoryClaudePlugins: async () => [
		{
			id: "plugin",
			name: "Plugin",
			enabled: true,
			managed: false,
			path: "/private/plugin",
		},
	],
}));
vi.mock("./store", () => ({
	extensionsStore: {
		installed: async () => [],
		defaults: async () => undefined,
	},
}));
const { extensionRequestHandlers } = await import("./ui-service");
beforeEach(async () => {
	context.root = await mkdtemp(join(tmpdir(), "ptolemy-default-projection-"));
});
afterEach(async () => {
	await rm(context.root, { recursive: true, force: true });
});
test.each([
	{ label: "absent", saved: undefined },
	{ label: "explicit empty", saved: [] },
	{ label: "explicit IDs", saved: ["saved-skill-id"] },
])("projects persisted Skill defaults ($label) without native paths", async ({
	saved,
}) => {
	context.saved = saved;
	const result = await extensionRequestHandlers.agentExtensionInventory({
		agent: "claude",
	});
	if (saved === undefined) expect(result).not.toHaveProperty("skillDefaults");
	else expect(result).toHaveProperty("skillDefaults", saved);
	expect(result.nativePlugins[0]).not.toHaveProperty("path");
	expect(JSON.stringify(result)).not.toContain("/private/plugin");
});
