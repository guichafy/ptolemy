import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AgentComposer } from "./agent-composer";

const request = vi.hoisted(() => ({
	agentListSkills: vi.fn(),
	agentImportSkill: vi.fn(),
	agentSetDefaultSkills: vi.fn(),
	claudeCreateSession: vi.fn(),
}));
vi.mock("../providers/rpc", () => ({ rpc: { request } }));
vi.mock("../hooks/use-window-shown", () => ({ useWindowShown: vi.fn() }));
const skill = {
	id: "review",
	name: "review",
	description: "Revisar código",
	source: {
		kind: "github",
		url: "https://github.com/a/b",
		commit: "a".repeat(40),
	},
	defaultFor: ["codex"],
};

function Composer({ agent = "codex" }: { agent?: "codex" | "claude" }) {
	const [value, onChange] = useState("Revisar alteração");
	return (
		<AgentComposer
			agent={agent}
			value={value}
			onChange={onChange}
			onCreated={() => onChange("")}
		/>
	);
}
beforeEach(() => {
	vi.resetAllMocks();
	request.agentListSkills.mockResolvedValue([skill]);
	request.claudeCreateSession.mockResolvedValue({ sessionId: "new" });
	request.agentSetDefaultSkills.mockResolvedValue(true);
});

describe("Agent composer", () => {
	test("cannot start a conversation while a Skill import is pending", async () => {
		let finish!: (value: typeof skill) => void;
		request.agentImportSkill.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		render(<Composer />);
		await userEvent.click(
			screen.getByRole("button", { name: /Configurar Skills/ }),
		);
		await userEvent.type(
			screen.getByRole("textbox", { name: "URL da Skill no GitHub" }),
			"https://github.com/a/b",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Importar Skill" }),
		);
		await userEvent.keyboard("{Escape}");
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeDisabled();
		finish({ ...skill, id: "new-skill" });
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
	});
	test("creates a conversation with the agent's default Skills", async () => {
		render(<Composer />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		);
		expect(request.claudeCreateSession).toHaveBeenCalledWith({
			agent: "codex",
			prompt: "Revisar alteração",
			skillIds: ["review"],
		});
		await waitFor(() =>
			expect(
				screen.getByRole("textbox", { name: "Mensagem para Codex" }),
			).toHaveValue(""),
		);
	});
	test("preserves text and selection when session creation fails", async () => {
		request.claudeCreateSession.mockRejectedValue(
			new Error("CLI indisponível"),
		);
		render(<Composer />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Iniciar conversa" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"CLI indisponível",
		);
		expect(
			screen.getByRole("textbox", { name: "Mensagem para Codex" }),
		).toHaveValue("Revisar alteração");
	});
	test("imports a GitHub Skill, selects it, and saves defaults for this agent", async () => {
		request.agentImportSkill.mockResolvedValue({
			...skill,
			id: "debug",
			name: "debug",
			defaultFor: [],
		});
		render(<Composer agent="claude" />);
		await userEvent.click(
			screen.getByRole("button", { name: /Configurar Skills/ }),
		);
		await userEvent.type(
			screen.getByRole("textbox", { name: "URL da Skill no GitHub" }),
			"https://github.com/a/b/tree/main/debug",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Importar Skill" }),
		);
		expect(
			await screen.findByRole("checkbox", { name: /Usar debug/ }),
		).toBeChecked();
		await userEvent.click(
			screen.getByRole("button", { name: "Usar seleção como padrão" }),
		);
		expect(request.agentSetDefaultSkills).toHaveBeenCalledWith({
			agent: "claude",
			skillIds: ["debug"],
		});
	});
	test("keeps a validation error visible and never selects an invalid import", async () => {
		request.agentImportSkill.mockRejectedValue(new Error("SKILL.md inválido"));
		render(<Composer />);
		await userEvent.click(
			screen.getByRole("button", { name: /Configurar Skills/ }),
		);
		await userEvent.type(
			screen.getByRole("textbox", { name: "URL da Skill no GitHub" }),
			"https://github.com/a/b",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Importar Skill" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"SKILL.md inválido",
		);
		expect(
			screen.getByRole("textbox", { name: "URL da Skill no GitHub" }),
		).toHaveValue("https://github.com/a/b");
	});
	test("Shift+Enter and IME do not create a session; Enter creates only once", async () => {
		render(<Composer />);
		const input = screen.getByRole("textbox", { name: "Mensagem para Codex" });
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		expect(request.claudeCreateSession).not.toHaveBeenCalled();
		fireEvent.keyDown(input, { key: "Enter" });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() =>
			expect(request.claudeCreateSession).toHaveBeenCalledTimes(1),
		);
	});
});
