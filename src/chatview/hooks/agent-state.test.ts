import { describe, expect, it } from "vitest";
import type { StoredMessage } from "@/chatview/rpc";
import type { AgentEvent } from "@/shared/agent-protocol";
import {
	type AgentMessage,
	type AgentState,
	type AgentToolPart,
	appendUserMessage,
	computeTurnStatus,
	hasPendingTurn,
	hydrateMessages,
	initialAgentState,
	markTurnStart,
	reconcileMessages,
	reduceAgentState,
	resolvePermission,
	storedToAgentMessage,
} from "./agent-state";

function reduce(events: AgentEvent[], start = initialAgentState()): AgentState {
	return events.reduce(reduceAgentState, start);
}

function toolPart(state: AgentState, toolCallId: string): AgentToolPart {
	const part = state.currentMessage?.parts.find(
		(p): p is AgentToolPart => p.kind === "tool" && p.toolCallId === toolCallId,
	);
	if (!part) throw new Error(`tool part ${toolCallId} not found`);
	return part;
}

describe("reduceAgentState", () => {
	describe("session lifecycle", () => {
		it("session-start resets state and marks session running", () => {
			const dirty: AgentState = {
				...initialAgentState(),
				messages: [{ id: "m", role: "user", parts: [], createdAt: 0 }],
				lastError: { message: "boom", recoverable: false },
			};
			const next = reduceAgentState(dirty, {
				type: "session-start",
				sessionId: "s1",
			});
			expect(next.sessionId).toBe("s1");
			expect(next.sessionState).toBe("running");
			expect(next.messages).toEqual([]);
			expect(next.lastError).toBeNull();
		});

		it("session-state-change updates sessionState verbatim", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "session-state-change",
					sessionId: "s1",
					state: "requires_action",
				},
			]);
			expect(state.sessionState).toBe("requires_action");
		});

		it("session-end clears currentMessage and sets sessionState", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "text-start", messageId: "m1", parentToolCallId: null },
				{
					type: "session-end",
					sessionId: "s1",
					reason: "cancelled",
				},
			]);
			expect(state.sessionState).toBe("idle");
			expect(state.currentMessage).toBeNull();
		});

		it("session-end with reason=error sets sessionState=error", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "session-end", sessionId: "s1", reason: "error" },
			]);
			expect(state.sessionState).toBe("error");
		});
	});

	describe("text streaming", () => {
		it("accumulates deltas into a single streaming text part", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "text-start", messageId: "m1", parentToolCallId: null },
				{ type: "text-delta", messageId: "m1", delta: "Hello" },
				{ type: "text-delta", messageId: "m1", delta: " world" },
			]);
			expect(state.currentMessage?.parts).toEqual([
				{
					kind: "text",
					messageId: "m1",
					text: "Hello world",
					streaming: true,
					parentToolCallId: null,
				},
			]);
		});

		it("text-end flips streaming=false on the matching part", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "text-start", messageId: "m1", parentToolCallId: null },
				{ type: "text-delta", messageId: "m1", delta: "hi" },
				{ type: "text-end", messageId: "m1" },
			]);
			const part = state.currentMessage?.parts[0];
			expect(part).toMatchObject({
				kind: "text",
				streaming: false,
				text: "hi",
			});
		});

		it("ignores deltas targeting an unknown messageId", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "text-start", messageId: "m1", parentToolCallId: null },
				{ type: "text-delta", messageId: "wrong", delta: "noise" },
			]);
			const part = state.currentMessage?.parts[0];
			expect(part).toMatchObject({ text: "" });
		});
	});

	describe("reasoning", () => {
		it("stores durationMs on reasoning-end", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "reasoning-start", messageId: "m1", parentToolCallId: null },
				{ type: "reasoning-delta", messageId: "m1", delta: "thinking..." },
				{ type: "reasoning-end", messageId: "m1", durationMs: 1500 },
			]);
			expect(state.currentMessage?.parts[0]).toMatchObject({
				kind: "reasoning",
				text: "thinking...",
				streaming: false,
				durationMs: 1500,
			});
		});
	});

	describe("tool lifecycle", () => {
		it("tool-input-start creates a running tool part; deltas accumulate argsStreaming", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-input-start",
					toolCallId: "t1",
					toolName: "Bash",
					parentToolCallId: null,
				},
				{ type: "tool-input-delta", toolCallId: "t1", argsDelta: '{"cmd"' },
				{
					type: "tool-input-delta",
					toolCallId: "t1",
					argsDelta: ':"ls"}',
				},
			]);
			const tool = toolPart(state, "t1");
			expect(tool).toMatchObject({
				status: "running",
				argsStreaming: '{"cmd":"ls"}',
				args: undefined,
			});
		});

		it("tool-call fills in parsed args without losing prior status", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-input-start",
					toolCallId: "t1",
					toolName: "Bash",
					parentToolCallId: null,
				},
				{
					type: "tool-call",
					toolCallId: "t1",
					toolName: "Bash",
					args: { cmd: "ls" },
					parentToolCallId: null,
				},
			]);
			expect(toolPart(state, "t1").args).toEqual({ cmd: "ls" });
		});

		it("tool-call creates the part when no tool-input-start was seen", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-call",
					toolCallId: "t9",
					toolName: "Read",
					args: { path: "/tmp/x" },
					parentToolCallId: null,
				},
			]);
			const tool = toolPart(state, "t9");
			expect(tool.status).toBe("running");
			expect(tool.args).toEqual({ path: "/tmp/x" });
		});

		it("tool-result transitions to completed and stores result", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-input-start",
					toolCallId: "t1",
					toolName: "Bash",
					parentToolCallId: null,
				},
				{ type: "tool-result", toolCallId: "t1", result: "output" },
			]);
			expect(toolPart(state, "t1")).toMatchObject({
				status: "completed",
				result: "output",
			});
		});

		it("tool-error transitions to error with error payload", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-input-start",
					toolCallId: "t1",
					toolName: "Bash",
					parentToolCallId: null,
				},
				{
					type: "tool-error",
					toolCallId: "t1",
					error: { message: "denied" },
				},
			]);
			expect(toolPart(state, "t1")).toMatchObject({
				status: "error",
				error: { message: "denied" },
			});
		});

		it("tool-progress updates elapsedSeconds in place", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-input-start",
					toolCallId: "t1",
					toolName: "Bash",
					parentToolCallId: null,
				},
				{ type: "tool-progress", toolCallId: "t1", elapsedSeconds: 2.5 },
			]);
			expect(toolPart(state, "t1").elapsedSeconds).toBe(2.5);
		});

		it("subagent tool-call carries parentToolCallId", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-call",
					toolCallId: "child",
					toolName: "Grep",
					args: {},
					parentToolCallId: "task_root",
				},
			]);
			expect(toolPart(state, "child").parentToolCallId).toBe("task_root");
		});
	});

	describe("HITL permissions", () => {
		it("tool-permission-request enqueues and flips sessionState=requires_action", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-permission-request",
					permissionId: "p1",
					toolCallId: "t1",
					toolName: "Bash",
					args: { cmd: "rm -rf" },
				},
			]);
			expect(state.sessionState).toBe("requires_action");
			expect(state.pendingPermissions).toHaveLength(1);
			expect(state.pendingPermissions[0]).toMatchObject({
				permissionId: "p1",
				toolName: "Bash",
			});
		});

		it("resolvePermission removes from queue and restores running state when empty", () => {
			const withRequest = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-permission-request",
					permissionId: "p1",
					toolCallId: "t1",
					toolName: "Bash",
					args: {},
				},
			]);
			const after = resolvePermission(withRequest, "p1");
			expect(after.pendingPermissions).toHaveLength(0);
			expect(after.sessionState).toBe("running");
		});

		it("resolvePermission is a no-op for unknown permissionId", () => {
			const withRequest = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "tool-permission-request",
					permissionId: "p1",
					toolCallId: "t1",
					toolName: "Bash",
					args: {},
				},
			]);
			expect(resolvePermission(withRequest, "nope")).toBe(withRequest);
		});
	});

	describe("tasks / subagents", () => {
		it("task-start registers a running task keyed by taskId", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "task-start",
					taskId: "task1",
					toolCallId: "t_task",
					description: "Audit",
					taskType: "general-purpose",
					parentToolCallId: "t_task",
				},
			]);
			expect(state.tasks.task1).toMatchObject({
				status: "running",
				description: "Audit",
			});
		});

		it("task-progress and task-update merge into existing task", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "task-start",
					taskId: "task1",
					description: "Audit",
					parentToolCallId: null,
				},
				{
					type: "task-progress",
					taskId: "task1",
					description: "Grepping",
					lastToolName: "Grep",
					usage: { totalTokens: 100, toolUses: 1, durationMs: 500 },
				},
				{
					type: "task-update",
					taskId: "task1",
					patch: { status: "running" },
				},
			]);
			expect(state.tasks.task1).toMatchObject({
				lastToolName: "Grep",
				usage: { totalTokens: 100, toolUses: 1, durationMs: 500 },
			});
		});

		it("task-end finalizes status and summary", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "task-start",
					taskId: "task1",
					description: "Audit",
					parentToolCallId: null,
				},
				{
					type: "task-end",
					taskId: "task1",
					status: "completed",
					summary: "done",
				},
			]);
			expect(state.tasks.task1).toMatchObject({
				status: "completed",
				summary: "done",
			});
		});

		it("task events for unknown taskId are ignored (update/end)", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "task-update",
					taskId: "ghost",
					patch: { status: "killed" },
				},
			]);
			expect(state.tasks).toEqual({});
		});
	});

	describe("suggestions + error + finish", () => {
		it("prompt-suggestions replaces suggestions list", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "prompt-suggestions", suggestions: ["try ls", "open README"] },
			]);
			expect(state.suggestions).toEqual(["try ls", "open README"]);
		});

		it("error event stores lastError and keeps running when recoverable", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "error",
					error: { message: "rate limited", recoverable: true },
				},
			]);
			expect(state.lastError).toMatchObject({ message: "rate limited" });
			expect(state.sessionState).toBe("running");
		});

		it("error event with recoverable=false flips sessionState=error", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "error",
					error: { message: "fatal", recoverable: false },
				},
			]);
			expect(state.sessionState).toBe("error");
		});

		it("finish moves currentMessage to messages and records usage/cost", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{ type: "text-start", messageId: "m1", parentToolCallId: null },
				{ type: "text-delta", messageId: "m1", delta: "done" },
				{ type: "text-end", messageId: "m1" },
				{
					type: "finish",
					reason: "success",
					usage: { inputTokens: 50, outputTokens: 20 },
					totalCostUsd: 0.001,
					durationMs: 500,
				},
			]);
			expect(state.currentMessage).toBeNull();
			expect(state.messages).toHaveLength(1);
			expect(state.messages[0].role).toBe("assistant");
			expect(state.usage).toEqual({ inputTokens: 50, outputTokens: 20 });
			expect(state.totalCostUsd).toBe(0.001);
			expect(state.durationMs).toBe(500);
			expect(state.sessionState).toBe("idle");
		});

		it("finish without any currentMessage still records usage and stays idle", () => {
			const state = reduce([
				{ type: "session-start", sessionId: "s1" },
				{
					type: "finish",
					reason: "success",
					usage: { inputTokens: 10, outputTokens: 5 },
				},
			]);
			expect(state.messages).toEqual([]);
			expect(state.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
		});
	});

	describe("optimistic user append", () => {
		it("appendUserMessage pushes a user-role message with a text part", () => {
			const state = appendUserMessage(initialAgentState(), "u1", "hello");
			expect(state.messages).toHaveLength(1);
			expect(state.messages[0]).toMatchObject({
				id: "u1",
				role: "user",
			});
			expect(state.messages[0].parts[0]).toMatchObject({
				kind: "text",
				text: "hello",
				streaming: false,
			});
		});
	});
});

