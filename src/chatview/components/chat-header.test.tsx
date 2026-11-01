import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ChatHeader } from "./chat-header";

vi.mock("../rpc", () => ({
	rpc: {
		request: {
			claudeSetSessionModel: vi.fn().mockResolvedValue({ ok: true }),
		},
	},
}));

const MODELS = [
	{ value: "claude-sonnet-4-6", displayName: "Sonnet 4.6", description: "" },
	{ value: "claude-opus-4-6", displayName: "Opus 4.6", description: "" },
];

describe("<ChatHeader>", () => {
	test("disables the picker while streaming", () => {
		render(
			<ChatHeader
				sessionId="abc"
				sessionState="streaming"
				sessionModel="claude-sonnet-4-6"
				models={MODELS}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /selecionar modelo/i }),
		).toBeDisabled();
	});

	test("enables the picker when idle and dispatches RPC on change", async () => {
		const { rpc } = await import("../rpc");
		render(
			<ChatHeader
				sessionId="abc"
				sessionState="idle"
				sessionModel="claude-sonnet-4-6"
				models={MODELS}
			/>,
		);
		const trigger = screen.getByRole("button", { name: /selecionar modelo/i });
		expect(trigger).not.toBeDisabled();
		fireEvent.click(trigger);
		const opus = await screen.findByText("Opus 4.6");
		fireEvent.click(opus);
		expect(rpc.request.claudeSetSessionModel).toHaveBeenCalledWith({
			sessionId: "abc",
			model: "claude-opus-4-6",
		});
	});

	test("disables when there is no sessionId", () => {
		render(
			<ChatHeader
				sessionId={null}
				sessionState="idle"
				sessionModel="claude-sonnet-4-6"
				models={MODELS}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /selecionar modelo/i }),
		).toBeDisabled();
	});

	test("shows the agent name in the title", () => {
		const { rerender } = render(
			<ChatHeader
				sessionId="abc"
				sessionState="idle"
				sessionModel="claude-sonnet-4-6"
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
				models={[
					{ value: "default", displayName: "Padrão do Codex", description: "" },
				]}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Codex" })).toBeTruthy();
	});
});
