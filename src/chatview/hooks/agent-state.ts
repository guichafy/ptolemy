/**
 * Pure reducer: `AgentEvent` → `AgentState`. Consumed by `useAgentChat`.
 *
 * Keeps no references to React, RPC, or timers, so it can be tested with
 * simple event fixtures.
 */

import type { StoredBlock, StoredMessage } from "@/chatview/rpc";
import type {
	AgentEvent,
	AgentKind,
	TokenUsage,
} from "@/shared/agent-protocol";

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

export type AgentTextPart = {
	kind: "text";
	messageId: string;
	text: string;
	streaming: boolean;
	parentToolCallId: string | null;
};

export type AgentReasoningPart = {
	kind: "reasoning";
	messageId: string;
	text: string;
	streaming: boolean;
	durationMs?: number;
	parentToolCallId: string | null;
};

export type AgentToolPart = {
	kind: "tool";
	toolCallId: string;
	toolName: string;
	parentToolCallId: string | null;
	status: "pending" | "running" | "completed" | "error";
	/** Streaming partial JSON accumulated from input_json_delta events. */
	argsStreaming: string;
	/** Fully parsed args once the assistant message arrives. */
	args: unknown;
	result?: unknown;
	error?: { message: string; raw?: unknown };
	elapsedSeconds?: number;
};

export type AgentPart = AgentTextPart | AgentReasoningPart | AgentToolPart;

export interface AgentMessage {
	id: string;
	role: "assistant" | "user";
	parts: AgentPart[];
	createdAt: number;
	/** Set when this user message used a per-turn model override. */
	modelUsed?: string;
}

export interface PendingPermission {
	permissionId: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
	suggestions?: string[];
	blockedPath?: string;
	decisionReason?: string;
	createdAt: number;
}

export interface TaskState {
	taskId: string;
	toolCallId?: string;
	description: string;
	taskType?: string;
	parentToolCallId: string | null;
	status: "pending" | "running" | "completed" | "failed" | "killed" | "stopped";
	lastToolName?: string;
	summary?: string;
	outputFile?: string;
	usage?: { totalTokens: number; toolUses: number; durationMs: number };
}

export type SessionState = "idle" | "running" | "requires_action" | "error";

export interface AgentState {
	sessionId: string | null;
	sessionState: SessionState;
	/** Completed assistant messages from prior turns. */
	messages: AgentMessage[];
	/** In-flight assistant message being streamed. Null when no turn is active. */
	currentMessage: AgentMessage | null;
	pendingPermissions: PendingPermission[];
	tasks: Record<string, TaskState>;
	lastError: { message: string; code?: string; recoverable: boolean } | null;
	usage: TokenUsage | null;
	totalCostUsd: number | null;
	durationMs: number | null;
	suggestions: string[];
	sessionModel: string | null;
	/** Agent backing the open session (null until the session meta loads). */
	sessionAgent: AgentKind | null;
}

