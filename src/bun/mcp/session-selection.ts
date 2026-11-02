import type { McpSnapshot } from "../../shared/mcp";
/** Persisted snapshots are backend-only. RPC lists expose only logical selected IDs. */
export function publicSessionMcp<T extends object>(
	value: T & {
		mcpSelection?: McpSnapshot;
		skillSelection?: unknown;
		builtinCommands?: { all: string[]; selected: string[] };
	},
): Omit<T, "mcpSelection" | "skillSelection" | "builtinCommands"> & {
	mcpServerIds?: string[];
	builtinCommandNames?: string[];
} {
	const {
		mcpSelection,
		skillSelection: _skillSelection,
		builtinCommands,
		...rest
	} = value;
	const safe = {
		...rest,
		...(builtinCommands
			? { builtinCommandNames: [...builtinCommands.selected] }
			: {}),
	};
	return mcpSelection === undefined
		? safe
		: {
				...safe,
				mcpServerIds: mcpSelection.servers.map((server) => server.id),
			};
}
