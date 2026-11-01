import type { ThreadEvent } from "@openai/codex-sdk";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/shared/agent-protocol";
import type { MessagePersister, PersistBlock } from "../claude/streaming";
import { type CodexThreadLike, runCodexTurn } from "./runner";

function fakeThread(
	events: ThreadEvent[],
	opts: { throwAfter?: Error; waitForAbort?: boolean } = {},
): CodexThreadLike {
	return {
		id: null,
		async runStreamed(_input, turnOptions) {
			async function* gen() {
				for (const event of events) yield event;
				if (opts.waitForAbort) {
					await new Promise<void>((resolve) => {
						turnOptions?.signal?.addEventListener("abort", () => resolve());
					});
					throw new Error("aborted");
				}
				if (opts.throwAfter) throw opts.throwAfter;
			}
			return { events: gen() };
		},
	};
}

function harness() {
	const sent: AgentEvent[] = [];
	const persisted: { blocks: PersistBlock[]; meta: unknown }[] = [];
	const order: string[] = [];
	const sender = {
		sendEvent: (_sid: string, event: AgentEvent) => {
			sent.push(event);
			order.push(`send:${event.type}`);
		},
	};
	const persister: MessagePersister = {
		appendMessage: async (_sid, _role, blocks, meta) => {
			persisted.push({ blocks: [...blocks], meta });
			order.push("persist");
		},
	};
	return { sent, persisted, order, sender, persister };
}

const usage = {
	input_tokens: 10,
	cached_input_tokens: 0,
	cache_write_input_tokens: 0,
	output_tokens: 5,
	reasoning_output_tokens: 0,
};

