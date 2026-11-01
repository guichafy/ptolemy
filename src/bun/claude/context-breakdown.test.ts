import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { mapClaudeContextUsage } from "./context-breakdown";

const fixture = {
	categories: [
		{ name: "System prompt", tokens: 3100, color: "x" },
		{ name: "System tools", tokens: 14200, color: "x" },
		{ name: "MCP tools", tokens: 9800, color: "x", isDeferred: true },
		{ name: "Messages", tokens: 52000, color: "x" },
		{ name: "Free space", tokens: 120000, color: "x" },
		{ name: "Autocompact buffer", tokens: 33000, color: "x" },
	],
	totalTokens: 69300,
	maxTokens: 200000,
	rawMaxTokens: 200000,
	percentage: 34.65,
	gridRows: [],
	model: "claude-opus-4-5-20251101",
	memoryFiles: [{ path: "/p/CLAUDE.md", type: "Project", tokens: 900 }],
	mcpTools: [
		{ name: "search", serverName: "github", tokens: 600, isLoaded: true },
		{ name: "unused", serverName: "github", tokens: 400, isLoaded: false },
	],
	agents: [],
	autoCompactThreshold: 167000,
	isAutoCompactEnabled: true,
	messageBreakdown: {
		toolCallTokens: 2000,
		toolResultTokens: 30000,
		attachmentTokens: 0,
		assistantMessageTokens: 15000,
		userMessageTokens: 5000,
		redirectedContextTokens: 0,
		unattributedTokens: 0,
		toolCallsByType: [{ name: "Read", callTokens: 500, resultTokens: 25000 }],
		attachmentsByType: [],
	},
	apiUsage: null,
} as unknown as SDKControlGetContextUsageResponse;

describe("mapClaudeContextUsage", () => {
	it("translates categories and drops free space and the buffer", () => {
		const b = mapClaudeContextUsage(fixture);
		expect(b.categories).toEqual([
			{ name: "Prompt do sistema", tokens: 3100 },
			{ name: "Ferramentas do sistema", tokens: 14200 },
			{ name: "Ferramentas MCP", tokens: 9800, isDeferred: true },
			{ name: "Mensagens", tokens: 52000 },
		]);
		expect(b).toMatchObject({
			source: "claude",
			usedTokens: 69300,
			maxTokens: 200000,
			autoCompactThreshold: 167000,
		});
	});

	it("lists the biggest items per section", () => {
		const b = mapClaudeContextUsage(fixture);
		const titles = b.sections.map((s) => s.title);
		expect(titles).toContain("Mensagens por tipo");
		const tools = b.sections.find(
			(s) => s.title === "Ferramentas usadas na conversa",
		);
		expect(tools?.items[0]).toMatchObject({ name: "Read", tokens: 25500 });
		const mcp = b.sections.find((s) => s.title === "Ferramentas MCP");
		expect(mcp?.items).toEqual([
			{ name: "search", tokens: 600, hint: "github" },
		]);
	});
});
