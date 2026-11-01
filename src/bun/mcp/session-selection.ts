import type { McpSnapshot } from "../../shared/mcp";
/** Persisted snapshots are backend-only. RPC lists expose only logical selected IDs. */
export function publicSessionMcp<T extends object>(
	value: T & { mcpSelection?: McpSnapshot },
): Omit<T, "mcpSelection"> & { mcpServerIds?: string[] } {
	const { mcpSelection, ...safe } = value;
	return mcpSelection === undefined
		? safe
		: {
				...safe,
				mcpServerIds: mcpSelection.servers.map((server) => server.id),
			};
}