export function initialAgentState(): AgentState {
	return {
		sessionId: null,
		sessionState: "idle",
		messages: [],
		currentMessage: null,
		pendingPermissions: [],
		tasks: {},
		lastError: null,
		usage: null,
		totalCostUsd: null,
		durationMs: null,
		suggestions: [],
		sessionModel: null,
		sessionAgent: null,
	};
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduceAgentState(
	state: AgentState,
	event: AgentEvent,
): AgentState {
	switch (event.type) {
		case "session-start":
			return {
				...initialAgentState(),
				sessionId: event.sessionId,
				sessionState: "running",
			};

		case "session-state-change":
			return { ...state, sessionState: event.state };

		case "session-end":
			return {
				...state,
				sessionState: event.reason === "error" ? "error" : "idle",
				currentMessage: null,
			};

		case "text-start":
			return upsertPart(state, event.messageId, {
				kind: "text",
				messageId: event.messageId,
				text: "",
				streaming: true,
				parentToolCallId: event.parentToolCallId,
			});

		case "text-delta":
			return updateTextPart(state, event.messageId, (part) => ({
				...part,
				text: part.text + event.delta,
			}));

		case "text-end":
			return updateTextPart(state, event.messageId, (part) => ({
				...part,
				streaming: false,
			}));

		case "reasoning-start":
			return upsertPart(state, event.messageId, {
				kind: "reasoning",
				messageId: event.messageId,
				text: "",
				streaming: true,
				parentToolCallId: event.parentToolCallId,
			});

		case "reasoning-delta":
			return updateReasoningPart(state, event.messageId, (part) => ({
				...part,
				text: part.text + event.delta,
			}));

		case "reasoning-end":
			return updateReasoningPart(state, event.messageId, (part) => ({
				...part,
				streaming: false,
				durationMs: event.durationMs,
			}));

		case "tool-input-start":
			return upsertToolPart(state, event.toolCallId, {
				kind: "tool",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				parentToolCallId: event.parentToolCallId,
				status: "running",
				argsStreaming: "",
				args: undefined,
			});

		case "tool-input-delta":
			return updateToolPart(state, event.toolCallId, (part) => ({
				...part,
				argsStreaming: part.argsStreaming + event.argsDelta,
			}));

		case "tool-call":
			return updateOrCreateToolPart(
				state,
				event.toolCallId,
				(part) => ({
					...part,
					toolName: event.toolName,
					args: event.args,
					status: part.status === "error" ? "error" : "running",
				}),
				{
					kind: "tool",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					parentToolCallId: event.parentToolCallId,
					status: "running",
					argsStreaming: "",
					args: event.args,
				},
			);

		case "tool-progress":
			return updateToolPart(state, event.toolCallId, (part) => ({
				...part,
				elapsedSeconds: event.elapsedSeconds,
			}));

		case "tool-result":
			return updateToolPart(state, event.toolCallId, (part) => ({
				...part,
				status: "completed",
				result: event.result,
			}));

		case "tool-error":
			return updateToolPart(state, event.toolCallId, (part) => ({
				...part,
				status: "error",
				error: event.error,
			}));

		case "tool-permission-request":
			return {
				...state,
				sessionState: "requires_action",
				pendingPermissions: [
					...state.pendingPermissions,
					{
						permissionId: event.permissionId,
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						args: event.args,
						suggestions: event.suggestions,
						blockedPath: event.blockedPath,
						decisionReason: event.decisionReason,
						createdAt: Date.now(),
					},
				],
			};

		case "task-start":
			return {
				...state,
				tasks: {
					...state.tasks,
					[event.taskId]: {
						taskId: event.taskId,
						toolCallId: event.toolCallId,
						description: event.description,
						taskType: event.taskType,
						parentToolCallId: event.parentToolCallId,
						status: "running",
					},
				},
			};

		case "task-progress":
			return updateTask(state, event.taskId, (task) => ({
				...task,
				description: event.description,
				lastToolName: event.lastToolName,
				usage: event.usage,
			}));

		case "task-update":
			return updateTask(state, event.taskId, (task) => ({
				...task,
				status: event.patch.status ?? task.status,
				description: event.patch.description ?? task.description,
			}));

		case "task-end":
			return updateTask(state, event.taskId, (task) => ({
				...task,
				status: event.status,
				summary: event.summary,
				outputFile: event.outputFile,
				usage: event.usage ?? task.usage,
			}));

		case "prompt-suggestions":
			return { ...state, suggestions: [...event.suggestions] };

		case "finish":
			return finalizeMessage(
				state,
				event.usage,
				event.totalCostUsd,
				event.durationMs,
			);

		case "error":
			return {
				...state,
				lastError: event.error,
				sessionState: event.error.recoverable ? state.sessionState : "error",
			};

		case "session-model-changed":
			return { ...state, sessionModel: event.model };

		default:
			return state;
	}
}

/**
 * Remove a pending permission from state. Commands are not events, so the
 * hook invokes this directly after approve/reject RPCs succeed.
 */
export function resolvePermission(
	state: AgentState,
	permissionId: string,
): AgentState {
	const remaining = state.pendingPermissions.filter(
		(p) => p.permissionId !== permissionId,
	);
	if (remaining.length === state.pendingPermissions.length) return state;
	return {
		...state,
		pendingPermissions: remaining,
		sessionState:
			remaining.length === 0 && state.sessionState === "requires_action"
				? "running"
				: state.sessionState,
	};
}

export type TurnStatus = "idle" | "waiting" | "receiving" | "tool_running";

export interface TurnStatusDetail {
	status: TurnStatus;
	/** Name of the first running tool, when status is "tool_running". */
	toolName?: string;
}

/**
 * Derive a UI-friendly turn status from the agent state, plus the name of
 * the currently-running tool (when applicable) so the indicator can label
 * the "tool_running" phase.
 *
 * - `idle`: no turn is in progress, or the session is waiting on a HITL
 *   permission / is in error. The conversation does not need a live indicator.
 * - `waiting`: the backend is running but nothing visible has arrived yet
 *   (between sendMessage and the first delta, or between a completed tool
 *   and the assistant's follow-up text).
 * - `receiving`: a text or reasoning part is currently streaming.
 * - `tool_running`: a tool is executing with no concurrent text streaming.
 *
 * Precedence is `receiving` > `tool_running` > `waiting`.
 */
export function computeTurnStatus(state: AgentState): TurnStatusDetail {
	const status = resolveStatus(state);
	const toolName =
		status === "tool_running" ? findRunningToolName(state) : undefined;
	return { status, toolName };
}

function resolveStatus(state: AgentState): TurnStatus {
	if (state.sessionState !== "running") return "idle";
	const parts = state.currentMessage?.parts ?? [];
	if (parts.some(isStreamingTextOrReasoning)) return "receiving";
	if (parts.some(isRunningTool)) return "tool_running";
	return "waiting";
}

function isStreamingTextOrReasoning(part: AgentPart): boolean {
	return (
		(part.kind === "text" && part.streaming) ||
		(part.kind === "reasoning" && part.streaming)
	);
}

function isRunningTool(part: AgentPart): boolean {
	return part.kind === "tool" && part.status === "running";
}

function findRunningToolName(state: AgentState): string | undefined {
	const part = state.currentMessage?.parts.find(isRunningTool);
	return part?.kind === "tool" ? part.toolName : undefined;
}

/**
 * Replace state.messages with the provided hydrated list. Clears
 * `currentMessage` because a just-completed turn has already been persisted
 * and re-materialized into the list — leaving an in-flight draft would cause
 * a duplicate bubble.
 */
export function hydrateMessages(
	state: AgentState,
	messages: AgentMessage[],
): AgentState {
	return {
		...state,
		messages,
		currentMessage: null,
	};
}

/**
 * Convert a persisted V2 message into an `AgentMessage`. Used to hydrate the
 * V2 chat when the window first opens (the initial prompt from the palette
 * has no agent event, and a race between `createSession` starting the stream
 * loop and the webview mounting can drop early deltas).
 */
export function storedToAgentMessage(
	stored: StoredMessage,
	index: number,
): AgentMessage {
	const id = `stored-${index}`;
	const parts: AgentPart[] = [];
	const toolPartsById = new Map<string, AgentToolPart>();

	for (const block of stored.blocks) {
		appendStoredBlock(block, id, parts, toolPartsById);
	}

	return {
		id,
		role: stored.role,
		parts,
		createdAt: Date.parse(stored.timestamp) || 0,
		...(stored.modelUsed && { modelUsed: stored.modelUsed }),
	};
}

function appendStoredBlock(
	block: StoredBlock,
	messageId: string,
	parts: AgentPart[],
	toolPartsById: Map<string, AgentToolPart>,
): void {
	switch (block.type) {
		case "text":
			parts.push({
				kind: "text",
				messageId,
				text: block.text,
				streaming: false,
				parentToolCallId: null,
			});
			return;
		case "thinking":
			parts.push({
				kind: "reasoning",
				messageId,
				text: block.thinking,
				streaming: false,
				durationMs: block.durationMs,
				parentToolCallId: null,
			});
			return;
		case "tool_use": {
			const part: AgentToolPart = {
				kind: "tool",
				toolCallId: block.id,
				toolName: block.name,
				parentToolCallId: null,
				status: mapStoredToolStatus(block.status),
				argsStreaming: "",
				args: block.input,
				elapsedSeconds: block.elapsedSeconds,
			};
			parts.push(part);
			toolPartsById.set(block.id, part);
			return;
		}
		case "tool_result": {
			const tool = toolPartsById.get(block.toolUseId);
			if (!tool) return;
			if (block.isError) {
				tool.status = "error";
				tool.error = { message: block.content };
			} else {
				tool.status = "completed";
				tool.result = block.content;
			}
			return;
		}
	}
}

function mapStoredToolStatus(
	status: "running" | "done" | "error",
): AgentToolPart["status"] {
	return status === "done" ? "completed" : status;
}

/**
 * True when the last message on disk is from the user — i.e. the backend
 * still owes a response. Used by hydration to detect an in-flight turn when
 * the chat window opens for a session just created by the palette (the SDK
 * may not emit `session_state_changed("running")` promptly, so we infer the
 * in-flight state from the persisted transcript).
 */
export function hasPendingTurn(messages: AgentMessage[]): boolean {
	const last = messages[messages.length - 1];
	return last?.role === "user";
}

/**
 * Flip sessionState to "running" immediately after the user submits, so the
 * turn indicator appears during the gap between `claudeSendMessage` and the
 * first SDK event. The backend's `session-state-change` events keep the
 * state accurate from that point on.
 *
 * Leaves `requires_action` untouched — a pending HITL permission must stay
 * blocking until the user decides.
 */
export function markTurnStart(state: AgentState): AgentState {
	if (state.sessionState === "requires_action") return state;
	return {
		...state,
		sessionState: "running",
		lastError: null,
	};
}

/**
 * Append an optimistic user message to state. The hook calls this when the
 * user submits from the composer, before the RPC round-trip.
 */
export function appendUserMessage(
	state: AgentState,
	id: string,
	text: string,
	modelUsed?: string,
): AgentState {
	return {
		...state,
		messages: [
			...state.messages,
			{
				id,
				role: "user",
				parts: [
					{
						kind: "text",
						messageId: id,
						text,
						streaming: false,
						parentToolCallId: null,
					},
				],
				createdAt: Date.now(),
				...(modelUsed && { modelUsed }),
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureCurrentMessage(
	state: AgentState,
	messageId: string,
): AgentState & { currentMessage: AgentMessage } {
	if (state.currentMessage) {
		return state as AgentState & { currentMessage: AgentMessage };
	}
	const message: AgentMessage = {
		id: messageId,
		role: "assistant",
		parts: [],
		createdAt: Date.now(),
	};
	return { ...state, currentMessage: message };
}

function upsertPart(
	state: AgentState,
	messageId: string,
	part: AgentTextPart | AgentReasoningPart,
): AgentState {
	const withMessage = ensureCurrentMessage(state, messageId);
	return {
		...withMessage,
		currentMessage: {
			...withMessage.currentMessage,
			parts: [...withMessage.currentMessage.parts, part],
		},
	};
}

function updateTextPart(
	state: AgentState,
	messageId: string,
	update: (part: AgentTextPart) => AgentTextPart,
): AgentState {
	if (!state.currentMessage) return state;
	let touched = false;
	const parts = state.currentMessage.parts.map((p) => {
		if (p.kind !== "text") return p;
		if (p.messageId !== messageId) return p;
		if (!p.streaming) return p;
		touched = true;
		return update(p);
	});
	if (!touched) return state;
	return {
		...state,
		currentMessage: { ...state.currentMessage, parts },
	};
}

function updateReasoningPart(
	state: AgentState,
	messageId: string,
	update: (part: AgentReasoningPart) => AgentReasoningPart,
): AgentState {
	if (!state.currentMessage) return state;
	let touched = false;
	const parts = state.currentMessage.parts.map((p) => {
		if (p.kind !== "reasoning") return p;
		if (p.messageId !== messageId) return p;
		if (!p.streaming) return p;
		touched = true;
		return update(p);
	});
	if (!touched) return state;
	return {
		...state,
		currentMessage: { ...state.currentMessage, parts },
	};
}

function upsertToolPart(
	state: AgentState,
	toolCallId: string,
	part: AgentToolPart,
): AgentState {
	// Tools may start streaming before we've seen any text content, so the
	// current message may still be null. Synthesize one keyed off the tool
	// call id; it'll be reconciled later when text-start or tool-call fire.
	const messageId = state.currentMessage?.id ?? `pending:${toolCallId}`;
	const withMessage = ensureCurrentMessage(state, messageId);
	return {
		...withMessage,
		currentMessage: {
			...withMessage.currentMessage,
			parts: [...withMessage.currentMessage.parts, part],
		},
	};
}

function updateToolPart(
	state: AgentState,
	toolCallId: string,
	update: (part: AgentToolPart) => AgentToolPart,
): AgentState {
	if (!state.currentMessage) return state;
	let touched = false;
	const parts = state.currentMessage.parts.map((p) => {
		if (p.kind !== "tool") return p;
		if (p.toolCallId !== toolCallId) return p;
		touched = true;
		return update(p);
	});
	if (!touched) return state;
	return {
		...state,
		currentMessage: { ...state.currentMessage, parts },
	};
}

function updateOrCreateToolPart(
	state: AgentState,
	toolCallId: string,
	update: (part: AgentToolPart) => AgentToolPart,
	create: AgentToolPart,
): AgentState {
	const existing = state.currentMessage?.parts.find(
		(p): p is AgentToolPart => p.kind === "tool" && p.toolCallId === toolCallId,
	);
	if (existing) return updateToolPart(state, toolCallId, update);
	return upsertToolPart(state, toolCallId, create);
}

function updateTask(
	state: AgentState,
	taskId: string,
	update: (task: TaskState) => TaskState,
): AgentState {
	const task = state.tasks[taskId];
	if (!task) return state;
	return { ...state, tasks: { ...state.tasks, [taskId]: update(task) } };
}

function finalizeMessage(
	state: AgentState,
	usage: TokenUsage,
	totalCostUsd: number | undefined,
	durationMs: number | undefined,
): AgentState {
	const base: AgentState = {
		...state,
		sessionState: "idle",
		usage,
		totalCostUsd: totalCostUsd ?? state.totalCostUsd,
		durationMs: durationMs ?? state.durationMs,
	};
	if (!state.currentMessage) return base;
	return {
		...base,
		messages: [...state.messages, state.currentMessage],
		currentMessage: null,
	};
}
