/**
 * Shared agent protocol. Types cross the Electrobun RPC boundary between the
 * main process (Bun) and the renderer (React chatview). Do not import anything
 * from `@anthropic-ai/claude-agent-sdk` here — the renderer bundle must not
 * pull the Node-only SDK.
 */

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

/** Mirrors SDK `PermissionMode`. Keep values in sync with @anthropic-ai/claude-agent-sdk. */
export type PermissionMode =
	| "default"
	| "acceptEdits"
	| "bypassPermissions"
	| "plan"
	| "dontAsk"
	| "auto";

export type ClaudeAuthMode = "anthropic" | "bedrock";

/**
 * Which coding agent backs a chat session. Sessions created before Codex
 * support carry no `agent` field and are treated as `"claude"`.
 */
export type AgentKind = "claude" | "codex";

export const DEFAULT_AGENT: AgentKind = "claude";

/**
 * Subset of the SDK's `ModelInfo` that crosses the RPC boundary.
 * Mirrors @anthropic-ai/claude-agent-sdk's ModelInfo shape but is declared
 * here so the renderer bundle does not pull the SDK.
 */
export interface ProtocolModelInfo {
	value: string;
	displayName: string;
	description: string;
	supportsEffort?: boolean;
	supportedEffortLevels?: ("low" | "medium" | "high" | "xhigh" | "max")[];
	supportsAdaptiveThinking?: boolean;
	supportsFastMode?: boolean;
	supportsAutoMode?: boolean;
	/**
	 * For sentinel entries such as Codex's `"default"`: the concrete model the
	 * sentinel currently resolves to, when the backend can tell.
	 */
	resolvesTo?: string;
}

export type ThinkingConfig =
	| { type: "adaptive" }
	| { type: "enabled"; budgetTokens?: number }
	| { type: "disabled" };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type SettingSource = "user" | "project" | "local";

export type SystemPrompt =
	| string
	| {
			type: "preset";
			preset: "claude_code";
			append?: string;
			excludeDynamicSections?: boolean;
	  };

export interface SessionConfig {
	systemPrompt?: SystemPrompt;
	allowedTools?: string[];
	disallowedTools?: string[];
	mcpServers?: string[];
	permissionMode?: PermissionMode;
	thinking?: ThinkingConfig;
	effort?: Effort;
	settingSources?: SettingSource[];
	maxBudgetUsd?: number;
	model?: string;
}

// ---------------------------------------------------------------------------
// User input
// ---------------------------------------------------------------------------

export type MessagePart =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

export type MessageContent = string | MessagePart[];

// ---------------------------------------------------------------------------
// Permission HITL
// ---------------------------------------------------------------------------

/** Mirrors SDK `PermissionResult["behavior"]`. */
export type PermissionBehavior = "allow" | "deny";

export type ApproveBehavior =
	| "allow"
	| "allow-modified"
	| "always-allow-this-session";

export interface ToolDecision {
	permissionId: string;
	sessionId: string;
	toolCallId: string;
	toolName: string;
	argsHash: string;
	decision: "allow" | "allow-modified" | "deny" | "timeout";
	decidedBy: "user" | "auto-whitelist" | "auto-timeout";
	decidedAt: string;
	reason?: string;
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
}

// ---------------------------------------------------------------------------
// Context window usage
// ---------------------------------------------------------------------------

/**
 * Snapshot of how much of the model's context window the conversation
 * occupies, taken after the last model request of a turn. Persisted on the
 * session meta so a reopened chat shows it before the next turn.
 */
export interface ContextUsageInfo {
	/** Tokens occupying the context window (prompt + cache + last output). */
	usedTokens: number;
	/** Context window size of the model, when the agent reports it. */
	maxTokens?: number;
	/** Breakdown of the last request. */
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	reasoningTokens?: number;
	/** Cost of the last turn in USD (Claude only). */
	lastTurnCostUsd?: number;
	/** ISO timestamp of the snapshot. */
	updatedAt: string;
}

/**
 * Live facts about a session that the agent reveals while running: the
 * concrete model behind an alias such as `"default"`, and the context usage.
 * Every field is optional; consumers merge patches.
 */
export interface SessionInfoPatch {
	/** Concrete model id that served the last request (never an alias). */
	resolvedModel?: string;
	contextUsage?: ContextUsageInfo;
	/** Totals for the whole conversation (absolute values, not deltas). */
	stats?: SessionStats;
}

/** Conversation-wide totals, persisted on the session meta. */
export interface SessionStats {
	/** Sum of the per-turn costs in USD. Claude only: Codex reports no cost. */
	totalCostUsd?: number;
	/** How many times the agent compacted the context. */
	compactions: number;
	/** The most recent compaction, when known. */
	lastCompaction?: {
		trigger?: "manual" | "auto";
		/** Tokens in the context right before compacting. */
		preTokens?: number;
		at: string;
	};
}

/** One slice of the context window ("System prompt", "Messages", ...). */
export interface ContextCategory {
	name: string;
	tokens: number;
	/** Not loaded until used (deferred tools); excluded from the bar. */
	isDeferred?: boolean;
}

export interface ContextDetailSection {
	title: string;
	items: { name: string; tokens: number; hint?: string }[];
}

/**
 * What occupies the context window, for the "details" view. Claude comes from
 * the CLI's own accounting (`getContextUsage`); Codex is estimated from the
 * thread rollout (text length per item kind, scaled to the reported usage).
 */
