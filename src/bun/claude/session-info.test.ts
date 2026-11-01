import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { createSessionInfoTracker, pickContextWindow } from "./session-info";

const fixedNow = () => new Date("2026-11-01T10:00:00.000Z");

function init(model: string): SDKMessage {
	return { type: "system", subtype: "init", model } as unknown as SDKMessage;
}

function assistant(
	model: string,
	usage: Record<string, number>,
	parent: string | null = null,
): SDKMessage {
	return {
		type: "assistant",
		parent_tool_use_id: parent,
		message: { model, usage, content: [] },
	} as unknown as SDKMessage;
}

function result(
	modelUsage: Record<string, { contextWindow: number }>,
	cost = 0.12,
): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		total_cost_usd: cost,
		modelUsage,
	} as unknown as SDKMessage;
}

describe("createSessionInfoTracker", () => {
	it("reports the model from the init message once", () => {
		const t = createSessionInfoTracker();
		expect(t.observe(init("claude-sonnet-4-5-20250929"))).toEqual({
			resolvedModel: "claude-sonnet-4-5-20250929",
		});
		expect(t.observe(init("claude-sonnet-4-5-20250929"))).toBeNull();
		expect(t.model).toBe("claude-sonnet-4-5-20250929");
	});

	it("builds the context snapshot from the last top-level request", () => {
		const t = createSessionInfoTracker();
		t.observe(init("claude-opus-4-5"));
		t.observe(
			assistant("claude-opus-4-5", {
				input_tokens: 10,
				cache_read_input_tokens: 1000,
				cache_creation_input_tokens: 200,
				output_tokens: 50,
			}),
		);
		// Subagent requests must not overwrite the main context snapshot.
		t.observe(
			assistant(
				"claude-haiku-4-5",
				{ input_tokens: 99999, output_tokens: 1 },
				"toolu_1",
			),
		);
		const patch = t.onResult(
			result({ "claude-opus-4-5": { contextWindow: 200000 } }),
			fixedNow,
		);
		expect(patch).toEqual({
			resolvedModel: "claude-opus-4-5",
			contextUsage: {
				usedTokens: 1260,
				maxTokens: 200000,
				inputTokens: 10,
				outputTokens: 50,
				cacheReadTokens: 1000,
				cacheCreationTokens: 200,
				lastTurnCostUsd: 0.12,
				updatedAt: "2026-11-01T10:00:00.000Z",
			},
		});
	});

	it("derives the per-turn cost from the cumulative process total", () => {
		const t = createSessionInfoTracker();
		t.observe(assistant("m", { input_tokens: 1 }));
		t.onResult(result({}, 0.1), fixedNow);
		expect(t.lastTurnCostUsd).toBeCloseTo(0.1);
		t.observe(assistant("m", { input_tokens: 1 }));
		const patch = t.onResult(result({}, 0.25), fixedNow);
		expect(t.lastTurnCostUsd).toBeCloseTo(0.15);
		expect(patch?.contextUsage?.lastTurnCostUsd).toBeCloseTo(0.15);
	});

	it("takes the final output count from message_delta", () => {
		const t = createSessionInfoTracker();
		t.observe(assistant("m", { input_tokens: 100, output_tokens: 1 }));
		t.observe({
			type: "stream_event",
			parent_tool_use_id: null,
			event: { type: "message_delta", usage: { output_tokens: 20 } },
		} as unknown as SDKMessage);
		const patch = t.onResult(result({}), fixedNow);
		expect(patch?.contextUsage?.outputTokens).toBe(20);
		expect(patch?.contextUsage?.usedTokens).toBe(120);
	});

	it("returns null on result when no request usage was seen", () => {
		const t = createSessionInfoTracker();
		expect(t.onResult(result({}), fixedNow)).toBeNull();
	});

	it("picks up a model change from assistant messages", () => {
		const t = createSessionInfoTracker();
		t.observe(init("claude-sonnet-4-5"));
		expect(t.observe(assistant("claude-opus-4-5", {}))).toEqual({
			resolvedModel: "claude-opus-4-5",
		});
	});
});

describe("pickContextWindow", () => {
	it("matches the exact model, then partial keys, then the largest", () => {
		const usage = {
			"claude-haiku-4-5": { contextWindow: 200000 },
			"us.anthropic.claude-opus-4-5-v1:0": { contextWindow: 1000000 },
		};
		expect(pickContextWindow(usage, "claude-haiku-4-5")).toBe(200000);
		expect(pickContextWindow(usage, "claude-opus-4-5")).toBe(1000000);
		expect(pickContextWindow(usage, "unknown")).toBe(1000000);
		expect(pickContextWindow(undefined, "x")).toBeUndefined();
	});
});
