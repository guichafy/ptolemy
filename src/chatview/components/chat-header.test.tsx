import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ChatHeader } from "./chat-header";

vi.mock("../rpc", () => ({
	rpc: { request: { agentGetContextBreakdown: vi.fn() } },
}));

const MODELS = [
	{ value: "default", displayName: "Default (recommended)", description: "" },
	{ value: "claude-opus-4-6", displayName: "Opus 4.6", description: "" },
];

describe("<ChatHeader>", () => {
	test("shows the agent name in the title", () => {
		const { rerender } = render(
			<ChatHeader
				sessionId="abc"
				sessionState="idle"
				sessionModel="default"
				models={MODELS}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Claude Code" })).toBeTruthy();
		rerender(
			<ChatHeader
				agent="codex"
				sessionId="abc"
				sessionState="idle"
				sessionModel="default"
				models={MODELS}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Codex" })).toBeTruthy();
	});

	test("does not repeat the model selector (it lives in the composer)", () => {
		render(
			<ChatHeader
				sessionId="abc"
				sessionState="idle"
				sessionModel="default"
				resolvedModel="claude-opus-4-6"
				models={MODELS}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /selecionar modelo/i }),
		).toBeNull();
		expect(screen.queryByText("Opus 4.6")).toBeNull();
	});

	test("shows the context gauge once usage is known", () => {
		render(
			<ChatHeader
				sessionId="abc"
				sessionState="idle"
				sessionModel="default"
				contextUsage={{
					usedTokens: 50000,
					maxTokens: 200000,
					updatedAt: "x",
				}}
				models={MODELS}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /contexto usado: 25%/i }),
		).toBeTruthy();
	});
});