export interface ContextBreakdown {
	source: "claude" | "codex-estimate";
	model?: string;
	usedTokens: number;
	maxTokens?: number;
	/** Claude: usage at which auto-compaction kicks in. */
	autoCompactThreshold?: number;
	categories: ContextCategory[];
	sections: ContextDetailSection[];
	/** Shown under the chart, e.g. why the numbers are estimates. */
	note?: string;
}

// ---------------------------------------------------------------------------
// Broadcast sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel `sessionId` value used by main → renderer events that are
 * not scoped to a particular session (e.g. `models-cache-invalidated`).
 * Subscribers that filter strictly by sessionId would otherwise drop
 * these broadcasts; check for this sentinel explicitly.
 */
export const BROADCAST_SESSION_ID = "";

// ---------------------------------------------------------------------------
// Events (main → renderer)
// ---------------------------------------------------------------------------

export type AgentEvent =
	// Session lifecycle
	| { type: "session-start"; sessionId: string; resumedFrom?: string }
	| {
			type: "session-state-change";
			sessionId: string;
			state: "idle" | "running" | "requires_action";
	  }
	| {
			type: "session-end";
			sessionId: string;
			reason: "completed" | "cancelled" | "error";
	  }

	// Text streaming
	| { type: "text-start"; messageId: string; parentToolCallId: string | null }
	| { type: "text-delta"; messageId: string; delta: string }
	| { type: "text-end"; messageId: string }

	// Reasoning (extended thinking)
	| {
			type: "reasoning-start";
			messageId: string;
			parentToolCallId: string | null;
	  }
	| { type: "reasoning-delta"; messageId: string; delta: string }
	| { type: "reasoning-end"; messageId: string; durationMs?: number }

	// Tool lifecycle
	| {
			type: "tool-input-start";
			toolCallId: string;
			toolName: string;
			parentToolCallId: string | null;
	  }
	| { type: "tool-input-delta"; toolCallId: string; argsDelta: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			args: unknown;
			parentToolCallId: string | null;
	  }
	| {
			type: "tool-progress";
			toolCallId: string;
			elapsedSeconds: number;
	  }
	| { type: "tool-result"; toolCallId: string; result: unknown }
	| {
			type: "tool-error";
			toolCallId: string;
			error: { message: string; raw?: unknown };
	  }

	// HITL permission
	| {
			type: "tool-permission-request";
			permissionId: string;
			toolCallId: string;
			toolName: string;
			args: unknown;
			suggestions?: string[];
			blockedPath?: string;
			decisionReason?: string;
	  }

	// Subagent tasks (maps SDKTaskStarted/Progress/Updated/Notification)
	| {
			type: "task-start";
			taskId: string;
			toolCallId?: string;
			description: string;
			taskType?: string;
			parentToolCallId: string | null;
			skipTranscript?: boolean;
	  }
	| {
			type: "task-progress";
			taskId: string;
			description: string;
			lastToolName?: string;
			usage: { totalTokens: number; toolUses: number; durationMs: number };
	  }
	| {
			type: "task-update";
			taskId: string;
			patch: {
				status?: "pending" | "running" | "completed" | "failed" | "killed";
				description?: string;
				endTime?: number;
				error?: string;
				isBackgrounded?: boolean;
			};
	  }
	| {
			type: "task-end";
			taskId: string;
			toolCallId?: string;
			status: "completed" | "failed" | "stopped";
			summary: string;
			outputFile?: string;
			usage?: { totalTokens: number; toolUses: number; durationMs: number };
	  }

	// Suggestions (pt autocomplete in composer)
	| { type: "prompt-suggestions"; suggestions: string[] }

	// Finish / error
	| {
			type: "finish";
			reason: string;
			usage: TokenUsage;
			totalCostUsd?: number;
			durationMs?: number;
	  }
	| {
			type: "error";
			error: { message: string; code?: string; recoverable: boolean };
	  }
	| { type: "session-model-changed"; sessionId: string; model: string }
	| { type: "session-info"; info: SessionInfoPatch }
	| { type: "models-cache-invalidated"; authMode: ClaudeAuthMode };

// ---------------------------------------------------------------------------
// Commands (renderer → main)
// ---------------------------------------------------------------------------

export type AgentCommand =
	| { type: "start-session"; config: SessionConfig; initialPrompt?: string }
	| { type: "send-message"; content: MessageContent }
	| {
			type: "approve-tool";
			permissionId: string;
			behavior: ApproveBehavior;
			modifiedArgs?: unknown;
	  }
	| { type: "reject-tool"; permissionId: string; reason?: string }
	| { type: "inject-message"; content: string }
	| { type: "cancel" }
	| { type: "resume-session"; sessionId: string; messageUuid?: string };

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isAgentEvent(value: unknown): value is AgentEvent {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof (value as { type: unknown }).type === "string"
	);
}

export function isTextEvent(
	event: AgentEvent,
): event is Extract<AgentEvent, { type: `text-${string}` }> {
	return event.type.startsWith("text-");
}

export function isToolEvent(
	event: AgentEvent,
): event is Extract<AgentEvent, { type: `tool-${string}` }> {
	return event.type.startsWith("tool-");
}

export function isTaskEvent(
	event: AgentEvent,
): event is Extract<AgentEvent, { type: `task-${string}` }> {
	return event.type.startsWith("task-");
}
