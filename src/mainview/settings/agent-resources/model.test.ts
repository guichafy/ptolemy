import { expect, it } from "vitest";
import type {
	ExtensionCapability,
	ExtensionChoices,
} from "@/shared/extension-rpc";
import type { ExtensionSummary } from "@/shared/extensions";
import { type ResourceLibrary, resourceCounts, withArchived } from "./model";

const pkg: ExtensionSummary = {
	id: "package",
	revision: "old",
	name: "Package",
	description: "",
	sourceId: "source",
	url: "https://github.com/a/b",
	diagnostics: [],
	components: [
		{ id: "skill", kind: "skill", name: "Skill", sources: [], diagnostics: [] },
		{ id: "mcp", kind: "mcp", name: "MCP", sources: [], diagnostics: [] },
	],
};
const library: ResourceLibrary = {
	skills: [
		{
			id: "file",
			name: "file",
			description: "",
			source: { kind: "harness", agent: "codex" },
			defaultFor: [],
		},
	],
	inventory: {
		installed: [pkg],
		nativePlugins: [],
		builtins: [
			{
				id: "builtin",
				kind: "skill",
				name: "debug",
				description: "",
				origin: "builtin",
				limitation: "",
			},
		],
		verifiedRuntime: "test",
	},
	servers: [
		{
			id: "server",
			name: "server",
			transport: "stdio",
			defaults: { claude: false, codex: false },
			credentials: { env: [], headers: [], oauthClientSecret: false },
			connection: { state: "disconnected" },
			authentication: { required: false, ready: true },
		},
	],
	loading: false,
	error: null,
};
const choices: ExtensionChoices = {
	skillIds: ["file"],
	builtinCommandNames: ["debug"],
	extensionSelections: [
		{
			packageId: pkg.id,
			revision: pkg.revision,
			componentIds: ["skill", "mcp"],
		},
	],
	mcpServerIds: ["server"],
};
it("counts usable file/builtin/package Skills, unique MCP and selected packages", () => {
	const caps: ExtensionCapability[] = [
		{ packageId: pkg.id, componentId: "skill", status: "adapted", reason: "" },
		{ packageId: pkg.id, componentId: "mcp", status: "adapted", reason: "" },
	];
	expect(resourceCounts(library, choices, caps)).toEqual({
		skills: 3,
		plugins: 1,
		mcp: 2,
	});
});
it("does not let a newer compatible revision make an incompatible archived revision count as active", () => {
	const caps = [
		{
			packageId: pkg.id,
			revision: "old",
			componentId: "skill",
			status: "incompatible" as const,
			reason: "Unavailable",
		},
		{
			packageId: pkg.id,
			revision: "new",
			componentId: "skill",
			status: "adapted" as const,
			reason: "Available",
		},
	];
	expect(resourceCounts(library, choices, caps)).toEqual({
		skills: 2,
		plugins: 0,
		mcp: 1,
	});
});
it("retains archived summaries rather than silently replacing their metadata", () => {
	const archived = {
		agent: "codex" as const,
		revision: 1,
		legacy: false,
		busy: false,
		capabilities: [],
		choices,
		skills: [{ ...library.skills[0], description: "frozen" }],
		packages: [pkg],
		servers: library.servers,
	};
	const merged = withArchived(
		{
			...library,
			skills: [{ ...library.skills[0], description: "changed" }],
			inventory: {
				...library.inventory!,
				installed: [{ ...pkg, revision: "new" }],
			},
		},
		archived,
	);
	expect(merged.skills[0].description).toBe("frozen");
	expect(merged.inventory?.installed.map((p) => p.revision)).toEqual([
		"old",
		"new",
	]);
});
