import { describe, expect, it, vi } from "vitest";

// registry.ts transitively imports providers that hit the Electrobun RPC
// singleton on import. Stub the rpc module so the registry can be loaded
// without spinning up an Electroview.
vi.mock("./rpc", () => ({
	rpc: { request: {}, messages: {} },
	setOpenPreferencesHandler: vi.fn(),
	setClaudeSessionsUpdateHandler: vi.fn(),
}));
vi.mock("../settings/claude-section", () => ({
	ClaudeSection: () => null,
}));

const {
	PLUGIN_REGISTRY,
	PLUGIN_META,
	KNOWN_PLUGIN_IDS,
	findPluginMeta,
	hasPluginConfig,
} = await import("./registry");

describe("plugin registry", () => {
	it("exposes all known plugins", () => {
		expect(KNOWN_PLUGIN_IDS.sort()).toEqual(
			["apps", "calc", "claude", "codex", "github", "web"].sort(),
		);
	});

	it("every plugin in META has a matching entry in REGISTRY", () => {
		for (const meta of PLUGIN_META) {
			expect(PLUGIN_REGISTRY[meta.id]).toBeDefined();
			expect(PLUGIN_REGISTRY[meta.id]?.id).toBe(meta.id);
		}
	});

	it("findPluginMeta returns metadata for known ids", () => {
		const meta = findPluginMeta("github");
		expect(meta).toBeDefined();
		expect(meta?.label).toBe("GitHub");
	});

	it("findPluginMeta returns undefined for unknown ids", () => {
		expect(findPluginMeta("does-not-exist")).toBeUndefined();
	});

	it("hasPluginConfig reflects configComponent presence", () => {
		// 'claude' has configComponent; 'calc' does not
		expect(hasPluginConfig("claude")).toBe(true);
		expect(hasPluginConfig("calc")).toBe(false);
	});

	it("hasPluginConfig returns false for unknown ids", () => {
		expect(hasPluginConfig("nope")).toBe(false);
	});
});
