export function restrictedEnvironment(
	source: Record<string, string | undefined>,
): Record<string, string>;
export function hookOutput(
	event: string,
	text: string,
): import("@anthropic-ai/claude-agent-sdk").SyncHookJSONOutput;
export function executeHookSequence(
	hooks: import("./hooks").PreparedHook[],
	input: string,
	signal?: AbortSignal,
	environment?: Record<string, string>,
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
		readOnly?: boolean;
	},
	input?: string,
	signal?: AbortSignal,
	environment?: Record<string, string>,
): Promise<{ stdout: string; code: number }>;
