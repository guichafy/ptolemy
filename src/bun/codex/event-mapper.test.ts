import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/shared/agent-protocol";
import {
	CODEX_TOOL_NAMES,
	createCodexMapperContext,
	endTurnEvents,
	isTerminalEvent,
	mapCodexEvent,
} from "./event-mapper";

const clock = { t: 0 };

function ctxAt(start = 0) {
	clock.t = start;
	return createCodexMapperContext("sess-1", "t1", () => clock.t);
}

const started = (item: ThreadItem): ThreadEvent => ({
	type: "item.started",
	item,
});
const updated = (item: ThreadItem): ThreadEvent => ({
	type: "item.updated",
	item,
});
const completed = (item: ThreadItem): ThreadEvent => ({
	type: "item.completed",
	item,
});

function types(events: AgentEvent[]): string[] {
	return events.map((e) => e.type);
}

describe("mapCodexEvent: turnos", () => {
	it("turn.started vira session-state-change running", () => {
		const ctx = ctxAt();
		expect(mapCodexEvent({ type: "turn.started" }, ctx)).toEqual([
			{ type: "session-state-change", sessionId: "sess-1", state: "running" },
		]);
	});

	it("thread.started não emite eventos", () => {
		expect(
			mapCodexEvent({ type: "thread.started", thread_id: "th_1" }, ctxAt()),
		).toEqual([]);
	});

	it("turn.completed emite finish com uso de tokens e volta para idle", () => {
		const ctx = ctxAt();
		const events = mapCodexEvent(
			{
				type: "turn.completed",
				usage: {
					input_tokens: 100,
					cached_input_tokens: 40,
					cache_write_input_tokens: 5,
					output_tokens: 20,
					reasoning_output_tokens: 3,
				},
			},
			ctx,
		);
		expect(events).toEqual([
			{
				type: "finish",
				reason: "completed",
				usage: {
					inputTokens: 100,
					outputTokens: 20,
					cacheReadTokens: 40,
					cacheCreationTokens: 5,
				},
			},
			{ type: "session-state-change", sessionId: "sess-1", state: "idle" },
		]);
		expect(ctx.usage?.input_tokens).toBe(100);
	});

	it("turn.failed emite erro recuperável, finish e idle", () => {
		const events = mapCodexEvent(
			{ type: "turn.failed", error: { message: "quota" } },
			ctxAt(),
		);
		expect(types(events)).toEqual(["error", "finish", "session-state-change"]);
		expect(events[0]).toEqual({
			type: "error",
			error: { message: "quota", recoverable: true },
		});
		expect(events[1]).toMatchObject({ type: "finish", reason: "error" });
	});

	it("avisos de reconexão ficam só no log, sem encerrar o turno", () => {
		const ctx = ctxAt();
		expect(
			mapCodexEvent({ type: "error", message: "Reconnecting... 1/5" }, ctx),
		).toEqual([]);
		expect(
			mapCodexEvent(
				{ type: "error", message: "Falling back from WebSockets to HTTPS" },
				ctx,
			),
		).toEqual([]);
		expect(ctx.lastStreamError).toBe("Falling back from WebSockets to HTTPS");
		expect(ctx.lastStreamErrorReported).toBe(false);
	});

	it("outros erros de stream viram aviso recuperável", () => {
		const ctx = ctxAt();
		expect(
			mapCodexEvent({ type: "error", message: "model not supported" }, ctx),
		).toEqual([
			{
				type: "error",
				error: { message: "model not supported", recoverable: true },
			},
		]);
		expect(ctx.lastStreamErrorReported).toBe(true);
	});

	it("identifica eventos terminais", () => {
		expect(isTerminalEvent({ type: "turn.started" })).toBe(false);
		// "Reconnecting... 2/5" chega como `error` e o turno continua.
		expect(isTerminalEvent({ type: "error", message: "x" })).toBe(false);
		expect(
			isTerminalEvent({ type: "turn.failed", error: { message: "x" } }),
		).toBe(true);
	});
});

