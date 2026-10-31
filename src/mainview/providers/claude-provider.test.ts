import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claudeListSessions = vi.fn();
const claudeOpenChat = vi.fn();
const claudeCreateSession = vi.fn();

vi.mock("./rpc", () => ({
	rpc: {
		request: { claudeListSessions, claudeOpenChat, claudeCreateSession },
	},
}));
vi.mock("../settings/claude-section", () => ({ ClaudeSection: () => null }));

const { claudeProvider, sessionToResult } = await import("./claude-provider");

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "s1",
		sdkSessionId: "sdk-1",
		title: "Conversa teste",
		projectId: "conversa-teste-abc123",
		projectPath: "/tmp/ptolemy/projects/conversa-teste-abc123",
		model: "claude-sonnet-4-6",
		authMode: "anthropic" as const,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		messageCount: 1,
		lastMessage: "ping",
		...overrides,
	};
}

describe("claudeProvider", () => {
	beforeEach(() => {
		claudeListSessions.mockReset();
		claudeOpenChat.mockReset();
		claudeCreateSession.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("identifies itself as 'claude'", () => {
		expect(claudeProvider.id).toBe("claude");
		expect(claudeProvider.configComponent).toBeDefined();
	});

	it("lists recent sessions when query is empty", async () => {
		claudeListSessions.mockResolvedValue([
			makeSession({ id: "s1", title: "Primeira" }),
			makeSession({ id: "s2", title: "Segunda" }),
		]);

		const results = await claudeProvider.search("");
		expect(results).toHaveLength(2);
		expect(results[0].title).toBe("Primeira");
		expect(results[1].id).toBe("s2");
	});

	it("returns empty list when RPC fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		claudeListSessions.mockRejectedValue(new Error("RPC down"));
		const results = await claudeProvider.search("");
		expect(results).toEqual([]);
	});

	it("session onSelect opens the chat with the session id", () => {
		const result = sessionToResult(makeSession({ id: "abc" }));
		result.onSelect();
		expect(claudeOpenChat).toHaveBeenCalledWith({ sessionId: "abc" });
	});

	it("non-empty query returns a single 'new session' entry", async () => {
		const results = await claudeProvider.search("explain X");
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe("claude-new");
		expect(results[0].title).toBe("explain X");
		expect(results[0].subtitle).toBe("Iniciar nova sessão");
	});

	it("new session onSelect calls claudeCreateSession with the prompt", async () => {
		claudeCreateSession.mockResolvedValue({ sessionId: "new-1" });
		const [result] = await claudeProvider.search("start");
		await result.onSelect();
		expect(claudeCreateSession).toHaveBeenCalledWith({ prompt: "start" });
	});

	it("swallows createSession failures (logs them)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		claudeCreateSession.mockRejectedValue(new Error("network"));

		const [result] = await claudeProvider.search("broken");
		await expect(result.onSelect()).resolves.toBeUndefined();
	});

	it("returns empty when signal aborts while listSessions is in-flight", async () => {
		let resolveList: (v: ReturnType<typeof makeSession>[]) => void = () => {};
		claudeListSessions.mockReturnValue(
			new Promise((resolve) => {
				resolveList = resolve;
			}),
		);
		const controller = new AbortController();

		const pending = claudeProvider.search("", controller.signal);
		// Caller aborts while the RPC is still waiting on the network.
		controller.abort();
		resolveList([makeSession()]);

		expect(await pending).toEqual([]);
	});
});
