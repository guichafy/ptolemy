import type { ThreadEvent } from "@openai/codex-sdk";
import type { AgentEvent, SessionInfoPatch } from "@/shared/agent-protocol";
import type {
	MessagePersister,
	StreamMessageSender,
} from "../claude/streaming";
import {
	createCodexMapperContext,
	endTurnEvents,
	isTerminalEvent,
	mapCodexEvent,
} from "./event-mapper";

/** The slice of the SDK's `Thread` the runner needs (kept narrow for tests). */
export interface CodexThreadLike {
	readonly id: string | null;
	runStreamed(
		input: string,
		turnOptions?: { signal?: AbortSignal },
	): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

export interface RunCodexTurnArgs {
	thread: CodexThreadLike;
	prompt: string;
	/** Ptolemy's internal session id (the `agentEvent` routing key). */
	sessionId: string;
	sender: StreamMessageSender;
	persister: MessagePersister;
	signal: AbortSignal;
	/** Namespaces item ids for this turn; random by default. */
	turnKey?: string;
	/** Fires when Codex reveals the thread id (first turn of a new thread). */
	onThreadId?: (threadId: string) => void;
	/**
	 * Reads the resolved model and context usage once the turn's stream is
	 * over (the JSONL stream does not carry them; see `rollout-info.ts`).
	 */
	readSessionInfo?: () => Promise<SessionInfoPatch | null>;
	/** Fires with the patch from `readSessionInfo`, for persistence. */
	onSessionInfo?: (patch: SessionInfoPatch) => void;
	now?: () => number;
}

export type CodexTurnOutcome = "completed" | "failed" | "cancelled";

const MAX_ERROR_CHARS = 600;

function streamErrorEvent(message: string): AgentEvent {
	return {
		type: "error",
		error: { message: message || "Falha no Codex", recoverable: true },
	};
}

function errorMessage(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	const trimmed = raw.trim();
	return trimmed.length > MAX_ERROR_CHARS
		? `…${trimmed.slice(-MAX_ERROR_CHARS)}`
		: trimmed || "Falha ao executar o Codex";
}

/**
 * Runs one Codex turn end to end: streams mapped events to the renderer,
 * persists the assistant message, then emits the closing `finish` event.
 *
 * Persisting before `finish` matters: the chat re-reads `messages.json` when
 * it sees `finish`, which is how deltas lost to the window-creation race are
 * recovered (same invariant as the Claude streaming loop).
 *
 * Never throws; failures become `error` + `finish` events and the outcome.
 */
export async function runCodexTurn(
	args: RunCodexTurnArgs,
): Promise<CodexTurnOutcome> {
	const now = args.now ?? Date.now;
	const turnKey = args.turnKey ?? crypto.randomUUID().slice(0, 8);
	const ctx = createCodexMapperContext(args.sessionId, turnKey, now);
	const startedAt = now();
	const send = (events: AgentEvent[]) => {
		for (const event of events) args.sender.sendEvent(args.sessionId, event);
	};

	let outcome: CodexTurnOutcome | null = null;
	let closing: AgentEvent[] = [];

	try {
		const { events } = await args.thread.runStreamed(args.prompt, {
			signal: args.signal,
		});
		for await (const event of events) {
			if (event.type === "thread.started") {
				try {
					args.onThreadId?.(event.thread_id);
				} catch (hookErr) {
					console.error("[codex:turn] onThreadId hook threw:", hookErr);
				}
			}
			const mapped = mapCodexEvent(event, ctx);
			if (isTerminalEvent(event)) {
				closing = mapped;
				outcome = event.type === "turn.completed" ? "completed" : "failed";
				break;
			}
			send(mapped);
		}
		if (!outcome) {
			// Stream ended without turn.completed/turn.failed: an abort, or a
			// CLI that gave up after reporting an error.
			outcome = args.signal.aborted
				? "cancelled"
				: ctx.lastStreamError
					? "failed"
					: "completed";
			closing = endTurnEvents(ctx, outcome === "failed" ? "error" : outcome);
			if (outcome === "failed" && !ctx.lastStreamErrorReported) {
				closing.unshift(streamErrorEvent(ctx.lastStreamError ?? ""));
			}
		}
	} catch (err) {
		if (args.signal.aborted) {
			outcome = "cancelled";
			closing = endTurnEvents(ctx, "cancelled");
		} else {
			console.error(`[codex:turn] sessionId=${args.sessionId} failed:`, err);
			outcome = "failed";
			// The CLI's exit message is usually generic; the last stream
			// error (e.g. the final "Reconnecting... 5/5") says what went wrong.
			const message =
				ctx.lastStreamError && !ctx.lastStreamErrorReported
					? ctx.lastStreamError
					: errorMessage(err);
			closing = [streamErrorEvent(message), ...endTurnEvents(ctx, "error")];
		}
	}

	const durationMs = now() - startedAt;

	let info: SessionInfoPatch | null = null;
	if (outcome !== "cancelled" && args.readSessionInfo) {
		try {
			info = await args.readSessionInfo();
		} catch (err) {
			console.warn("[codex:turn] readSessionInfo failed:", err);
		}
	}
	if (info) {
		send([{ type: "session-info", info }]);
		try {
			args.onSessionInfo?.(info);
		} catch (hookErr) {
			console.error("[codex:turn] onSessionInfo hook threw:", hookErr);
		}
	}

	if (ctx.blocks.length > 0) {
		try {
			await args.persister.appendMessage(
				args.sessionId,
				"assistant",
				ctx.blocks,
				{
					durationMs,
					...(info?.resolvedModel && { model: info.resolvedModel }),
					...(ctx.usage && {
						usage: {
							input: ctx.usage.input_tokens,
							output: ctx.usage.output_tokens,
						},
					}),
				},
			);
		} catch (err) {
			console.error("[codex:turn] persist failed:", err);
		}
	}

	send(
		closing.map((event) =>
			event.type === "finish" ? { ...event, durationMs } : event,
		),
	);
	console.log(
		`[codex:turn] done: sessionId=${args.sessionId} outcome=${outcome} blocks=${ctx.blocks.length} (${durationMs}ms)`,
	);
	return outcome;
}
