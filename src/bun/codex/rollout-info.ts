/**
 * Reads what `codex exec --experimental-json` does not stream: the concrete
 * model of a turn and how much of the context window the thread occupies.
 *
 * The JSONL stream only reports thread-wide cumulative usage on
 * `turn.completed`, which says nothing about the context window. The Codex
 * CLI also writes a rollout file per thread
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`) holding
 * `turn_context` items (with `model`) and `token_count` events (with
 * `last_token_usage` and `model_context_window`). That file is the same
 * source the Codex TUI uses for its own "context left" indicator.
 *
 * Everything here is best-effort: a missing, compressed or unreadable rollout
 * yields `null` and the chat simply shows no context gauge.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ContextUsageInfo,
	SessionInfoPatch,
} from "@/shared/agent-protocol";

interface RolloutTokenUsage {
	input_tokens?: number;
	cached_input_tokens?: number;
	cache_write_input_tokens?: number;
	output_tokens?: number;
	reasoning_output_tokens?: number;
	total_tokens?: number;
}

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
	return env.CODEX_HOME || join(homedir(), ".codex");
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Parses rollout JSONL text into a session-info patch: the model of the last
 * `turn_context` and the context usage of the last `token_count` event.
 */
export function parseRolloutInfo(
	text: string,
	now: () => Date = () => new Date(),
): SessionInfoPatch | null {
	let model: string | undefined;
	let last: RolloutTokenUsage | undefined;
	let window: number | undefined;

	for (const line of text.split("\n")) {
		if (!line) continue;
		// Cheap pre-filter: rollouts can be large and most lines are items.
		if (!line.includes('"turn_context"') && !line.includes('"token_count"')) {
			continue;
		}
		let entry: { type?: string; payload?: Record<string, unknown> };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const payload = entry.payload;
		if (!payload) continue;
		if (entry.type === "turn_context" && typeof payload.model === "string") {
			model = payload.model;
		} else if (
			entry.type === "event_msg" &&
			payload.type === "token_count" &&
			payload.info &&
			typeof payload.info === "object"
		) {
			const info = payload.info as {
				last_token_usage?: RolloutTokenUsage;
				model_context_window?: number | null;
			};
			if (info.last_token_usage) last = info.last_token_usage;
			if (typeof info.model_context_window === "number") {
				window = info.model_context_window;
			}
		}
	}

	const patch: SessionInfoPatch = {};
	if (model) patch.resolvedModel = model;
	if (last) {
		const input = num(last.input_tokens);
		const output = num(last.output_tokens);
		// Codex counts `total_tokens` as what sits in the context window.
		const used = num(last.total_tokens) || input + output;
		const usage: ContextUsageInfo = {
			usedTokens: used,
			inputTokens: input,
			outputTokens: output,
			cacheReadTokens: num(last.cached_input_tokens),
			reasoningTokens: num(last.reasoning_output_tokens),
			updatedAt: now().toISOString(),
		};
		const cacheWrite = num(last.cache_write_input_tokens);
		if (cacheWrite) usage.cacheCreationTokens = cacheWrite;
		if (window) usage.maxTokens = window;
		patch.contextUsage = usage;
	}
	return patch.resolvedModel || patch.contextUsage ? patch : null;
}

const pathCache = new Map<string, string>();

async function listDirs(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/**
 * Finds the plain `.jsonl` rollout of `threadId`, newest day folders first
 * (an active thread is almost always in today's folder). Paths are cached.
 */
export async function findRolloutFile(
	threadId: string,
	home: string = codexHome(),
): Promise<string | null> {
	const cached = pathCache.get(threadId);
	if (cached) return cached;
	const root = join(home, "sessions");
	const suffix = `${threadId}.jsonl`;
	for (const year of await listDirs(root)) {
		for (const month of await listDirs(join(root, year))) {
			for (const day of await listDirs(join(root, year, month))) {
				const dir = join(root, year, month, day);
				let names: string[];
				try {
					names = await readdir(dir);
				} catch {
					continue;
				}
				const hit = names.find(
					(n) => n.startsWith("rollout-") && n.endsWith(suffix),
				);
				if (hit) {
					const path = join(dir, hit);
					pathCache.set(threadId, path);
					return path;
				}
			}
		}
	}
	return null;
}

/** Reads the session info of a Codex thread from its rollout file. */
export async function readCodexSessionInfo(
	threadId: string,
	home: string = codexHome(),
): Promise<SessionInfoPatch | null> {
	if (!threadId) return null;
	try {
		const path = await findRolloutFile(threadId, home);
		if (!path) return null;
		return parseRolloutInfo(await readFile(path, "utf8"));
	} catch (err) {
		console.warn(`[codex:rollout] could not read ${threadId}:`, err);
		pathCache.delete(threadId);
		return null;
	}
}

/**
 * The model the Codex CLI uses when Ptolemy passes none: the top-level
 * `model` key of `$CODEX_HOME/config.toml` (keys under a `[table]` belong to
 * profiles or providers and are ignored).
 */
export function parseConfiguredModel(toml: string): string | null {
	for (const raw of toml.split("\n")) {
		const line = raw.trim();
		if (line.startsWith("[")) return null;
		const match = /^model\s*=\s*["']([^"']+)["']/.exec(line);
		if (match) return match[1];
	}
	return null;
}

export async function readConfiguredCodexModel(
	home: string = codexHome(),
): Promise<string | null> {
	try {
		return parseConfiguredModel(
			await readFile(join(home, "config.toml"), "utf8"),
		);
	} catch {
		return null;
	}
}

/** Test hook. */
export function resetRolloutCache(): void {
	pathCache.clear();
}