describe("runCodexTurn", () => {
	it("publica session-info antes do finish e grava o modelo resolvido", async () => {
		const h = harness();
		const onSessionInfo = vi.fn();
		const info = {
			resolvedModel: "gpt-6-astra",
			contextUsage: {
				usedTokens: 1200,
				maxTokens: 272000,
				updatedAt: "2026-11-01T10:00:00.000Z",
			},
		};
		await runCodexTurn({
			thread: fakeThread([
				{ type: "thread.started", thread_id: "th_9" },
				{
					type: "item.completed",
					item: { id: "item_0", type: "agent_message", text: "ok" },
				},
				{ type: "turn.completed", usage },
			]),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
			turnKey: "k",
			readSessionInfo: async () => info,
			onSessionInfo,
		});
		expect(onSessionInfo).toHaveBeenCalledWith(info);
		expect(h.sent).toContainEqual({ type: "session-info", info });
		expect(h.order.indexOf("send:session-info")).toBeLessThan(
			h.order.indexOf("send:finish"),
		);
		expect(h.persisted[0].meta).toMatchObject({ model: "gpt-6-astra" });
	});

	it("transmite eventos, persiste antes do finish e informa o thread id", async () => {
		const h = harness();
		const onThreadId = vi.fn();
		const outcome = await runCodexTurn({
			thread: fakeThread([
				{ type: "thread.started", thread_id: "th_123" },
				{ type: "turn.started" },
				{
					type: "item.completed",
					item: { id: "item_0", type: "agent_message", text: "pronto" },
				},
				{ type: "turn.completed", usage },
			]),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
			turnKey: "k",
			onThreadId,
		});
		expect(outcome).toBe("completed");
		expect(onThreadId).toHaveBeenCalledWith("th_123");
		expect(h.persisted).toHaveLength(1);
		expect(h.persisted[0].blocks).toEqual([{ type: "text", text: "pronto" }]);
		expect(h.persisted[0].meta).toMatchObject({
			usage: { input: 10, output: 5 },
		});
		const persistIdx = h.order.indexOf("persist");
		const finishIdx = h.order.indexOf("send:finish");
		expect(persistIdx).toBeGreaterThan(-1);
		expect(persistIdx).toBeLessThan(finishIdx);
		const finish = h.sent.find((e) => e.type === "finish");
		expect(finish).toMatchObject({ reason: "completed" });
		expect(typeof (finish as { durationMs?: number }).durationMs).toBe(
			"number",
		);
	});

	it("falha do CLI vira erro recuperável e finish com reason error", async () => {
		const h = harness();
		const outcome = await runCodexTurn({
			thread: fakeThread([{ type: "turn.started" }], {
				throwAfter: new Error("Codex Exec exited with code 1: not logged in"),
			}),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
		});
		expect(outcome).toBe("failed");
		expect(h.sent).toContainEqual({
			type: "error",
			error: {
				message: "Codex Exec exited with code 1: not logged in",
				recoverable: true,
			},
		});
		expect(h.sent.at(-2)).toMatchObject({ type: "finish", reason: "error" });
		expect(h.persisted).toHaveLength(0);
	});

	it("cancelamento persiste o parcial e fecha o turno como cancelled", async () => {
		const h = harness();
		const controller = new AbortController();
		const run = runCodexTurn({
			thread: fakeThread(
				[
					{ type: "turn.started" },
					{
						type: "item.completed",
						item: { id: "r", type: "reasoning", text: "plano" },
					},
					{
						type: "item.started",
						item: { id: "m", type: "agent_message", text: "comecei" },
					},
				],
				{ waitForAbort: true },
			),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: controller.signal,
		});
		await new Promise((r) => setTimeout(r, 10));
		controller.abort();
		expect(await run).toBe("cancelled");
		expect(h.persisted[0].blocks[0]).toMatchObject({
			type: "thinking",
			thinking: "plano",
		});
		const types = h.sent.map((e) => e.type);
		expect(types).toContain("text-end");
		expect(h.sent.find((e) => e.type === "finish")).toMatchObject({
			reason: "cancelled",
		});
		expect(types).not.toContain("error");
	});

	it("para de ler após um evento terminal", async () => {
		const h = harness();
		await runCodexTurn({
			thread: fakeThread([
				{ type: "turn.failed", error: { message: "limite" } },
				{
					type: "item.completed",
					item: { id: "x", type: "agent_message", text: "não deveria" },
				},
			]),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
		});
		expect(h.sent.some((e) => e.type === "text-start")).toBe(false);
		expect(h.sent[0]).toMatchObject({
			type: "error",
			error: { message: "limite" },
		});
	});

	it("continua após avisos de reconexão e conclui o turno", async () => {
		const h = harness();
		const outcome = await runCodexTurn({
			thread: fakeThread([
				{ type: "turn.started" },
				{ type: "error", message: "Reconnecting... 1/5" },
				{
					type: "item.completed",
					item: { id: "m", type: "agent_message", text: "voltei" },
				},
				{ type: "turn.completed", usage },
			]),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
		});
		expect(outcome).toBe("completed");
		expect(h.persisted[0].blocks).toEqual([{ type: "text", text: "voltei" }]);
	});

	it("falha após reconexões reporta a última mensagem uma vez", async () => {
		const h = harness();
		const outcome = await runCodexTurn({
			thread: fakeThread(
				[
					{ type: "turn.started" },
					{ type: "error", message: "Reconnecting... 4/5 (403)" },
					{ type: "error", message: "Reconnecting... 5/5 (403)" },
				],
				{ throwAfter: new Error("Codex Exec exited with code 1") },
			),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
		});
		expect(outcome).toBe("failed");
		const errors = h.sent.filter((e) => e.type === "error");
		expect(errors).toEqual([
			{
				type: "error",
				error: { message: "Reconnecting... 5/5 (403)", recoverable: true },
			},
		]);
	});

	it("stream que termina depois de um erro conta como falha", async () => {
		const h = harness();
		const outcome = await runCodexTurn({
			thread: fakeThread([
				{ type: "turn.started" },
				{ type: "error", message: "stream disconnected" },
			]),
			prompt: "oi",
			sessionId: "s1",
			sender: h.sender,
			persister: h.persister,
			signal: new AbortController().signal,
		});
		expect(outcome).toBe("failed");
		expect(h.sent.filter((e) => e.type === "error")).toHaveLength(1);
		expect(h.sent.find((e) => e.type === "finish")).toMatchObject({
			reason: "error",
		});
	});
});
