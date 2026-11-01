/**
 * Pure event mapper: Codex `ThreadEvent` → `AgentEvent[]` + persistence blocks.
 *
 * Codex streams *items* (agent message, reasoning, command, file change, MCP
 * call, web search, to-do list), each going through `item.started` →
 * `item.updated`* → `item.completed`. The chat UI speaks the Claude-shaped
 * `AgentEvent` protocol, so this module translates one into the other and,
 * in the same pass, accumulates the `PersistBlock`s the session manager
 * writes to `messages.json` when the turn ends.
 *
 * Item ids restart at `item_0` on every `codex exec` run, and each turn is a
 * separate run, so every id is namespaced with a per-turn key. Without that,
 * a tool call from turn 2 would update the tool part of turn 1 in the UI.
 */

import type { ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk";
import type { AgentEvent, TokenUsage } from "@/shared/agent-protocol";
import type { PersistBlock } from "../claude/streaming";

// Tool names chosen to read naturally in the existing tool block UI.
export const CODEX_TOOL_NAMES = {
	command: "Shell",
	fileChange: "ApplyPatch",
	webSearch: "WebSearch",
	todoList: "TodoWrite",
} as const;

export interface CodexMapperContext {
	sessionId: string;
	/** Namespaces item ids for this turn. */
	turnKey: string;
	/** Item keys whose start event was already emitted. */
	started: Set<string>;
	/** Text/reasoning chars already streamed, per item key. */
	streamedChars: Map<string, number>;
	/** Text/reasoning streams opened but not yet closed. */
	openStreams: Map<string, "text" | "reasoning">;
	/** When a reasoning item was first seen, for `durationMs`. */
	reasoningStartedAt: Map<string, number>;
	/** When a tool item was first seen, for `elapsedSeconds`. */
	toolStartedAt: Map<string, number>;
	/** Blocks to persist as the assistant message for this turn. */
	blocks: PersistBlock[];
	usage: Usage | null;
	/** Last top-level `error` message, used if the stream ends abruptly. */
	lastStreamError: string | null;
	/** Whether `lastStreamError` was already sent to the renderer. */
	lastStreamErrorReported: boolean;
	now: () => number;
}

export function createCodexMapperContext(
	sessionId: string,
	turnKey: string,
	now: () => number = Date.now,
): CodexMapperContext {
	return {
		sessionId,
		turnKey,
		started: new Set(),
		streamedChars: new Map(),
		openStreams: new Map(),
		reasoningStartedAt: new Map(),
		toolStartedAt: new Map(),
		blocks: [],
		usage: null,
		lastStreamError: null,
		lastStreamErrorReported: false,
		now,
	};
}

export function itemKey(ctx: CodexMapperContext, item: ThreadItem): string {
	return `${ctx.turnKey}:${item.id}`;
}

const TRANSIENT_NOTICE = /^(reconnecting|falling back)\b/i;

/** Retry/transport notices the CLI emits as `error` while it recovers. */
export function isTransientNotice(message: string): boolean {
	return TRANSIENT_NOTICE.test(message.trim());
}

/**
 * True for events after which no more items arrive in this turn.
 *
 * Top-level `error` events are deliberately NOT terminal: the CLI also uses
 * them for transient notices such as "Reconnecting... 2/5", after which the
 * turn carries on. A real failure still ends with `turn.failed` or a
 * non-zero CLI exit, both handled by the runner.
 */
export function isTerminalEvent(event: ThreadEvent): boolean {
	return event.type === "turn.completed" || event.type === "turn.failed";
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export function mapCodexEvent(
	event: ThreadEvent,
	ctx: CodexMapperContext,
): AgentEvent[] {
	switch (event.type) {
		case "thread.started":
			// Captured by the runner (thread id → SessionMeta.sdkSessionId).
			return [];
		case "turn.started":
			return [
				{
					type: "session-state-change",
					sessionId: ctx.sessionId,
					state: "running",
				},
			];
		case "item.started":
		case "item.updated":
			return mapItem(event.item, ctx, false);
		case "item.completed":
			return mapItem(event.item, ctx, true);
		case "turn.completed":
			ctx.usage = event.usage;
			return [
				...closeOpenStreams(ctx),
				finishEvent("completed", event.usage),
				idleEvent(ctx),
			];
		case "turn.failed":
			return failureEvents(ctx, event.error.message);
		case "error": {
			ctx.lastStreamError = event.message || "Erro no Codex";
			// Retry chatter ("Reconnecting... 2/5", transport fallback) is only
			// logged; if the turn ends up failing, the runner reports the last
			// message once.
			if (isTransientNotice(ctx.lastStreamError)) {
				console.warn(`[codex:stream] ${ctx.lastStreamError}`);
				return [];
			}
			ctx.lastStreamErrorReported = true;
			return [
				{
					type: "error",
					error: { message: ctx.lastStreamError, recoverable: true },
				},
			];
		}
		default:
			return [];
	}
}

/**
 * Events closing a turn that ended without `turn.completed`, e.g. an abort or
 * a crashed CLI. `reason` lands on the `finish` event.
 */
export function endTurnEvents(
	ctx: CodexMapperContext,
	reason: "completed" | "cancelled" | "error",
): AgentEvent[] {
	return [...closeOpenStreams(ctx), finishEvent(reason, null), idleEvent(ctx)];
}

function failureEvents(ctx: CodexMapperContext, message: string): AgentEvent[] {
	return [
		{
			type: "error",
			error: { message: message || "Falha no Codex", recoverable: true },
		},
		...endTurnEvents(ctx, "error"),
	];
}

function finishEvent(reason: string, usage: Usage | null): AgentEvent {
	return { type: "finish", reason, usage: toTokenUsage(usage) };
}

function idleEvent(ctx: CodexMapperContext): AgentEvent {
	return {
		type: "session-state-change",
		sessionId: ctx.sessionId,
		state: "idle",
	};
}

export function toTokenUsage(usage: Usage | null): TokenUsage {
	if (!usage) return { inputTokens: 0, outputTokens: 0 };
	return {
		inputTokens: usage.input_tokens,
		outputTokens: usage.output_tokens,
		cacheReadTokens: usage.cached_input_tokens,
		cacheCreationTokens: usage.cache_write_input_tokens,
	};
}

/** Closes text/reasoning streams so the UI never shows a stuck cursor. */
function closeOpenStreams(ctx: CodexMapperContext): AgentEvent[] {
	const events: AgentEvent[] = [];
	for (const [key, kind] of ctx.openStreams) {
		if (kind === "text") {
			events.push({ type: "text-end", messageId: key });
		} else {
			const startedAt = ctx.reasoningStartedAt.get(key);
			events.push({
				type: "reasoning-end",
				messageId: key,
				durationMs: startedAt === undefined ? undefined : ctx.now() - startedAt,
			});
		}
	}
	ctx.openStreams.clear();
	return events;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function mapItem(
	item: ThreadItem,
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	switch (item.type) {
		case "agent_message":
			return mapStreamedText(item.id, item.text, "text", ctx, completed);
		case "reasoning":
			return mapStreamedText(item.id, item.text, "reasoning", ctx, completed);
		case "command_execution":
			return mapCommand(item, ctx, completed);
		case "file_change":
			return mapFileChange(item, ctx, completed);
		case "mcp_tool_call":
			return mapMcpCall(item, ctx, completed);
		case "web_search":
			return mapWebSearch(item, ctx, completed);
		case "todo_list":
			return mapTodoList(item, ctx, completed);
		case "error": {
			// Non-fatal: surface once, the turn keeps going.
			const key = itemKey(ctx, item);
			if (ctx.started.has(key)) return [];
			ctx.started.add(key);
			return [
				{ type: "error", error: { message: item.message, recoverable: true } },
			];
		}
		default:
			return [];
	}
}

function mapStreamedText(
	rawId: string,
	text: string,
	kind: "text" | "reasoning",
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	const key = `${ctx.turnKey}:${rawId}`;
	const events: AgentEvent[] = [];
	if (!ctx.started.has(key)) {
		ctx.started.add(key);
		ctx.openStreams.set(key, kind);
		if (kind === "reasoning") ctx.reasoningStartedAt.set(key, ctx.now());
		events.push({
			type: kind === "text" ? "text-start" : "reasoning-start",
			messageId: key,
			parentToolCallId: null,
		});
	}
	if (!ctx.openStreams.has(key)) return events; // already ended

	const sent = ctx.streamedChars.get(key) ?? 0;
	if (text.length > sent) {
		const delta = text.slice(sent);
		ctx.streamedChars.set(key, text.length);
		events.push({
			type: kind === "text" ? "text-delta" : "reasoning-delta",
			messageId: key,
			delta,
		});
	}

	if (completed) {
		ctx.openStreams.delete(key);
		if (kind === "text") {
			events.push({ type: "text-end", messageId: key });
			if (text) ctx.blocks.push({ type: "text", text });
		} else {
			const startedAt = ctx.reasoningStartedAt.get(key) ?? ctx.now();
			const durationMs = ctx.now() - startedAt;
			events.push({ type: "reasoning-end", messageId: key, durationMs });
			if (text)
				ctx.blocks.push({ type: "thinking", thinking: text, durationMs });
		}
	}
	return events;
}

/** Emits `tool-call` (first sight or args change) and records the start time. */
function toolCall(
	key: string,
	toolName: string,
	args: unknown,
	ctx: CodexMapperContext,
	alwaysEmit = false,
): AgentEvent[] {
	if (ctx.started.has(key) && !alwaysEmit) return [];
	if (!ctx.started.has(key)) {
		ctx.started.add(key);
		ctx.toolStartedAt.set(key, ctx.now());
	}
	return [
		{
			type: "tool-call",
			toolCallId: key,
			toolName,
			args,
			parentToolCallId: null,
		},
	];
}

function elapsedSeconds(key: string, ctx: CodexMapperContext): number {
	const startedAt = ctx.toolStartedAt.get(key) ?? ctx.now();
	return Math.max(0, Math.round((ctx.now() - startedAt) / 1000));
}

/** Pushes the tool_use + tool_result pair for a finished tool. */
function persistTool(
	ctx: CodexMapperContext,
	key: string,
	name: string,
	input: unknown,
	output: string,
	isError: boolean,
): void {
	ctx.blocks.push({
		type: "tool_use",
		id: key,
		name,
		input,
		status: isError ? "error" : "done",
		elapsedSeconds: elapsedSeconds(key, ctx),
	});
	ctx.blocks.push({
		type: "tool_result",
		toolUseId: key,
		content: output,
		isError,
	});
}

function toolOutcome(
	key: string,
	output: string,
	isError: boolean,
	errorMessage: string,
): AgentEvent {
	return isError
		? { type: "tool-error", toolCallId: key, error: { message: errorMessage } }
		: { type: "tool-result", toolCallId: key, result: output };
}

function mapCommand(
	item: Extract<ThreadItem, { type: "command_execution" }>,
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	const key = itemKey(ctx, item);
	const name = CODEX_TOOL_NAMES.command;
	const args = { command: item.command };
	const events = toolCall(key, name, args, ctx);
	if (!completed) {
		if (events.length === 0) {
			events.push({
				type: "tool-progress",
				toolCallId: key,
				elapsedSeconds: elapsedSeconds(key, ctx),
			});
		}
		return events;
	}
	const failed =
		item.status === "failed" ||
		(typeof item.exit_code === "number" && item.exit_code !== 0);
	const output = item.aggregated_output ?? "";
	const message =
		output.trim() ||
		(typeof item.exit_code === "number"
			? `Comando terminou com código ${item.exit_code}`
			: "Comando falhou");
	events.push(toolOutcome(key, output, failed, message));
	persistTool(ctx, key, name, args, failed ? message : output, failed);
	return events;
}

function mapFileChange(
	item: Extract<ThreadItem, { type: "file_change" }>,
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	const key = itemKey(ctx, item);
	const name = CODEX_TOOL_NAMES.fileChange;
	const args = { changes: item.changes };
	const events = toolCall(key, name, args, ctx);
	if (!completed) return events;
	const failed = item.status === "failed";
	const summary = item.changes
		.map((c) => `${changeLabel(c.kind)} ${c.path}`)
		.join("\n");
	const message = summary
		? `Falha ao aplicar:\n${summary}`
		: "Falha ao aplicar patch";
	events.push(toolOutcome(key, summary, failed, message));
	persistTool(ctx, key, name, args, failed ? message : summary, failed);
	return events;
}

function changeLabel(kind: "add" | "delete" | "update"): string {
	switch (kind) {
		case "add":
			return "adicionado";
		case "delete":
			return "removido";
		default:
			return "alterado";
	}
}

function mapMcpCall(
	item: Extract<ThreadItem, { type: "mcp_tool_call" }>,
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	const key = itemKey(ctx, item);
	const name = `mcp__${item.server}__${item.tool}`;
	const events = toolCall(key, name, item.arguments ?? {}, ctx);
	if (!completed) return events;
	const failed = item.status === "failed" || Boolean(item.error);
	const output = failed ? "" : stringifyMcpResult(item.result);
	const message = item.error?.message ?? "Falha na ferramenta MCP";
	events.push(toolOutcome(key, output, failed, message));
	persistTool(
		ctx,
		key,
		name,
		item.arguments ?? {},
		failed ? message : output,
		failed,
	);
	return events;
}

function stringifyMcpResult(
	result: Extract<ThreadItem, { type: "mcp_tool_call" }>["result"],
): string {
	if (!result) return "";
	const text = (result.content ?? [])
		.map((block) =>
			block && typeof block === "object" && "text" in block
				? String((block as { text: unknown }).text ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
	if (text) return text;
	if (
		result.structured_content !== undefined &&
		result.structured_content !== null
	) {
		try {
			return JSON.stringify(result.structured_content, null, 2);
		} catch {
			return String(result.structured_content);
		}
	}
	return "";
}

function mapWebSearch(
	item: Extract<ThreadItem, { type: "web_search" }>,
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	const key = itemKey(ctx, item);
	const name = CODEX_TOOL_NAMES.webSearch;
	const args = { query: item.query };
	const events = toolCall(key, name, args, ctx);
	if (!completed) return events;
	events.push(toolOutcome(key, "", false, ""));
	persistTool(ctx, key, name, args, "", false);
	return events;
}

function mapTodoList(
	item: Extract<ThreadItem, { type: "todo_list" }>,
	ctx: CodexMapperContext,
	completed: boolean,
): AgentEvent[] {
	const key = itemKey(ctx, item);
	const name = CODEX_TOOL_NAMES.todoList;
	const args = {
		todos: item.items.map((t) => ({
			content: t.text,
			status: t.completed ? "completed" : "pending",
		})),
	};
	// The plan changes as steps complete, so re-emit the args every time.
	const events = toolCall(key, name, args, ctx, true);
	if (!completed) return events;
	const summary = item.items
		.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.text}`)
		.join("\n");
	events.push(toolOutcome(key, summary, false, ""));
	persistTool(ctx, key, name, args, summary, false);
	return events;
}