describe("storedToAgentMessage", () => {
	it("converts a user text message into an AgentMessage with a text part", () => {
		const stored: StoredMessage = {
			version: 2,
			role: "user",
			blocks: [{ type: "text", text: "oi" }],
			timestamp: "2026-04-23T21:21:00.000Z",
		};
		const msg = storedToAgentMessage(stored, 0);
		expect(msg.role).toBe("user");
		expect(msg.parts).toHaveLength(1);
		expect(msg.parts[0]).toMatchObject({
			kind: "text",
			text: "oi",
			streaming: false,
		});
	});

	it("converts an assistant thinking+text message preserving block order", () => {
		const stored: StoredMessage = {
			version: 2,
			role: "assistant",
			blocks: [
				{ type: "thinking", thinking: "Let me think", durationMs: 1200 },
				{ type: "text", text: "Here is the answer" },
			],
			timestamp: "2026-04-23T21:22:00.000Z",
		};
		const msg = storedToAgentMessage(stored, 1);
		expect(msg.role).toBe("assistant");
		expect(msg.parts.map((p) => p.kind)).toEqual(["reasoning", "text"]);
		expect(msg.parts[0]).toMatchObject({
			kind: "reasoning",
			text: "Let me think",
			streaming: false,
			durationMs: 1200,
		});
		expect(msg.parts[1]).toMatchObject({
			kind: "text",
			text: "Here is the answer",
		});
	});

	it("merges tool_result into the matching tool_use part as completed", () => {
		const stored: StoredMessage = {
			version: 2,
			role: "assistant",
			blocks: [
				{
					type: "tool_use",
					id: "tu_1",
					name: "Read",
					input: { path: "/a" },
					status: "done",
					elapsedSeconds: 0.4,
				},
				{
					type: "tool_result",
					toolUseId: "tu_1",
					content: "file contents",
					isError: false,
				},
			],
			timestamp: "t",
		};
		const msg = storedToAgentMessage(stored, 2);
		expect(msg.parts).toHaveLength(1);
		const tool = msg.parts[0] as AgentToolPart;
		expect(tool.kind).toBe("tool");
		expect(tool.toolCallId).toBe("tu_1");
		expect(tool.toolName).toBe("Read");
		expect(tool.args).toEqual({ path: "/a" });
		expect(tool.status).toBe("completed");
		expect(tool.result).toBe("file contents");
		expect(tool.elapsedSeconds).toBe(0.4);
	});

	it("marks a tool as error when the tool_result is an error", () => {
		const stored: StoredMessage = {
			version: 2,
			role: "assistant",
			blocks: [
				{
					type: "tool_use",
					id: "tu_2",
					name: "Bash",
					input: { cmd: "ls" },
					status: "error",
				},
				{
					type: "tool_result",
					toolUseId: "tu_2",
					content: "ENOENT: no such file",
					isError: true,
				},
			],
			timestamp: "t",
		};
		const msg = storedToAgentMessage(stored, 3);
		const tool = msg.parts[0] as AgentToolPart;
		expect(tool.status).toBe("error");
		expect(tool.error).toEqual({ message: "ENOENT: no such file" });
	});

	it("maps stored tool_use status 'running' to running when no tool_result yet", () => {
		const stored: StoredMessage = {
			version: 2,
			role: "assistant",
			blocks: [
				{
					type: "tool_use",
					id: "tu_3",
					name: "Bash",
					input: {},
					status: "running",
				},
			],
			timestamp: "t",
		};
		const tool = storedToAgentMessage(stored, 4).parts[0] as AgentToolPart;
		expect(tool.status).toBe("running");
	});

	it("assigns a stable id derived from the message index", () => {
		const stored: StoredMessage = {
			version: 2,
			role: "user",
			blocks: [{ type: "text", text: "hi" }],
			timestamp: "2026-04-23T21:30:00.000Z",
		};
		const a = storedToAgentMessage(stored, 0);
		const b = storedToAgentMessage(stored, 0);
		expect(a.id).toBe(b.id);
		const c = storedToAgentMessage(stored, 1);
		expect(c.id).not.toBe(a.id);
	});
});

