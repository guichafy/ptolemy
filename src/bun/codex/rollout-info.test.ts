import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	findRolloutFile,
	parseConfiguredModel,
	parseRolloutInfo,
	readCodexSessionInfo,
	resetRolloutCache,
} from "./rollout-info";

const fixedNow = () => new Date("2026-11-01T10:00:00.000Z");

const line = (value: unknown) => JSON.stringify(value);

const ROLLOUT = [
	line({ type: "session_meta", payload: { id: "t1" } }),
	line({ type: "turn_context", payload: { model: "gpt-old", cwd: "/x" } }),
	line({
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: { input_tokens: 99999, total_tokens: 99999 },
				last_token_usage: {
					input_tokens: 12000,
					cached_input_tokens: 8000,
					output_tokens: 500,
					reasoning_output_tokens: 120,
					total_tokens: 12500,
				},
				model_context_window: 272000,
			},
		},
	}),
	line({ type: "turn_context", payload: { model: "gpt-6-astra", cwd: "/x" } }),
	line({ type: "event_msg", payload: { type: "token_count", info: null } }),
	"not json {",
	"",
].join("\n");

describe("parseRolloutInfo", () => {
	it("takes the last turn model and the last request usage", () => {
		expect(parseRolloutInfo(ROLLOUT, fixedNow)).toEqual({
			resolvedModel: "gpt-6-astra",
			contextUsage: {
				usedTokens: 12500,
				maxTokens: 272000,
				inputTokens: 12000,
				outputTokens: 500,
				cacheReadTokens: 8000,
				reasoningTokens: 120,
				updatedAt: "2026-11-01T10:00:00.000Z",
			},
		});
	});

	it("returns null when the rollout has nothing useful", () => {
		expect(parseRolloutInfo(line({ type: "session_meta", payload: {} }))).toBe(
			null,
		);
	});
});

describe("parseConfiguredModel", () => {
	it("reads only the top-level model key", () => {
		expect(
			parseConfiguredModel(
				'# comment\nmodel_reasoning_effort = "high"\nmodel = "gpt-6.1-sol"\n[profiles.x]\nmodel = "other"',
			),
		).toBe("gpt-6.1-sol");
		expect(parseConfiguredModel('[profiles.x]\nmodel = "other"')).toBeNull();
		expect(parseConfiguredModel("")).toBeNull();
	});
});

describe("rollout lookup", () => {
	let home: string;

	beforeEach(async () => {
		resetRolloutCache();
		home = await mkdtemp(join(tmpdir(), "codex-home-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	it("finds the thread's rollout in the dated folders", async () => {
		const dir = join(home, "sessions", "2026", "11", "01");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "rollout-2026-11-01T09-00-00-other.jsonl"),
			"",
			"utf8",
		);
		const target = join(dir, "rollout-2026-11-01T09-30-00-thread-abc.jsonl");
		await writeFile(target, ROLLOUT, "utf8");

		expect(await findRolloutFile("thread-abc", home)).toBe(target);
		const info = await readCodexSessionInfo("thread-abc", home);
		expect(info?.resolvedModel).toBe("gpt-6-astra");
		expect(info?.contextUsage?.maxTokens).toBe(272000);
	});

	it("returns null for unknown threads or a missing sessions folder", async () => {
		expect(await readCodexSessionInfo("nope", home)).toBeNull();
		expect(await readCodexSessionInfo("", home)).toBeNull();
	});
});
