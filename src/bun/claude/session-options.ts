// src/bun/claude/session-options.ts
import type {
	CanUseTool,
	McpServerConfig,
	Options,
	PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import { localMcpEnv } from "../mcp/runtime";
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
	/** Native paths are suppressed only when a new immutable Skill selection exists. */
	explicitSkillSelection?: boolean;
	explicitMcpSelection?: boolean;
	mcpEnv?: Record<string, string>;
}

/**
 * Build `Options` for the stable `query({ prompt, options })`.
 *
 * Optional fields are emitted only when supplied:
 * - `permissionMode` — pass on createSession; omit on resumeSession to honour
 *   the SDK transcript's prior mode.
 * - `mcpServers` — explicit selections always attach strict config (including
 *   empty); legacy sessions preserve native file discovery.
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
	if (args.explicitSkillSelection) {
		opts.managedSettings = { strictPluginOnlyCustomization: ["skills"] };
	}
	if (args.permissionMode) {
		opts.permissionMode = args.permissionMode;
	}
	if (args.mcpEnv) opts.env = localMcpEnv({ ...process.env, ...args.mcpEnv });
	if (args.explicitMcpSelection) {
		opts.strictMcpConfig = true;
	}
	if (args.explicitMcpSelection || Object.keys(args.mcpServers).length > 0) {
		opts.mcpServers = args.mcpServers;
	}
	if (args.resumeSdkSessionId) {
		opts.resume = args.resumeSdkSessionId;
	}
	return opts;
}
