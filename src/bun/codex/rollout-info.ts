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
	ContextBreakdown,
	ContextUsageInfo,
	SessionInfoPatch,
	SessionStats,
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

interface RolloutLine {
	timestamp?: string;
	type?: string;
	payload?: Record<string, unknown>;
}

function* rolloutLines(text: string, kinds: string[]): Generator<RolloutLine> {
	for (const line of text.split("\n")) {
		if (!line) continue;
		// Cheap pre-filter: rollouts can be large and most lines are skipped.
		if (!kinds.some((k) => line.includes(`"${k}"`))) continue;
		try {
			const entry = JSON.parse(line) as RolloutLine;
			if (entry?.payload && typeof entry.payload === "object") yield entry;
		} catch {
			// Partial line while Codex is still writing, or garbage: skip.
		}
	}
}

/**
 * Parses rollout JSONL text into a session-info patch: the model of the last
 * `turn_context`, the context usage of the last `token_count` event and the
 * number of compactions.
 *
 * OpenAI counts cached tokens inside `input_tokens`; the patch normalizes to
 * Anthropic's convention (input excludes cache) so the UI can show input and
 * cache side by side without double counting.
 */
export function parseRolloutInfo(
	text: string,
	now: () => Date = () => new Date(),
): SessionInfoPatch | null {
	let model: string | undefined;
	let last: RolloutTokenUsage | undefined;
	let window: number | undefined;
	const stats: SessionStats = { compactions: 0 };

	for (const entry of rolloutLines(text, [
		"turn_context",
		"token_count",
		"compacted",
	])) {
		const payload = entry.payload as Record<string, unknown>;
		if (entry.type === "turn_context" && typeof payload.model === "string") {
			model = payload.model;
		} else if (entry.type === "compacted") {
			stats.compactions += 1;
			stats.lastCompaction = { at: entry.timestamp ?? now().toISOString() };
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
		const cached = num(last.cached_input_tokens);
		const output = num(last.output_tokens);
		// Codex counts `total_tokens` as what sits in the context window.
		const used = num(last.total_tokens) || input + output;
		const usage: ContextUsageInfo = {
			usedTokens: used,
			inputTokens: Math.max(0, input - cached),
			outputTokens: output,
			cacheReadTokens: cached,
			reasoningTokens: num(last.reasoning_output_tokens),
			updatedAt: now().toISOString(),
		};
		const cacheWrite = num(last.cache_write_input_tokens);
		if (cacheWrite) usage.cacheCreationTokens = cacheWrite;
		if (window) usage.maxTokens = window;
		patch.contextUsage = usage;
	}
	if (patch.resolvedModel || patch.contextUsage || stats.compactions > 0) {
		patch.stats = stats;
	}
	return patch.resolvedModel || patch.contextUsage ? patch : null;
}

// ---------------------------------------------------------------------------
// Context breakdown (estimate)
// ---------------------------------------------------------------------------

/** Rough chars-per-token ratio for mixed prose/code. */
const CHARS_PER_TOKEN = 4;

const CATEGORY = {
	system: "Prompt do sistema e ferramentas",
	developer: "Instruções do desenvolvedor",
	environment: "Ambiente e AGENTS.md",
	user: "Mensagens do usuário",
	assistant: "Respostas do agente",
	reasoning: "Raciocínio",
	toolCalls: "Chamadas de ferramenta",
	toolOutputs: "Saídas de ferramenta",
	summary: "Resumo da compactação",
} as const;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) =>
			c &&
			typeof c === "object" &&
			typeof (c as { text?: unknown }).text === "string"
				? (c as { text: string }).text
				: "",
		)
		.join("");
}

function isEnvironmentText(text: string): boolean {
	const head = text.trimStart().slice(0, 40);
	return (
		head.startsWith("<environment_context>") ||
		head.startsWith("<user_instructions>") ||
		head.startsWith("# AGENTS.md") ||
		head.startsWith("<permissions")
	);
}

/**
 * Estimates what fills a Codex thread's context window from its rollout.
 * Each history item since the last compaction is sized by text length and
 * bucketed by kind; buckets are scaled so they never exceed the usage Codex
 * reported, and the remainder is the system prompt + tool schemas, which the
 * rollout does not record.
 */
