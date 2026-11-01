// src/bun/claude/session-options.ts
import type {
	CanUseTool,
	McpServerConfig,
	Options,
	PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeSkillsPlugin } from "../skills/workspace";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "LS"];

export interface BuildQueryArgs {
	model: string;
	permissionMode?: PermissionMode;
	claudePath: string;
	canUseTool: CanUseTool;
	mcpServers: Record<string, McpServerConfig>;
	cwd: string;
	/** Pass to resume an existing SDK session (CLI `--resume` semantics). */
	resumeSdkSessionId?: string;
}

/**
 * Build `Options` for the stable `query({ prompt, options })`.
 *
 * Optional fields are emitted only when supplied:
 * - `permissionMode` — pass on createSession; omit on resumeSession to honour
 *   the SDK transcript's prior mode.
 * - `mcpServers` — only attached when non-empty so we don't override file-based
 *   config with `{}`.
 * - `resume` (mapped from `resumeSdkSessionId`) — set only when continuing an
 *   existing SDK session.
 */
export function buildQueryOptions(args: BuildQueryArgs): Options {
	const opts: Options = {
		model: args.model,
		pathToClaudeCodeExecutable: args.claudePath,
		allowedTools: ALLOWED_TOOLS,
		canUseTool: args.canUseTool,
		includePartialMessages: true,
		cwd: args.cwd,
		// Load only the isolated plugin, without loading arbitrary user/project
		// settings, hooks or permission grants alongside the selected Skills.
		plugins: [{ type: "local", path: claudeSkillsPlugin(args.cwd) }],
	};
	if (args.permissionMode) {
		opts.permissionMode = args.permissionMode;
	}
	if (Object.keys(args.mcpServers).length > 0) {
		opts.mcpServers = args.mcpServers;
	}
	if (args.resumeSdkSessionId) {
		opts.resume = args.resumeSdkSessionId;
	}
	return opts;
}