describe("mapCodexEvent: mensagens e raciocínio", () => {
	it("agent_message completo vira text-start/delta/end e bloco persistido", () => {
		const ctx = ctxAt();
		const events = mapCodexEvent(
			completed({ id: "item_0", type: "agent_message", text: "Olá" }),
			ctx,
		);
		expect(events).toEqual([
			{ type: "text-start", messageId: "t1:item_0", parentToolCallId: null },
			{ type: "text-delta", messageId: "t1:item_0", delta: "Olá" },
			{ type: "text-end", messageId: "t1:item_0" },
		]);
		expect(ctx.blocks).toEqual([{ type: "text", text: "Olá" }]);
	});

	it("agent_message atualizado envia só o trecho novo", () => {
		const ctx = ctxAt();
		mapCodexEvent(
			started({ id: "item_0", type: "agent_message", text: "Ol" }),
			ctx,
		);
		const upd = mapCodexEvent(
			updated({ id: "item_0", type: "agent_message", text: "Olá mun" }),
			ctx,
		);
		expect(upd).toEqual([
			{ type: "text-delta", messageId: "t1:item_0", delta: "á mun" },
		]);
		const done = mapCodexEvent(
			completed({ id: "item_0", type: "agent_message", text: "Olá mundo" }),
			ctx,
		);
		expect(done).toEqual([
			{ type: "text-delta", messageId: "t1:item_0", delta: "do" },
			{ type: "text-end", messageId: "t1:item_0" },
		]);
	});

	it("reasoning vira reasoning-* com duração e bloco thinking", () => {
		const ctx = ctxAt(1000);
		mapCodexEvent(started({ id: "r", type: "reasoning", text: "" }), ctx);
		clock.t = 3500;
		const events = mapCodexEvent(
			completed({ id: "r", type: "reasoning", text: "pensando" }),
			ctx,
		);
		expect(events).toEqual([
			{ type: "reasoning-delta", messageId: "t1:r", delta: "pensando" },
			{ type: "reasoning-end", messageId: "t1:r", durationMs: 2500 },
		]);
		expect(ctx.blocks).toEqual([
			{ type: "thinking", thinking: "pensando", durationMs: 2500 },
		]);
	});

	it("fecha streams abertos quando o turno termina sem item.completed", () => {
		const ctx = ctxAt();
		mapCodexEvent(
			started({ id: "item_0", type: "agent_message", text: "parcial" }),
			ctx,
		);
		const events = endTurnEvents(ctx, "cancelled");
		expect(types(events)).toEqual([
			"text-end",
			"finish",
			"session-state-change",
		]);
		expect(events[1]).toMatchObject({ reason: "cancelled" });
	});
});