export function estimateCodexBreakdown(
	text: string,
	usage: ContextUsageInfo | undefined,
	model?: string,
): ContextBreakdown | null {
	if (!usage) return null;
	const chars = new Map<string, number>();
	const toolChars = new Map<string, number>();
	const callNames = new Map<string, string>();
	const add = (bucket: string, n: number) =>
		chars.set(bucket, (chars.get(bucket) ?? 0) + n);
	const addTool = (name: string, n: number) =>
		toolChars.set(name, (toolChars.get(name) ?? 0) + n);

	for (const entry of rolloutLines(text, ["response_item", "compacted"])) {
		const p = entry.payload as Record<string, unknown>;
		if (entry.type === "compacted") {
			// Everything before a compaction left the window.
			chars.clear();
			toolChars.clear();
			add(CATEGORY.summary, String(p.message ?? "").length);
			continue;
		}
		if (entry.type !== "response_item") continue;
		const size = JSON.stringify(p).length;
		switch (p.type) {
			case "message": {
				const body = textOf(p.content);
				const n = body.length || size;
				if (p.role === "assistant") add(CATEGORY.assistant, n);
				else if (p.role === "developer" || p.role === "system")
					add(CATEGORY.developer, n);
				else if (isEnvironmentText(body)) add(CATEGORY.environment, n);
				else add(CATEGORY.user, n);
				break;
			}
			case "reasoning": {
				const enc =
					typeof p.encrypted_content === "string"
						? p.encrypted_content.length * 0.75
						: 0;
				add(CATEGORY.reasoning, enc || size);
				break;
			}
			case "function_call":
			case "custom_tool_call":
			case "local_shell_call":
			case "web_search_call":
			case "tool_search_call": {
				const name =
					typeof p.name === "string"
						? p.name
						: p.type === "local_shell_call"
							? "shell"
							: String(p.type).replace(/_call$/, "");
				if (typeof p.call_id === "string") callNames.set(p.call_id, name);
				add(CATEGORY.toolCalls, size);
				addTool(name, size);
				break;
			}
			case "function_call_output":
			case "custom_tool_call_output":
			case "tool_search_output": {
				const name =
					(typeof p.call_id === "string" && callNames.get(p.call_id)) ||
					"ferramenta";
				add(CATEGORY.toolOutputs, size);
				addTool(name, size);
				break;
			}
			default:
				add(CATEGORY.developer, size);
		}
	}

	const used = usage.usedTokens;
	const rawTotal = [...chars.values()].reduce((a, b) => a + b, 0);
	const rawTokens = rawTotal / CHARS_PER_TOKEN;
	const scale = rawTokens > used && rawTokens > 0 ? used / rawTokens : 1;
	const toTokens = (c: number) => Math.round((c / CHARS_PER_TOKEN) * scale);

	const categories = [...chars.entries()]
		.map(([name, c]) => ({ name, tokens: toTokens(c) }))
		.filter((c) => c.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);
	const accounted = categories.reduce((a, c) => a + c.tokens, 0);
	const remainder = Math.max(0, used - accounted);
	if (remainder > 0) {
		categories.unshift({ name: CATEGORY.system, tokens: remainder });
	}

	const tools = [...toolChars.entries()]
		.map(([name, c]) => ({ name, tokens: toTokens(c) }))
		.filter((t) => t.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, 12);

	return {
		source: "codex-estimate",
		model,
		usedTokens: used,
		maxTokens: usage.maxTokens,
		categories,
		sections: tools.length
			? [{ title: "Ferramentas (chamadas + saídas)", items: tools }]
			: [],
		note: "Estimativa: o Codex informa só o total. As fatias vêm do tamanho de cada item do histórico da thread (~4 caracteres por token); o restante é o prompt do sistema e as definições de ferramentas, que não ficam gravados.",
	};
}

/** Reads the rollout of `threadId` and estimates its context breakdown. */
export async function readCodexContextBreakdown(
	threadId: string,
	home: string = codexHome(),
): Promise<ContextBreakdown | null> {
	if (!threadId) return null;
	const path = await findRolloutFile(threadId, home);
	if (!path) return null;
	const text = await readFile(path, "utf8");
	const info = parseRolloutInfo(text);
	return estimateCodexBreakdown(text, info?.contextUsage, info?.resolvedModel);
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