describe("computeTurnStatus", () => {
	it("returns idle for an untouched initial state", () => {
		expect(computeTurnStatus(initialAgentState()).status).toBe("idle");
	});

	it("returns idle when the session is in error", () => {
		const state: AgentState = {
			...initialAgentState(),
			sessionState: "error",
		};
		expect(computeTurnStatus(state).status).toBe("idle");
	});

	it("returns idle when waiting for a HITL permission decision", () => {
		const state: AgentState = {
			...initialAgentState(),
			sessionState: "requires_action",
		};
		expect(computeTurnStatus(state).status).toBe("idle");
	});

	it("returns waiting when running but no currentMessage yet", () => {
		const state: AgentState = {
			...initialAgentState(),
			sessionState: "running",
		};
		expect(computeTurnStatus(state).status).toBe("waiting");
	});

	it("returns waiting when running with an empty currentMessage", () => {
		const state: AgentState = {
			...initialAgentState(),
			sessionState: "running",
			currentMessage: {
				id: "m1",
				role: "assistant",
				parts: [],
				createdAt: 0,
			},
		};
		expect(computeTurnStatus(state).status).toBe("waiting");
	});

	it("returns receiving while a text part is streaming", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{ type: "text-start", messageId: "m1", parentToolCallId: null },
			{ type: "text-delta", messageId: "m1", delta: "hi" },
		]);
		expect(computeTurnStatus(state).status).toBe("receiving");
	});

	it("returns receiving while reasoning is streaming", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{ type: "reasoning-start", messageId: "m1", parentToolCallId: null },
			{ type: "reasoning-delta", messageId: "m1", delta: "thinking" },
		]);
		expect(computeTurnStatus(state).status).toBe("receiving");
	});

	it("returns tool_running when a tool is running and no text is streaming", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{
				type: "tool-input-start",
				toolCallId: "t1",
				toolName: "Bash",
				parentToolCallId: null,
			},
		]);
		expect(computeTurnStatus(state).status).toBe("tool_running");
	});

	it("prefers receiving over tool_running when text is streaming alongside a running tool", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{
				type: "tool-input-start",
				toolCallId: "t1",
				toolName: "Bash",
				parentToolCallId: null,
			},
			{ type: "text-start", messageId: "m1", parentToolCallId: null },
			{ type: "text-delta", messageId: "m1", delta: "partial answer" },
		]);
		expect(computeTurnStatus(state).status).toBe("receiving");
	});

	it("returns waiting when a tool has completed and no text has started yet", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{
				type: "tool-input-start",
				toolCallId: "t1",
				toolName: "Bash",
				parentToolCallId: null,
			},
			{ type: "tool-result", toolCallId: "t1", result: "done" },
		]);
		expect(computeTurnStatus(state).status).toBe("waiting");
	});

	it("returns idle after finish flushes currentMessage", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{ type: "text-start", messageId: "m1", parentToolCallId: null },
			{ type: "text-delta", messageId: "m1", delta: "done" },
			{ type: "text-end", messageId: "m1" },
			{
				type: "finish",
				reason: "success",
				usage: { inputTokens: 1, outputTokens: 1 },
			},
		]);
		expect(computeTurnStatus(state).status).toBe("idle");
	});

	it("exposes the running tool's name so the UI can label the indicator", () => {
		const state = reduce([
			{ type: "session-start", sessionId: "s1" },
			{
				type: "tool-input-start",
				toolCallId: "t1",
				toolName: "Bash",
				parentToolCallId: null,
			},
		]);
		const result = computeTurnStatus(state);
		expect(result).toEqual({ status: "tool_running", toolName: "Bash" });
	});
});