describe("mapCodexEvent: ferramentas", () => {
	it("command_execution bem-sucedido vira tool-call + tool-result", () => {
		const ctx = ctxAt(0);
		const start = mapCodexEvent(
			started({
				id: "item_1",
				type: "command_execution",
				command: "ls",
				aggregated_output: "",
				status: "in_progress",
			}),
			ctx,
		);
		expect(start).toEqual([
			{
				type: "tool-call",
				toolCallId: "t1:item_1",
				toolName: CODEX_TOOL_NAMES.command,
				args: { command: "ls" },
				parentToolCallId: null,
			},
		]);
		clock.t = 2000;
		const done = mapCodexEvent(
			completed({
				id: "item_1",
				type: "command_execution",
				command: "ls",
				aggregated_output: "a.txt\n",
				exit_code: 0,
				status: "completed",
			}),
			ctx,
		);
		expect(done).toEqual([
			{ type: "tool-result", toolCallId: "t1:item_1", result: "a.txt\n" },
		]);
		expect(ctx.blocks).toEqual([
			{
				type: "tool_use",
				id: "t1:item_1",
				name: "Shell",
				input: { command: "ls" },
				status: "done",
				elapsedSeconds: 2,
			},
			{
				type: "tool_result",
				toolUseId: "t1:item_1",
				content: "a.txt\n",
				isError: false,
			},
		]);
	});

	it("command_execution atualizado emite tool-progress", () => {
		const ctx = ctxAt(0);
		const item: ThreadItem = {
			id: "item_1",
			type: "command_execution",
			command: "sleep 5",
			aggregated_output: "",
			status: "in_progress",
		};
		mapCodexEvent(started(item), ctx);
		clock.t = 3000;
		expect(mapCodexEvent(updated(item), ctx)).toEqual([
			{ type: "tool-progress", toolCallId: "t1:item_1", elapsedSeconds: 3 },
		]);
	});

	it("command_execution com exit code diferente de zero vira tool-error", () => {
		const ctx = ctxAt();
		const events = mapCodexEvent(
			completed({
				id: "item_2",
				type: "command_execution",
				command: "false",
				aggregated_output: "",
				exit_code: 1,
				status: "failed",
			}),
			ctx,
		);
		expect(types(events)).toEqual(["tool-call", "tool-error"]);
		expect(events[1]).toEqual({
			type: "tool-error",
			toolCallId: "t1:item_2",
			error: { message: "Comando terminou com código 1" },
		});
		expect(ctx.blocks[0]).toMatchObject({ status: "error" });
		expect(ctx.blocks[1]).toMatchObject({ isError: true });
	});

	it("file_change resume os arquivos alterados", () => {
		const ctx = ctxAt();
		const events = mapCodexEvent(
			completed({
				id: "item_3",
				type: "file_change",
				changes: [
					{ path: "src/a.ts", kind: "update" },
					{ path: "src/b.ts", kind: "add" },
				],
				status: "completed",
			}),
			ctx,
		);
		expect(events[0]).toMatchObject({
			type: "tool-call",
			toolName: CODEX_TOOL_NAMES.fileChange,
		});
		expect(events[1]).toEqual({
			type: "tool-result",
			toolCallId: "t1:item_3",
			result: "alterado src/a.ts\nadicionado src/b.ts",
		});
	});

	it("mcp_tool_call usa o nome mcp__servidor__ferramenta e extrai texto", () => {
		const ctx = ctxAt();
		const events = mapCodexEvent(
			completed({
				id: "item_4",
				type: "mcp_tool_call",
				server: "github",
				tool: "search",
				arguments: { q: "ptolemy" },
				result: {
					content: [{ type: "text", text: "3 resultados" }],
					structured_content: null,
				},
				status: "completed",
			}),
			ctx,
		);
		expect(events[0]).toMatchObject({
			toolName: "mcp__github__search",
			args: { q: "ptolemy" },
		});
		expect(events[1]).toEqual({
			type: "tool-result",
			toolCallId: "t1:item_4",
			result: "3 resultados",
		});
	});

	it("mcp_tool_call com erro vira tool-error", () => {
		const events = mapCodexEvent(
			completed({
				id: "item_5",
				type: "mcp_tool_call",
				server: "s",
				tool: "t",
				arguments: {},
				error: { message: "timeout" },
				status: "failed",
			}),
			ctxAt(),
		);
		expect(events[1]).toEqual({
			type: "tool-error",
			toolCallId: "t1:item_5",
			error: { message: "timeout" },
		});
	});

	it("todo_list reemite os argumentos a cada atualização", () => {
		const ctx = ctxAt();
		const first = mapCodexEvent(
			started({
				id: "item_6",
				type: "todo_list",
				items: [{ text: "ler", completed: false }],
			}),
			ctx,
		);
		const second = mapCodexEvent(
			updated({
				id: "item_6",
				type: "todo_list",
				items: [{ text: "ler", completed: true }],
			}),
			ctx,
		);
		expect(first[0]).toMatchObject({
			type: "tool-call",
			toolName: "TodoWrite",
			args: { todos: [{ content: "ler", status: "pending" }] },
		});
		expect(second[0]).toMatchObject({
			type: "tool-call",
			args: { todos: [{ content: "ler", status: "completed" }] },
		});
	});

	it("item de erro não fatal é emitido uma única vez", () => {
		const ctx = ctxAt();
		const item: ThreadItem = { id: "e", type: "error", message: "aviso" };
		expect(mapCodexEvent(started(item), ctx)).toEqual([
			{ type: "error", error: { message: "aviso", recoverable: true } },
		]);
		expect(mapCodexEvent(completed(item), ctx)).toEqual([]);
	});

	it("ids de turnos diferentes não colidem", () => {
		const a = createCodexMapperContext("s", "turnA");
		const b = createCodexMapperContext("s", "turnB");
		const item: ThreadItem = {
			id: "item_0",
			type: "web_search",
			query: "x",
		};
		const ea = mapCodexEvent(started(item), a);
		const eb = mapCodexEvent(started(item), b);
		expect(ea[0]).toMatchObject({ toolCallId: "turnA:item_0" });
		expect(eb[0]).toMatchObject({ toolCallId: "turnB:item_0" });
	});
});
