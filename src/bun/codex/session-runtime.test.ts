import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/shared/agent-protocol";
import type { MessagePersister } from "../claude/streaming";
import { CODEX_DEFAULT_MODEL } from "./constants";
import type { CodexThreadLike } from "./runner";
import {
	buildThreadOptions,
	type CodexRuntimeDeps,
	CodexSessionRuntime,
	type CodexTurnConfig,
} from "./session-runtime";

const config: CodexTurnConfig = {
	model: "gpt-6.1-sol",
	sandboxMode: "workspace-write",
	reasoningEffort: "",
};

const usage = {
	input_tokens: 1,
	cached_input_tokens: 0,
	cache_write_input_tokens: 0,
	output_tokens: 1,
	reasoning_output_tokens: 0,
};

describe("buildThreadOptions", () => {
	it("prende o Codex ao diretório do projeto, sem aprovação interativa", () => {
		expect(buildThreadOptions(config, "/proj")).toEqual({
			sandboxMode: "workspace-write",
			workingDirectory: "/proj",
			skipGitRepoCheck: true,
			approvalPolicy: "never",
			model: "gpt-6.1-sol",
		});
	});

	it("omite o modelo quando a sessão usa o padrão do Codex", () => {
		const opts = buildThreadOptions(
			{ ...config, model: CODEX_DEFAULT_MODEL },
			"/proj",
		);
		expect(opts.model).toBeUndefined();
	});

	it("aplica o override de modelo do turno e o esforço de raciocínio", () => {
		const opts = buildThreadOptions(
			{ ...config, reasoningEffort: "high", sandboxMode: "read-only" },
			"/proj",
			"gpt-6-luna",
		);
		expect(opts).toMatchObject({
			model: "gpt-6-luna",
			modelReasoningEffort: "high",
			sandboxMode: "read-only",
		});
	});
});

function makeRuntime(overrides: Partial<CodexRuntimeDeps> = {}) {
	const sent: AgentEvent[] = [];
	const persister: MessagePersister = { appendMessage: async () => {} };
	const calls: {
		threadId: string | null;
		options: ThreadOptions;
		prompt: string;
	}[] = [];
	const createThread = vi.fn(
		async (threadId: string | null, options: ThreadOptions) => {
			const thread: CodexThreadLike = {
				id: threadId,
				async runStreamed(prompt) {
					calls.push({ threadId, options, prompt });
					async function* gen(): AsyncGenerator<ThreadEvent> {
						if (!threadId)
							yield { type: "thread.started", thread_id: "th_new" };
						yield { type: "turn.started" };
						yield { type: "turn.completed", usage };
					}
					return { events: gen() };
				},
			};
			return thread;
		},
	);
	const onThreadId = vi.fn();
	const runtime = new CodexSessionRuntime({
		sessionId: "s1",
		cwd: "/proj",
		threadId: null,
		sender: { sendEvent: (_sid, e) => sent.push(e) },
		persister,
		loadConfig: async () => config,
		onThreadId,
		createThread,
		...overrides,
	});
	return { runtime, sent, calls, createThread, onThreadId };
}

describe("CodexSessionRuntime", () => {
	it("inicia um thread novo e retoma o mesmo thread no turno seguinte", async () => {
		const { runtime, calls, onThreadId } = makeRuntime();
		await runtime.enqueue("primeiro");
		await runtime.enqueue("segundo");
		expect(calls.map((c) => c.threadId)).toEqual([null, "th_new"]);
		expect(onThreadId).toHaveBeenCalledTimes(1);
		expect(onThreadId).toHaveBeenCalledWith("th_new");
		expect(runtime.threadId).toBe("th_new");
	});

	it("passes per-invocation native Skill disabling configuration to the SDK on every resumed turn", async () => {
		const skillConfig = {
			skills: { config: [{ path: "/native/review/SKILL.md", enabled: false }] },
		};
		const createThread = vi.fn(
			async (
				_id: string | null,
				_options: ThreadOptions,
				_config: Record<string, unknown>,
			) => ({
				id: "thread",
				async runStreamed() {
					return {
						events: (async function* () {
							yield { type: "turn.completed" as const, usage };
						})(),
					};
				},
			}),
		);
		const { runtime } = makeRuntime({
			createThread,
			loadSkillConfig: async () => skillConfig,
		});
		await runtime.enqueue("first");
		await runtime.enqueue("resume");
		expect(createThread.mock.calls.map((call) => call[2])).toEqual([
			skillConfig,
			skillConfig,
		]);
	});

	it("serializa turnos enviados enquanto outro está rodando", async () => {
		const { runtime, calls } = makeRuntime();
		const a = runtime.enqueue("a");
		const b = runtime.enqueue("b");
		expect(runtime.busy).toBe(true);
		await Promise.all([a, b]);
		expect(calls.map((c) => c.prompt)).toEqual(["a", "b"]);
		expect(runtime.busy).toBe(false);
	});

	it("override de modelo vale só para aquele turno", async () => {
		const { runtime, calls } = makeRuntime();
		await runtime.enqueue("a", "gpt-6-luna");
		await runtime.enqueue("b");
		expect(calls[0].options.model).toBe("gpt-6-luna");
		expect(calls[1].options.model).toBe("gpt-6.1-sol");
	});

	it("falha de preparação vira erro recuperável + finish", async () => {
		const { runtime, sent } = makeRuntime({
			createThread: async () => {
				throw new Error("Codex CLI não encontrado");
			},
		});
		await runtime.enqueue("a");
		expect(sent).toEqual([
			{
				type: "error",
				error: { message: "Codex CLI não encontrado", recoverable: true },
			},
			{
				type: "finish",
				reason: "error",
				usage: { inputTokens: 0, outputTokens: 0 },
			},
		]);
	});

	it("stop sem turno ativo retorna false", () => {
		const { runtime } = makeRuntime();
		expect(runtime.stop()).toBe(false);
	});

	it("close impede turnos que ainda estavam na fila", async () => {
		const { runtime, calls } = makeRuntime();
		const pending = runtime.enqueue("a");
		await runtime.close();
		await pending;
		expect(calls).toHaveLength(0);
	});
});