describe("markTurnStart", () => {
	it("flips sessionState to running from idle", () => {
		const state = markTurnStart(initialAgentState());
		expect(state.sessionState).toBe("running");
	});

	it("keeps sessionState unchanged when a HITL permission is pending", () => {
		const awaiting: AgentState = {
			...initialAgentState(),
			sessionState: "requires_action",
		};
		expect(markTurnStart(awaiting).sessionState).toBe("requires_action");
	});

	it("does not touch messages or currentMessage", () => {
		const base: AgentState = {
			...initialAgentState(),
			messages: [
				{
					id: "u1",
					role: "user",
					parts: [
						{
							kind: "text",
							messageId: "u1",
							text: "hi",
							streaming: false,
							parentToolCallId: null,
						},
					],
					createdAt: 0,
				},
			],
		};
		const next = markTurnStart(base);
		expect(next.messages).toBe(base.messages);
		expect(next.currentMessage).toBeNull();
	});

	it("resets lastError so the indicator isn't suppressed by a stale error", () => {
		const errored: AgentState = {
			...initialAgentState(),
			lastError: { message: "prev failure", recoverable: false },
			sessionState: "error",
		};
		const next = markTurnStart(errored);
		expect(next.sessionState).toBe("running");
		expect(next.lastError).toBeNull();
	});
});

