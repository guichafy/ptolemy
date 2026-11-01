import { beforeEach, describe, expect, it, vi } from "vitest";

const claudeListSessions = vi.fn();
const claudeOpenChat = vi.fn();
const claudeCreateSession = vi.fn();

vi.mock("./rpc", () => ({
	rpc: {
		request: { claudeListSessions, claudeOpenChat, claudeCreateSession },
	},
}));
vi.mock("../settings/codex-section", () => ({ CodexSection: () => null }));
vi.mock("../settings/claude-section", () => ({ ClaudeSection: () => null }));

const { codexProvider } = await import("./codex-provider");
const { claudeProvider } = await import("./claude-provider");
const { agentForProviderId } = await import("./agent-sessions");

function session(id: string, agent?: "claude" | "codex") {
	return {
		id,
		sdkSessionId: "",
		...(agent && { agent }),
		title: `Sessão ${id}`,
		projectId: `p-${id}`,
		projectPath: `/tmp/${id}`,
		model: "default",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		messageCount: 1,
		lastMessage: "oi",
	};
}

describe("codexProvider", () => {
	beforeEach(() => {
		claudeListSessions.mockReset();
		claudeCreateSession.mockReset();
	});

	it("identifica-se como 'codex' e tem tela de configuração", () => {
		expect(codexProvider.id).toBe("codex");
		expect(codexProvider.configComponent).toBeDefined();
	});

	it("lista só as sessões do Codex; o Claude fica com as dele e as legadas", async () => {
		claudeListSessions.mockResolvedValue([
			session("legacy"),
			session("c1", "claude"),
			session("x1", "codex"),
		]);
		const codex = await codexProvider.search("");
		const claude = await claudeProvider.search("");
		expect(codex.map((r) => r.id)).toEqual(["x1"]);
		expect(claude.map((r) => r.id)).toEqual(["legacy", "c1"]);
	});

	it("cria a sessão nova com agent 'codex'", async () => {
		claudeCreateSession.mockResolvedValue({ sessionId: "new" });
		const [result] = await codexProvider.search("refatorar o parser");
		await result.onSelect();
		expect(claudeCreateSession).toHaveBeenCalledWith({
			prompt: "refatorar o parser",
			agent: "codex",
		});
	});

	it("mapeia ids de plugin para agentes", () => {
		expect(agentForProviderId("codex")).toBe("codex");
		expect(agentForProviderId("claude")).toBe("claude");
		expect(agentForProviderId("github")).toBeNull();
	});
});
