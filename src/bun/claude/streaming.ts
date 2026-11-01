import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	AgentEvent,
	SessionInfoPatch,
	SessionStats,
} from "@/shared/agent-protocol";
import {
	buildAgentEvents,
	createEventMapperContext,
	type EventMapperContext,
} from "./event-mapper";
import { createSessionInfoTracker } from "./session-info";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const VERBOSE = process.env.CLAUDE_LOG_VERBOSE === "1";
const verbose = (...args: unknown[]) => {
	if (VERBOSE) console.log(...args);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Abstraction for pushing typed agent events to the renderer.
 * Injected so this module stays decoupled from the RPC layer.
 */
export type StreamMessageSender = {
	sendEvent: (sessionId: string, event: AgentEvent) => void;
};

/** A content block for persistence (mirrors StoredMessageV2 blocks). */
export type PersistBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string; durationMs?: number }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: unknown;
			status: "running" | "done" | "error";
			elapsedSeconds?: number;
	  }
	| {
			type: "tool_result";
			toolUseId: string;
			content: string;
			isError?: boolean;
	  };

/** Metadata extracted from the SDK result message. */
export type ResultMeta = {
	totalCostUsd?: number;
	durationMs?: number;
	usage?: { input: number; output: number };
	/** Concrete model that answered (the alias resolved by the SDK). */
	model?: string;
};

/**
 * Abstraction for persisting assistant messages.
 * Injected so this module stays decoupled from the storage layer.
 */
export type MessagePersister = {
	appendMessage: (
		sessionId: string,
		role: "assistant",
		blocks: PersistBlock[],
		meta?: ResultMeta,
	) => Promise<void>;
};

