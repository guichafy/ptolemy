import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionCapability,
	ExtensionChoices,
	ExtensionInventory,
	SessionResourceConfiguration,
} from "@/shared/extension-rpc";
import type { ExtensionSummary } from "@/shared/extensions";
import type { McpServerSummary } from "@/shared/mcp";
import type { SkillSummary } from "@/shared/skills";
export type ResourcePage = "skills" | "plugins" | "mcp";
export const resourceLabels = {
	skills: "Skills",
	plugins: "Plugins",
	mcp: "MCP",
};
export interface ResourceLibrary {
	agent?: AgentKind;
	skills: SkillSummary[];
	inventory: ExtensionInventory | null;
	servers: McpServerSummary[];
	loading: boolean;
	error: string | null;
	archiveOnly?: {
		skillIds: string[];
		packageRevisions: string[];
		serverIds: string[];
	};
}
/** Native Skills belong to one harness; portable imports belong to the library. */
export function libraryForAgent(
	agent: AgentKind,
	library: ResourceLibrary,
): ResourceLibrary {
	if (library.agent && library.agent !== agent)
		return {
			agent,
			skills: [],
			inventory: null,
			servers: [],
			loading: true,
			error: null,
		};
	return {
		...library,
		agent,
		skills: library.skills.filter(
			(s) => s.source.kind !== "harness" || s.source.agent === agent,
		),
	};
}
export const emptyChoices = (): ExtensionChoices => ({
	skillIds: [],
	extensionSelections: [],
	builtinCommandNames: [],
	mcpServerIds: [],
});
export function defaultChoices(
	agent: AgentKind,
	library: ResourceLibrary,
): ExtensionChoices {
	return {
		skillIds: library.skills
			.filter((s) => s.defaultFor.includes(agent) && !s.unavailableReason)
			.map((s) => s.id),
		extensionSelections: library.inventory?.defaults?.selections ?? [],
		builtinCommandNames:
			library.inventory?.defaults?.builtinCommandNames ??
			library.inventory?.builtins.map((b) => b.name) ??
			[],
		mcpServerIds: library.servers
			.filter((s) => !s.packageId && s.defaults[agent])
			.map((s) => s.id),
	};
}
export function withArchived(
	library: ResourceLibrary,
	archived?: SessionResourceConfiguration,
): ResourceLibrary {
	if (!archived || (library.agent && library.agent !== archived.agent))
		return library;
	const packages = [
		...archived.packages,
		...(library.inventory?.installed ?? []).filter(
			(p) =>
				!archived.packages.some(
					(a) => a.id === p.id && a.revision === p.revision,
				),
		),
	];
	return {
		...library,
		archiveOnly: {
			skillIds: archived.skills
				.filter((a) => !library.skills.some((s) => s.id === a.id))
				.map((s) => s.id),
			packageRevisions: archived.packages
				.filter(
					(a) =>
						!library.inventory?.installed.some(
							(p) => p.id === a.id && p.revision === a.revision,
						),
				)
				.map((p) => `${p.id}:${p.revision}`),
			serverIds: archived.servers
				.filter((a) => !library.servers.some((s) => s.id === a.id))
				.map((s) => s.id),
		},
		skills: [
			...archived.skills,
			...library.skills.filter(
				(s) => !archived.skills.some((a) => a.id === s.id),
			),
		],
		servers: [
			...archived.servers,
			...library.servers.filter(
				(s) => !archived.servers.some((a) => a.id === s.id),
			),
		],
		inventory: {
			nativePlugins: [],
			builtins: [],
			verifiedRuntime: "",
			...library.inventory,
			installed: packages,
		},
	};
}
export function toggleComponent(
	choices: ExtensionChoices,
	pkg: ExtensionSummary,
	id: string,
	checked: boolean,
): ExtensionChoices {
	const old = choices.extensionSelections.find(
		(s) => s.packageId === pkg.id && s.revision === pkg.revision,
	) ?? { packageId: pkg.id, revision: pkg.revision, componentIds: [] };
	const componentIds = checked
		? [...new Set([...old.componentIds, id])]
		: old.componentIds.filter((c) => c !== id);
	return {
		...choices,
		extensionSelections: [
			...choices.extensionSelections.filter((s) => s.packageId !== pkg.id),
			{ ...old, componentIds },
		].filter((s) => s.componentIds.length || s.trustedHookDigest),
	};
}
export function resourceCounts(
	library: ResourceLibrary,
	choices: ExtensionChoices,
	caps: ExtensionCapability[],
) {
	const available = (p: ExtensionSummary, id: string) =>
		caps.some(
			(c) =>
				c.packageId === p.id &&
				c.componentId === id &&
				(!c.revision || c.revision === p.revision) &&
				["native", "adapted"].includes(c.status),
		);
	let skills = choices.skillIds.filter((id) =>
		library.skills.some((s) => s.id === id && !s.unavailableReason),
	).length;
	skills += choices.builtinCommandNames.filter((n) =>
		library.inventory?.builtins.some((b) => b.name === n && b.kind === "skill"),
	).length;
	let plugins = 0;
	const mcp = new Set(
		choices.mcpServerIds.filter((id) =>
			library.servers.some(
				(s) => s.id === id && !s.packageId && s.authentication?.ready !== false,
			),
		),
	);
	for (const selection of choices.extensionSelections) {
		const pkg = library.inventory?.installed.find(
			(p) => p.id === selection.packageId && p.revision === selection.revision,
		);
		if (!pkg) continue;
		const selected = pkg.components.filter(
			(c) => selection.componentIds.includes(c.id) && available(pkg, c.id),
		);
		if (selected.length) plugins++;
		skills += selected.filter((c) => c.kind === "skill").length;
		for (const c of selected.filter((c) => c.kind === "mcp"))
			mcp.add(`${pkg.id}:${pkg.revision}:${c.id}`);
	}
	return { skills, plugins, mcp: mcp.size };
}

/** Preserve a selected MCP's frozen readiness without borrowing capabilities
 * from a different revision or a newly authorized hook digest. */
export function sessionCapabilities(
	choices: ExtensionChoices,
	live: ExtensionCapability[],
	archived?: SessionResourceConfiguration,
): ExtensionCapability[] {
	return live.map((cap) => {
		const old = archived?.choices.extensionSelections.find(
			(s) => s.packageId === cap.packageId,
		);
		const current = choices.extensionSelections.find(
			(s) => s.packageId === cap.packageId,
		);
		if (
			!old ||
			!current ||
			old.revision !== current.revision ||
			old.trustedHookDigest !== current.trustedHookDigest ||
			(cap.revision && cap.revision !== current.revision)
		)
			return cap;
		return (
			archived?.capabilities.find(
				(c) =>
					c.packageId === cap.packageId &&
					c.componentId === cap.componentId &&
					(!c.revision || c.revision === current.revision),
			) ?? cap
		);
	});
}
