/**
 * Tracks what the Claude SDK reveals about the live session: the concrete
 * model behind the configured alias (`default`, `sonnet`, ...) and how much of
 * the context window the conversation occupies.
 *
 * Pure and stateful per streaming loop, so it is testable with plain
 * `SDKMessage` fixtures. The streaming loop feeds every message through
 * `observe()` and calls `onResult()` once per turn.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	ContextUsageInfo,
	SessionInfoPatch,
	SessionStats,
} from "@/shared/agent-protocol";

interface RequestUsage {
	input_tokens?: number | null;
	output_tokens?: number | null;
	cache_read_input_tokens?: number | null;
	cache_creation_input_tokens?: number | null;
}

interface ModelUsageEntry {
	contextWindow?: number;
}

export interface SessionInfoTracker {
	/**
	 * Feeds one SDK message. Returns a patch when the resolved model changes
	 * (system `init`, or the first top-level assistant message of a model).
	 */
	observe(msg: SDKMessage): SessionInfoPatch | null;
	/** Builds the context snapshot for the turn that just ended. */
	onResult(msg: SDKMessage, now?: () => Date): SessionInfoPatch | null;
	/** Last concrete model seen, or null before the first init/assistant message. */
	readonly model: string | null;
	/** Cost of the turn closed by the last `onResult`, in USD. */
	readonly lastTurnCostUsd: number | null;
	/** Conversation totals, seeded from the persisted meta. */
	readonly stats: SessionStats;
}

function num(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Picks the context window for `model` out of the result's `modelUsage`.
 * Keys are full model ids; fall back to the largest window reported so a
 * key mismatch (Bedrock prefixes, date suffixes) still yields a value.
 */
export function pickContextWindow(
	modelUsage: Record<string, ModelUsageEntry> | undefined,
	model: string | null,
): number | undefined {
	if (!modelUsage) return undefined;
	const entries = Object.entries(modelUsage);
	if (entries.length === 0) return undefined;
	if (model) {
		const exact = modelUsage[model]?.contextWindow;
		if (exact) return exact;
		const partial = entries.find(
			([key]) => key.includes(model) || model.includes(key),
		);
		if (partial?.[1].contextWindow) return partial[1].contextWindow;
	}
	const windows = entries
		.map(([, value]) => value.contextWindow ?? 0)
		.filter((w) => w > 0);
	return windows.length > 0 ? Math.max(...windows) : undefined;
}

export function createSessionInfoTracker(
	initialStats?: SessionStats,
	now: () => Date = () => new Date(),
): SessionInfoTracker {
	// Totals carry over from earlier CLI processes (the persisted meta); the
	// tracker only adds what this process reports.
	let stats: SessionStats = {
		compactions: 0,
		...initialStats,
	};
	let model: string | null = null;
	let lastUsage: RequestUsage | null = null;
	// `total_cost_usd` is cumulative for the CLI process, which lives as long
	// as this streaming loop; the per-turn cost is the difference.
	let costSoFar = 0;
	let lastTurnCost: number | null = null;

	const setModel = (next: unknown): SessionInfoPatch | null => {
		if (typeof next !== "string" || !next || next === model) return null;
		model = next;
		return { resolvedModel: next };
	};

	return {
		get model() {
			return model;
		},

		get lastTurnCostUsd() {
			return lastTurnCost;
		},

		get stats() {
			return stats;
		},

		observe(msg) {
			if (msg.type === "system") {
				const sys = msg as {
					subtype?: string;
					model?: unknown;
					compact_metadata?: {
						trigger?: "manual" | "auto";
						pre_tokens?: number;
					};
				};
				if (sys.subtype === "init") return setModel(sys.model);
				if (sys.subtype === "compact_boundary") {
					stats = {
						...stats,
						compactions: stats.compactions + 1,
						lastCompaction: {
							trigger: sys.compact_metadata?.trigger,
							preTokens: sys.compact_metadata?.pre_tokens,
							at: now().toISOString(),
						},
					};
					return { stats };
				}
				return null;
			}
			if (msg.type === "stream_event") {
				// Assistant messages are emitted per content block, before the
				// final `message_delta` carries the real output token count.
				const ev = msg as {
					parent_tool_use_id?: string | null;
					event?: { type?: string; usage?: { output_tokens?: number } };
				};
				const out = ev.event?.usage?.output_tokens;
				if (
					!ev.parent_tool_use_id &&
					ev.event?.type === "message_delta" &&
					typeof out === "number" &&
					lastUsage
				) {
					lastUsage = { ...lastUsage, output_tokens: out };
				}
				return null;
			}
			if (msg.type === "assistant") {
				const assistant = msg as {
					parent_tool_use_id: string | null;
					message?: { model?: unknown; usage?: RequestUsage };
				};
				// Subagent requests run in their own context window.
				if (assistant.parent_tool_use_id) return null;
				if (assistant.message?.usage) lastUsage = assistant.message.usage;
				return setModel(assistant.message?.model);
			}
			return null;
		},

		onResult(msg, resultNow = now) {
			if (msg.type !== "result") return null;
			const result = msg as {
				total_cost_usd?: number;
				modelUsage?: Record<string, ModelUsageEntry>;
			};
			lastTurnCost = null;
			if (typeof result.total_cost_usd === "number") {
				lastTurnCost = Math.max(0, result.total_cost_usd - costSoFar);
				costSoFar = Math.max(costSoFar, result.total_cost_usd);
				stats = {
					...stats,
					totalCostUsd: (stats.totalCostUsd ?? 0) + lastTurnCost,
				};
			}
			const usage = lastUsage;
			lastUsage = null;
			if (!usage) return lastTurnCost === null ? null : { stats };
			const input = num(usage.input_tokens);
			const output = num(usage.output_tokens);
			const cacheRead = num(usage.cache_read_input_tokens);
			const cacheCreation = num(usage.cache_creation_input_tokens);
			const contextUsage: ContextUsageInfo = {
				usedTokens: input + cacheRead + cacheCreation + output,
				inputTokens: input,
				outputTokens: output,
				cacheReadTokens: cacheRead,
				cacheCreationTokens: cacheCreation,
				updatedAt: resultNow().toISOString(),
			};
			const maxTokens = pickContextWindow(result.modelUsage, model);
			if (maxTokens) contextUsage.maxTokens = maxTokens;
			if (lastTurnCost !== null) contextUsage.lastTurnCostUsd = lastTurnCost;
			return {
				contextUsage,
				stats,
				...(model ? { resolvedModel: model } : {}),
			};
		},
	};
}
