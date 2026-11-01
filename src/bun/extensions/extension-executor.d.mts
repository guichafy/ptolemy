export function hookOutput(
	event: string,
	text: string,
): import("@anthropic-ai/claude-agent-sdk").SyncHookJSONOutput;
export function executeHookSequence(
	hooks: import("./hooks").PreparedHook[],
	input: string,
	signal?: AbortSignal,
): Promise<import("@anthropic-ai/claude-agent-sdk").SyncHookJSONOutput>;
export function executeRestricted(
	spec: {
		cwd: string;
		root: string;
		data: string;
		command: string;
		timeout: number;
		variables?: Record<string, string>;
		args?: string[];
	},
	input?: string,
	signal?: AbortSignal,
): Promise<{ stdout: string; code: number }>;