describe("hasPendingTurn", () => {
	const userMsg = (id: string): AgentMessage => ({
		id,
		role: "user",
		parts: [],
		createdAt: 0,
	});
	const assistantMsg = (id: string): AgentMessage => ({
		id,
		role: "assistant",
		parts: [],
		createdAt: 0,
	});

	it("returns false for an empty history (nothing was sent yet)", () => {
		expect(hasPendingTurn([])).toBe(false);
	});

	it("returns true when the last message is from the user (backend owes a response)", () => {
		expect(hasPendingTurn([userMsg("u1")])).toBe(true);
	});

	it("returns false when the last message is from the assistant (turn settled)", () => {
		expect(hasPendingTurn([userMsg("u1"), assistantMsg("a1")])).toBe(false);
	});

	it("returns true across multiple turns when the tail is a new user message", () => {
		expect(
			hasPendingTurn([userMsg("u1"), assistantMsg("a1"), userMsg("u2")]),
		).toBe(true);
	});
});

describe("optimistic send + computeTurnStatus integration", () => {
	it("after appending an optimistic user message and marking the turn, the UI sees 'waiting'", () => {
		const state = markTurnStart(
			appendUserMessage(initialAgentState(), "u1", "oi"),
		);
		expect(state.messages).toHaveLength(1);
		expect(computeTurnStatus(state).status).toBe("waiting");
	});
});