export interface StreamingHooks {
	/** Fires once a `result` SDKMessage has been fully processed and persisted. */
	onTurnComplete?: () => void;
	/** Fires once when the SDK reveals its session id on the first message that carries it. */
	onSdkSessionId?: (sdkSessionId: string) => void;
	/** Fires when the resolved model or the context usage changes. */
	onSessionInfo?: (patch: SessionInfoPatch) => void;
	/** Persisted conversation totals the tracker continues from. */
	loadStats?: () => Promise<SessionStats | undefined>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts all structured content blocks from a complete SDKAssistantMessage.
 * Returns text, thinking, and tool_use blocks for persistence.
 */
function extractBlocksFromAssistantMessage(
	msg: SDKMessage,
): PersistBlock[] | null {
	if (msg.type !== "assistant") return null;
	const assistantMsg = msg as {
		type: "assistant";
		message: {
			content: Array<{
				type: string;
				text?: string;
				thinking?: string;
				id?: string;
				name?: string;
				input?: unknown;
			}>;
		};
	};
	const blocks: PersistBlock[] = [];
	for (const block of assistantMsg.message.content) {
		switch (block.type) {
			case "text":
				if (typeof block.text === "string" && block.text) {
					blocks.push({ type: "text", text: block.text });
				}
				break;
			case "thinking":
				if (typeof block.thinking === "string" && block.thinking) {
					blocks.push({ type: "thinking", thinking: block.thinking });
				}
				break;
			case "tool_use":
				blocks.push({
					type: "tool_use",
					id: block.id ?? "",
					name: block.name ?? "",
					input: block.input ?? {},
					status: "done",
				});
				break;
		}
	}
	return blocks.length > 0 ? blocks : null;
}

/**
 * Append `incoming` thinking blocks to `accumulated`, deduping by `thinking`
 * text. If a duplicate is found and the incoming version carries `durationMs`
 * while the existing one does not, the existing entry is upgraded in place.
 * `prepend` flips the insert position from end to beginning (used at result
 * time to keep thinking before text in the final transcript).
 */
function mergeThinkingBlocks(
	accumulated: PersistBlock[],
	incoming: PersistBlock[],
	prepend = false,
): void {
	for (const next of incoming) {
		if (next.type !== "thinking") continue;
		const existingIdx = accumulated.findIndex(
			(b) => b.type === "thinking" && b.thinking === next.thinking,
		);
		if (existingIdx === -1) {
			if (prepend) accumulated.unshift(next);
			else accumulated.push(next);
			continue;
		}
		const existing = accumulated[existingIdx] as Extract<
			PersistBlock,
			{ type: "thinking" }
		>;
		// Upgrade duration if we now have it and didn't before.
		if (next.durationMs !== undefined && existing.durationMs === undefined) {
			existing.durationMs = next.durationMs;
		}
	}
}

/**
 * Append assistant-message blocks to `accumulated`. Thinking blocks are
 * deduped via `mergeThinkingBlocks`; non-thinking blocks (text, tool_use)
 * are appended unconditionally — the SDK can send the same logical text
 * across multiple assistant chunks, but we treat each chunk as a distinct
 * append (matches pre-migration behavior).
 */
function mergeAssistantBlocks(
	accumulated: PersistBlock[],
	incoming: PersistBlock[],
): void {
	const thinkingPart: PersistBlock[] = [];
	for (const block of incoming) {
		if (block.type === "thinking") thinkingPart.push(block);
		else accumulated.push(block);
	}
	if (thinkingPart.length > 0) mergeThinkingBlocks(accumulated, thinkingPart);
}

/**
 * Extracts tool_result blocks from synthetic SDK user messages.
 * These carry the output of tool executions.
 */
function extractToolResultsFromUserMessage(
	msg: SDKMessage,
): PersistBlock[] | null {
	if (msg.type !== "user") return null;
	const userMsg = msg as {
		type: "user";
		message: {
			content:
				| string
				| Array<{
						type: string;
						tool_use_id?: string;
						content?: string | Array<{ type: string; text?: string }>;
						is_error?: boolean;
				  }>;
		};
	};
	if (typeof userMsg.message?.content === "string") return null;
	if (!Array.isArray(userMsg.message?.content)) return null;

	const blocks: PersistBlock[] = [];
	for (const block of userMsg.message.content) {
		if (block.type === "tool_result" && block.tool_use_id) {
			let contentStr = "";
			if (typeof block.content === "string") {
				contentStr = block.content;
			} else if (Array.isArray(block.content)) {
				contentStr = block.content
					.filter(
						(b): b is { type: string; text: string } =>
							b.type === "text" && typeof b.text === "string",
					)
					.map((b) => b.text)
					.join("");
			}
			blocks.push({
				type: "tool_result",
				toolUseId: block.tool_use_id,
				content: contentStr,
				isError: block.is_error ?? false,
			});
		}
	}
	return blocks.length > 0 ? blocks : null;
}

// ---------------------------------------------------------------------------
// Streaming loop
// ---------------------------------------------------------------------------

/**
 * Consumes the async stream from an SDK session, forwarding each message to
 * the sender and persisting the final assistant text once the result arrives.
 *
 * This function resolves when the stream ends (either by result or by the
 * generator returning). It rejects only on unexpected errors; normal SDK
 * errors (e.g. max turns) are forwarded as `agentEvent` `finish`/`error`.
 *
 * Accepts any `AsyncIterable<SDKMessage>` (e.g. the legacy `SDKSession.stream()`
 * or the stable `Query` returned by `query()`).
 *
 * `hooks.onTurnComplete` fires synchronously after each `result` message is
 * fully persisted and the per-turn state (`accumulatedBlocks`, `toolElapsed`)
 * has been cleared, but before the next turn's messages begin. Exceptions
 * thrown by the callback are caught and logged; they do not abort the stream.
 */
export async function startStreamingLoop(
	stream: AsyncIterable<SDKMessage>,
	sessionId: string,
	sender: StreamMessageSender,
	persister: MessagePersister,
	hooks: StreamingHooks = {},
): Promise<void> {
	const t0 = Date.now();
	console.log(`[claude:stream] loop start: sessionId=${sessionId}`);

	// Thinking blocks come from stream_event deltas (the SDK omits them
	// from the complete assistant message).
	let sdkSessionIdRecorded = false;
	let accumulatedBlocks: PersistBlock[] = [];
	const toolElapsed = new Map<string, number>();
	let currentThinking = "";
	let thinkingStartTime: number | null = null;
	const pendingThinkingBlocks: PersistBlock[] = [];
	let chunkCount = 0;
	let resultCount = 0;
	const mapperCtx: EventMapperContext = createEventMapperContext();
	let initialStats: SessionStats | undefined;
	try {
		initialStats = await hooks.loadStats?.();
	} catch (err) {
		console.warn(
			`[claude:stream] loadStats failed: sessionId=${sessionId}`,
			err,
		);
	}
	const infoTracker = createSessionInfoTracker(initialStats);

	function publishSessionInfo(patch: SessionInfoPatch | null): void {
		if (!patch) return;
		sender.sendEvent(sessionId, { type: "session-info", info: patch });
		try {
			hooks.onSessionInfo?.(patch);
		} catch (hookErr) {
			console.error(
				`[claude:stream] onSessionInfo hook threw: sessionId=${sessionId}`,
				hookErr,
			);
		}
	}

	function pushAgentEvents(msg: SDKMessage): void {
		for (const event of buildAgentEvents(msg, mapperCtx)) {
			sender.sendEvent(sessionId, event);
		}
	}

	try {
		for await (const msg of stream) {
			chunkCount++;
			verbose(
				`[claude:stream] chunk #${chunkCount}: sessionId=${sessionId} type=${msg.type}`,
			);

			if (!sdkSessionIdRecorded) {
				const candidate = (msg as { session_id?: unknown }).session_id;
				if (typeof candidate === "string" && candidate.length > 0) {
					sdkSessionIdRecorded = true; // latch FIRST
					try {
						hooks.onSdkSessionId?.(candidate);
					} catch (hookErr) {
						console.error(
							`[claude:stream] onSdkSessionId hook threw: sessionId=${sessionId}`,
							hookErr,
						);
					}
				}
			}

			// Session info goes out before the mapped events so the context
			// snapshot lands before `finish` on result messages.
			publishSessionInfo(
				msg.type === "result"
					? infoTracker.onResult(msg)
					: infoTracker.observe(msg),
			);
			pushAgentEvents(msg);

			// Track thinking blocks from stream_event deltas.
			// These may not appear in the complete assistant message.
			if (msg.type === "stream_event") {
				const partial = msg as {
					type: "stream_event";
					event: {
						type: string;
						index?: number;
						content_block?: { type: string };
						delta?: { type: string; thinking?: string };
					};
				};
				const evt = partial.event;

				if (
					evt.type === "content_block_start" &&
					evt.content_block?.type === "thinking"
				) {
					verbose(`[claude:stream] thinking start: sessionId=${sessionId}`);
					currentThinking = "";
					thinkingStartTime = Date.now();
				} else if (
					evt.type === "content_block_delta" &&
					evt.delta?.type === "thinking_delta" &&
					typeof evt.delta.thinking === "string"
				) {
					currentThinking += evt.delta.thinking;
				} else if (evt.type === "content_block_stop" && currentThinking) {
					const durationMs = thinkingStartTime
						? Date.now() - thinkingStartTime
						: undefined;
					verbose(
						`[claude:stream] thinking stop: sessionId=${sessionId} durationMs=${durationMs} chars=${currentThinking.length}`,
					);
					pendingThinkingBlocks.push({
						type: "thinking",
						thinking: currentThinking,
						durationMs,
					});
					currentThinking = "";
					thinkingStartTime = null;
				}
			}

			// Collect structured blocks from complete assistant messages
			const assistantBlocks = extractBlocksFromAssistantMessage(msg);
			if (assistantBlocks !== null) {
				// Stable `query()` may emit thinking in BOTH `stream_event` deltas
				// (with a duration we compute) AND in a complete assistant message
				// (without duration). It can also send multiple assistant chunks
				// per turn — one with thinking, then another with text. Deduping
				// by `hasThinking` on the current chunk alone is not enough; we
				// must check what's already been accumulated for this turn.
				const hasThinking = assistantBlocks.some((b) => b.type === "thinking");
				if (!hasThinking && pendingThinkingBlocks.length > 0) {
					mergeThinkingBlocks(accumulatedBlocks, pendingThinkingBlocks);
				}
				mergeAssistantBlocks(accumulatedBlocks, assistantBlocks);
				pendingThinkingBlocks.length = 0;
				verbose(
					`[claude:stream] assistant blocks extracted: sessionId=${sessionId} count=${assistantBlocks.length} types=[${assistantBlocks.map((b) => b.type).join(",")}]`,
				);
			}

			// Collect tool_result blocks from synthetic user messages
			const toolResults = extractToolResultsFromUserMessage(msg);
			if (toolResults !== null) {
				accumulatedBlocks.push(...toolResults);
				verbose(
					`[claude:stream] tool_result blocks: sessionId=${sessionId} count=${toolResults.length}`,
				);
			}

			// Track tool elapsed time from progress events
			if (msg.type === "tool_progress") {
				const progress = msg as {
					type: "tool_progress";
					tool_use_id: string;
					elapsed_time_seconds: number;
				};
				toolElapsed.set(progress.tool_use_id, progress.elapsed_time_seconds);
				verbose(
					`[claude:stream] tool_progress: id=${progress.tool_use_id} elapsed=${progress.elapsed_time_seconds}s`,
				);
			}

			if (msg.type === "result") {
				resultCount++;
				const result = msg as {
					type: "result";
					subtype: string;
					result?: string;
					total_cost_usd?: number;
					duration_ms?: number;
					usage?: { input_tokens?: number; output_tokens?: number };
				};

				const meta: ResultMeta = {};
				if (infoTracker.model) meta.model = infoTracker.model;
				// Per-turn cost: the SDK's total_cost_usd is cumulative for the
				// CLI process (see session-info.ts).
				if (infoTracker.lastTurnCostUsd !== null) {
					meta.totalCostUsd = infoTracker.lastTurnCostUsd;
				}
				if (typeof result.duration_ms === "number") {
					meta.durationMs = result.duration_ms;
				}
				if (result.usage) {
					const input = result.usage.input_tokens;
					const output = result.usage.output_tokens;
					if (typeof input === "number" && typeof output === "number") {
						meta.usage = { input, output };
					}
				}

				if (pendingThinkingBlocks.length > 0) {
					mergeThinkingBlocks(accumulatedBlocks, pendingThinkingBlocks, true);
					pendingThinkingBlocks.length = 0;
				}

				for (const block of accumulatedBlocks) {
					if (block.type === "tool_use" && toolElapsed.has(block.id)) {
						block.elapsedSeconds = toolElapsed.get(block.id);
					}
				}

				console.log(
					`[claude:stream] result: sessionId=${sessionId} subtype=${result.subtype} blocks=${accumulatedBlocks.length} cost=${meta.totalCostUsd ?? "?"} durationMs=${meta.durationMs ?? "?"} tokens=${meta.usage ? `${meta.usage.input}/${meta.usage.output}` : "?"}`,
				);

				// Persist BEFORE the `finish` agent event so the frontend's
				// loadMessages sees the new message if it re-reads on finish.
				if (accumulatedBlocks.length > 0) {
					verbose(
						`[claude:stream] persisting assistant message: sessionId=${sessionId} blocks=${accumulatedBlocks.length}`,
					);
					await persister.appendMessage(
						sessionId,
						"assistant",
						accumulatedBlocks,
						meta,
					);
				} else if (result.result) {
					verbose(
						`[claude:stream] persisting fallback text result: sessionId=${sessionId}`,
					);
					await persister.appendMessage(
						sessionId,
						"assistant",
						[{ type: "text", text: result.result }],
						meta,
					);
				}

				accumulatedBlocks = [];
				toolElapsed.clear();
				try {
					hooks.onTurnComplete?.();
				} catch (hookErr) {
					console.error(
						`[claude:stream] onTurnComplete hook threw: sessionId=${sessionId}`,
						hookErr,
					);
				}
			}
		}

		console.log(
			`[claude:stream] loop end: sessionId=${sessionId} chunks=${chunkCount} results=${resultCount} (${Date.now() - t0}ms)`,
		);
	} catch (err) {
		const errorMessage =
			err instanceof Error ? err.message : "Unknown streaming error";

		console.error(
			`[claude:stream] loop error: sessionId=${sessionId} chunks=${chunkCount} (${Date.now() - t0}ms)`,
			err,
		);

		if (pendingThinkingBlocks.length > 0) {
			accumulatedBlocks.unshift(...pendingThinkingBlocks);
		}

		if (accumulatedBlocks.length > 0) {
			try {
				await persister.appendMessage(
					sessionId,
					"assistant",
					accumulatedBlocks,
				);
			} catch {
				// Best-effort — don't mask the original error
			}
		}

		sender.sendEvent(sessionId, {
			type: "error",
			error: { message: errorMessage, recoverable: false },
		});
	}
}