describe("hydrate + pending-turn detection integration", () => {
	// Mirrors the composition in use-agent-chat.ts:
	//   case "hydrate": return hasPendingTurn(messages) ? markTurnStart(h) : h;
	// Locks in the palette-open flow: if the disk shows the user prompt
	// without a reply, the indicator must flip to "waiting" on hydrate.
	function reduceHydrate(
		state: AgentState,
		messages: AgentMessage[],
	): AgentState {
		const hydrated = hydrateMessages(state, messages);
		return hasPendingTurn(messages) ? markTurnStart(hydrated) : hydrated;
	}

	it("marks turn running when the hydrated transcript ends with a user message", () => {
		const userStored = storedToAgentMessage(
			{
				version: 2,
				role: "user",
				blocks: [{ type: "text", text: "q" }],
				timestamp: "2026-04-23T21:00:00.000Z",
			},
			0,
		);
		const next = reduceHydrate(initialAgentState(), [userStored]);
		expect(next.sessionState).toBe("running");
		expect(computeTurnStatus(next).status).toBe("waiting");
	});

	it("stays idle when the hydrated transcript ends with an assistant message", () => {
		const userStored = storedToAgentMessage(
			{
				version: 2,
				role: "user",
				blocks: [{ type: "text", text: "q" }],
				timestamp: "t",
			},
			0,
		);
		const assistantStored = storedToAgentMessage(
			{
				version: 2,
				role: "assistant",
				blocks: [{ type: "text", text: "a" }],
				timestamp: "t",
			},
			1,
		);
		const next = reduceHydrate(initialAgentState(), [
			userStored,
			assistantStored,
		]);
		expect(next.sessionState).toBe("idle");
		expect(computeTurnStatus(next).status).toBe("idle");
	});

	it("does not re-arm running after a finish cleared the currentMessage", () => {
		const settled: AgentState = {
			...initialAgentState(),
			sessionState: "idle",
			messages: [],
			currentMessage: null,
		};
		const assistantStored = storedToAgentMessage(
			{
				version: 2,
				role: "assistant",
				blocks: [{ type: "text", text: "done" }],
				timestamp: "t",
			},
			0,
		);
		const next = reduceHydrate(settled, [assistantStored]);
		expect(next.sessionState).toBe("idle");
	});
});

describe("hydrateMessages", () => {
	it("replaces state.messages with the provided list", () => {
		const state = appendUserMessage(initialAgentState(), "u1", "hello");
		const hydrated = hydrateMessages(state, [
			{
				id: "m0",
				role: "user",
				parts: [
					{
						kind: "text",
						messageId: "m0",
						text: "persisted",
						streaming: false,
						parentToolCallId: null,
					},
				],
				createdAt: 0,
			},
		]);
		expect(hydrated.messages).toHaveLength(1);
		expect(hydrated.messages[0].id).toBe("m0");
	});

	it("clears currentMessage (the persisted turn already subsumes it)", () => {
		const dirty: AgentState = {
			...initialAgentState(),
			currentMessage: {
				id: "inflight",
				role: "assistant",
				parts: [],
				createdAt: 0,
			},
		};
		const hydrated = hydrateMessages(dirty, []);
		expect(hydrated.currentMessage).toBeNull();
	});

	it("preserves sessionId, sessionState, and pendingPermissions", () => {
		const base: AgentState = {
			...initialAgentState(),
			sessionId: "s1",
			sessionState: "requires_action",
			pendingPermissions: [
				{
					permissionId: "p1",
					toolCallId: "t1",
					toolName: "Bash",
					args: {},
					createdAt: 0,
				},
			],
		};
		const hydrated = hydrateMessages(base, []);
		expect(hydrated.sessionId).toBe("s1");
		expect(hydrated.sessionState).toBe("requires_action");
		expect(hydrated.pendingPermissions).toHaveLength(1);
	});
});

describe("session-info", () => {
	it("merges the resolved model and context usage", () => {
		const usage = {
			usedTokens: 1000,
			maxTokens: 200000,
			updatedAt: "2026-11-01T10:00:00.000Z",
		};
		const s1 = reduce([
			{ type: "session-info", info: { resolvedModel: "claude-opus-4-5" } },
			{ type: "session-info", info: { contextUsage: usage } },
		]);
		expect(s1.resolvedModel).toBe("claude-opus-4-5");
		expect(s1.contextUsage).toEqual(usage);
	});

	it("returns the same state object for a no-op patch", () => {
		const s = initialAgentState();
		expect(reduceAgentState(s, { type: "session-info", info: {} })).toBe(s);
	});

	it("survives session-start", () => {
		const s = reduce([
			{ type: "session-info", info: { resolvedModel: "gpt-6-astra" } },
			{ type: "session-start", sessionId: "s1" },
		]);
		expect(s.resolvedModel).toBe("gpt-6-astra");
	});

	it("finish stamps the turn's model, duration and per-turn cost", () => {
		const s = reduce([
			{ type: "text-start", messageId: "m1", parentToolCallId: null },
			{ type: "text-delta", messageId: "m1", delta: "oi" },
			{
				type: "session-info",
				info: {
					resolvedModel: "claude-opus-4-5",
					contextUsage: {
						usedTokens: 10,
						lastTurnCostUsd: 0.02,
						updatedAt: "x",
					},
				},
			},
			{
				type: "finish",
				reason: "success",
				usage: { inputTokens: 1, outputTokens: 1 },
				totalCostUsd: 9.99,
				durationMs: 4200,
			},
		]);
		expect(s.messages[0].meta).toEqual({
			model: "claude-opus-4-5",
			durationMs: 4200,
			costUsd: 0.02,
		});
	});
});

describe("reconcileMessages", () => {
	const text = (id: string, role: "user" | "assistant", t: string) =>
		({
			id,
			role,
			createdAt: 0,
			parts: [
				{
					kind: "text",
					messageId: id,
					text: t,
					streaming: false,
					parentToolCallId: null,
				},
			],
		}) as AgentMessage;

	it("keeps unchanged messages (and their ids) across a re-read", () => {
		const live = [
			text("user-1", "user", "oi"),
			text("msg_1", "assistant", "olá"),
		];
		const stored = [
			text("stored-0", "user", "oi"),
			{ ...text("stored-1", "assistant", "olá"), meta: { durationMs: 10 } },
		];
		const next = reconcileMessages(live, stored);
		expect(next[0]).toBe(live[0]);
		expect(next[1].id).toBe("msg_1");
		expect(next[1].meta).toEqual({ durationMs: 10 });
	});

	it("takes the stored message when the content differs", () => {
		const live = [text("msg_1", "assistant", "parcial")];
		const stored = [text("stored-0", "assistant", "parcial e completo")];
		expect(reconcileMessages(live, stored)[0]).toBe(stored[0]);
	});

	it("hydrateMessages uses reconciliation", () => {
		const live = text("user-1", "user", "oi");
		const state = { ...initialAgentState(), messages: [live] };
		const next = hydrateMessages(state, [text("stored-0", "user", "oi")]);
		expect(next.messages[0]).toBe(live);
	});
});
