import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AgentComposer } from "./agent-composer";

const settingsState = vi.hoisted(() => ({ isOpen: false }));
const request = vi.hoisted(() => ({
	agentListSkills: vi.fn(),
	agentExtensionInventory: vi.fn(),
	agentExtensionReview: vi.fn(),
	agentMcpList: vi.fn(),
	agentExtensionCapabilities: vi.fn(),
	agentExtensionCommands: vi.fn(),
	agentExtensionSetDefaults: vi.fn(),
	agentImportSkill: vi.fn(),
	agentSetDefaultSkills: vi.fn(),
	claudeCreateSession: vi.fn(),
	claudeListSupportedModels: vi.fn(),
	codexListModels: vi.fn(),
}));
vi.mock("../providers/rpc", () => ({ rpc: { request } }));
vi.mock("../settings/settings-context", () => ({
	useSettings: () => ({
		settings: { claude: { model: "sonnet" } },
		isOpen: settingsState.isOpen,
		codexSettings: { model: "default" },
	}),
}));
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
	settingsState.isOpen = false;
	request.agentListSkills.mockResolvedValue([skill]);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [],
		builtins: [],
		verifiedRuntime: "test",
	});
	request.agentMcpList.mockResolvedValue([]);
	request.agentExtensionReview.mockResolvedValue([]);
	request.agentExtensionCapabilities.mockResolvedValue([]);
	request.agentExtensionCommands.mockResolvedValue([]);
	request.claudeCreateSession.mockResolvedValue({ sessionId: "new" });
	request.agentSetDefaultSkills.mockResolvedValue(true);
	request.claudeListSupportedModels.mockResolvedValue({
		models: [
			{ value: "sonnet", displayName: "Sonnet", description: "Balanceado" },
			{ value: "opus", displayName: "Opus", description: "Mais capaz" },
		],
	});
	request.codexListModels.mockResolvedValue({
		models: [
			{
				value: "default",
				displayName: "Padrão do Codex",
				description: "CLI",
				resolvesTo: "GPT-6 Astra",
			},
			{
				value: "gpt-6.1-sol",
				displayName: "GPT-6.1 Sol",
				description: "Rápido",
			},
		],
	});
});

describe("Agent composer", () => {
	test.each([
		"claude",
		"codex",
	] as const)("selects the %s model before creating the first turn", async (agent) => {
		render(<Composer agent={agent} />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Selecionar modelo" }),
			).toBeEnabled(),
		);
		const picker = screen.getByRole("button", { name: "Selecionar modelo" });
		expect(picker).toHaveTextContent(
			agent === "claude" ? "Sonnet" : "GPT-6 Astra",
		);
		await userEvent.click(picker);
		await userEvent.click(
			await screen.findByRole("option", {
				name: agent === "claude" ? /Opus/ : /GPT-6.1 Sol/,
			}),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		);
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agent,
				model: agent === "claude" ? "opus" : "gpt-6.1-sol",
			}),
		);
	});
	test("native defaults have removable chips and selectable checkboxes", async () => {
		request.agentListSkills.mockResolvedValue([
			{
				...skill,
				id: "native",
				source: { kind: "harness", agent: "codex" },
				origin: "system",
			},
		]);
		render(<Composer />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Remover review" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: /Configurar Skills/ }),
		);
		expect(
			screen.getByRole("checkbox", { name: "Usar review" }),
		).not.toBeChecked();
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Usar review" }),
		);
		expect(screen.getByText("Integrada ao sistema")).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		);
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ skillIds: ["native"] }),
		);
	});

	test("agent switching ignores a stale catalog and applies the new agent defaults", async () => {
		let finish!: (value: unknown) => void;
		request.agentListSkills.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		request.agentListSkills.mockResolvedValueOnce([
			{
				...skill,
				id: "claude-skill",
				name: "claude-skill",
				defaultFor: ["claude"],
			},
		]);
		const { rerender } = render(<Composer agent="codex" />);
		rerender(<Composer agent="claude" />);
		expect(
			await screen.findByRole("button", { name: "Remover claude-skill" }),
		).toBeInTheDocument();
		finish([skill]);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Remover review" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		);
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ agent: "claude", skillIds: ["claude-skill"] }),
		);
	});
	test("unavailable native Skills show a reason and cannot be enabled", async () => {
		request.agentListSkills.mockResolvedValue([
			{
				...skill,
				source: { kind: "harness", agent: "codex" },
				unavailableReason: "Skill contém link simbólico.",
			},
		]);
		render(<Composer />);
		await userEvent.click(
			screen.getByRole("button", { name: /Configurar Skills/ }),
		);
		expect(
			screen.getByRole("checkbox", { name: "Usar review" }),
		).toBeDisabled();
		expect(
			screen.getByRole("checkbox", { name: "Usar review" }),
		).not.toBeChecked();
		expect(
			screen.getByText("Skill contém link simbólico."),
		).toBeInTheDocument();
	});

	test("can start with the configured model and retry after model discovery fails", async () => {
		request.codexListModels.mockRejectedValueOnce(
			new Error("Falha ao carregar modelos"),
		);
		render(<Composer />);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Falha ao carregar modelos",
		);
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled();
		await userEvent.click(
			screen.getByRole("button", { name: "Tentar carregar modelos novamente" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Selecionar modelo" }),
			).toBeEnabled(),
		);
	});
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
			extensionSelections: [],
			builtinCommandNames: [],
			mcpServerIds: [],
			model: "default",
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
		expect(request.agentExtensionSetDefaults).toHaveBeenCalledWith({
			agent: "claude",
			skillIds: ["debug"],
			extensionSelections: [],
			builtinCommandNames: [],
			mcpServerIds: [],
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

test("explicit builtin and MCP defaults are frozen alongside package components", async () => {
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [],
		builtins: [
			{
				name: "review",
				kind: "command",
				description: "Revisar",
				limitation: "Descrições podem continuar visíveis.",
			},
		],
		defaults: { selections: [], builtinCommandNames: ["review"] },
		verifiedRuntime: "test",
	});
	request.agentMcpList.mockResolvedValue([
		{
			id: "server",
			name: "Servidor",
			transport: "http",
			defaults: { codex: true, claude: false },
			connection: { state: "disconnected" },
		},
	]);
	render(<Composer />);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar extensões/ }),
	);
	expect(
		screen.getByRole("checkbox", { name: "Usar comando interno review" }),
	).toBeChecked();
	expect(
		screen.getByText(/sem confirmação a cada chamada/),
	).toBeInTheDocument();
	await userEvent.keyboard("{Escape}");
	await userEvent.click(
		screen.getByRole("button", { name: "Iniciar conversa" }),
	);
	expect(request.claudeCreateSession).toHaveBeenCalledWith(
		expect.objectContaining({
			builtinCommandNames: ["review"],
			mcpServerIds: ["server"],
			extensionSelections: [],
		}),
	);
});

test("Skills picker combines builtin Skills and package Skills without selecting sibling commands", async () => {
	const packageId = `extension:${"a".repeat(64)}`,
		revision = "b".repeat(64);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [
			{
				id: packageId,
				revision,
				name: "Pacote",
				components: [
					{
						id: "skill",
						kind: "skill",
						name: "Revisão do pacote",
						description: "Inspecionar alterações",
						sources: [],
						diagnostics: [],
					},
					{
						id: "command",
						kind: "command",
						name: "tool",
						sources: [],
						diagnostics: [],
					},
				],
			},
		],
		nativePlugins: [],
		builtins: [
			{
				name: "debug",
				kind: "skill",
				description: "Investigar",
				limitation: "Descrições podem continuar visíveis.",
			},
			{ name: "clear", kind: "command", description: "Limpar" },
		],
		defaults: { selections: [], builtinCommandNames: ["debug"] },
		verifiedRuntime: "test",
	});
	request.agentExtensionReview.mockResolvedValue([
		{
			packageId,
			componentId: "skill",
			status: "adapted",
			reason: "Compatível",
		},
		{
			packageId,
			componentId: "command",
			status: "adapted",
			reason: "Compatível",
		},
	]);
	request.agentExtensionCapabilities.mockImplementation(
		async ({ selections }) =>
			selections.flatMap((s: { componentIds: string[] }) =>
				s.componentIds.map((componentId) => ({
					packageId,
					componentId,
					status: "adapted",
					reason: "Compatível",
				})),
			),
	);
	render(<Composer agent="claude" />);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills/ }),
	);
	expect(
		screen.getByRole("checkbox", { name: "Usar Skill interna debug" }),
	).toBeChecked();
	expect(
		screen.queryByRole("checkbox", { name: /clear/ }),
	).not.toBeInTheDocument();
	await userEvent.click(
		await screen.findByRole("checkbox", {
			name: "Usar Pacote: Revisão do pacote",
		}),
	);
	await userEvent.keyboard("{Escape}");
	expect(
		screen.getByRole("button", { name: "Remover Skill interna debug" }),
	).toBeInTheDocument();
	expect(
		screen.getByRole("button", { name: "Remover Pacote: Revisão do pacote" }),
	).toBeInTheDocument();
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Iniciar conversa" }),
	);
	expect(request.claudeCreateSession).toHaveBeenCalledWith(
		expect.objectContaining({
			skillIds: [],
			builtinCommandNames: ["debug"],
			extensionSelections: [{ packageId, revision, componentIds: ["skill"] }],
			mcpServerIds: [],
		}),
	);
});

test("closing the library refreshes newly saved defaults for the next conversation", async () => {
	const builtin = {
		name: "debug",
		kind: "skill",
		description: "Investigar",
		limitation: "",
	};
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [],
		builtins: [builtin],
		defaults: { selections: [], builtinCommandNames: [] },
	});
	const { rerender } = render(<Composer agent="claude" />);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	settingsState.isOpen = true;
	rerender(<Composer agent="claude" />);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [],
		builtins: [builtin],
		defaults: { selections: [], builtinCommandNames: ["debug"] },
	});
	settingsState.isOpen = false;
	rerender(<Composer agent="claude" />);
	expect(
		await screen.findByRole("button", { name: "Remover Skill interna debug" }),
	).toBeInTheDocument();
});

test("stale package defaults block creation until the old selection is removed", async () => {
	const packageId = `extension:${"a".repeat(64)}`,
		revision = "b".repeat(64);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [{ id: packageId, name: "Pacote", revision, components: [] }],
		nativePlugins: [],
		builtins: [],
		defaults: {
			selections: [
				{
					packageId,
					revision: "c".repeat(64),
					componentIds: ["old"],
					trustedHookDigest: "c".repeat(64),
				},
			],
			builtinCommandNames: [],
		},
	});
	request.agentExtensionCapabilities.mockResolvedValue([
		{
			packageId,
			componentId: "old",
			status: "adapted",
			reason: "Old archive still valid",
		},
	]);
	render(<Composer />);
	await screen.findByRole("alert");
	expect(
		screen.getByRole("button", { name: "Iniciar conversa" }),
	).toBeDisabled();
});

test.each([
	"addition",
	"removal",
] as const)("absent saved defaults preserve all four user selections after builtin %s", async (change) => {
	const packageId = `extension:${"e".repeat(64)}`,
		revision = "f".repeat(64);
	const debug = {
		name: "debug",
		kind: "skill",
		description: "Investigar",
		limitation: "",
	};
	const clear = { name: "clear", kind: "command", description: "Limpar" };
	const library = {
		installed: [
			{
				id: packageId,
				revision,
				name: "Pacote",
				components: [
					{
						id: "skill",
						kind: "skill",
						name: "Skill do pacote",
						sources: [],
						diagnostics: [],
					},
				],
			},
		],
		nativePlugins: [],
		builtins: [debug, clear],
		verifiedRuntime: "test",
	};
	request.agentExtensionInventory.mockResolvedValue(library);
	request.agentListSkills.mockResolvedValue([{ ...skill, defaultFor: [] }]);
	request.agentMcpList.mockResolvedValue([
		{
			id: "server",
			name: "Servidor",
			transport: "http",
			defaults: { claude: false, codex: false },
			connection: { state: "disconnected" },
		},
	]);
	request.agentExtensionReview.mockResolvedValue([
		{
			packageId,
			componentId: "skill",
			status: "adapted",
			reason: "Compatível",
		},
	]);
	const { rerender } = render(<Composer agent="claude" />);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills/ }),
	);
	await userEvent.click(
		screen.getByRole("checkbox", { name: "Usar Skill interna debug" }),
	);
	await userEvent.click(screen.getByRole("checkbox", { name: "Usar review" }));
	await userEvent.click(
		await screen.findByRole("checkbox", {
			name: "Usar Pacote: Skill do pacote",
		}),
	);
	await userEvent.keyboard("{Escape}");
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar extensões/ }),
	);
	await userEvent.click(
		screen.getByRole("checkbox", { name: "Usar comando interno clear" }),
	);
	await userEvent.click(screen.getByRole("checkbox", { name: /^Servidor/ }));
	await userEvent.keyboard("{Escape}");
	settingsState.isOpen = true;
	rerender(<Composer agent="claude" />);
	request.agentExtensionInventory.mockResolvedValue({
		...library,
		builtins:
			change === "addition"
				? [debug, clear, { ...clear, name: "new-command" }]
				: [clear],
	});
	settingsState.isOpen = false;
	rerender(<Composer agent="claude" />);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Iniciar conversa" }),
	);
	expect(request.claudeCreateSession).toHaveBeenCalledWith(
		expect.objectContaining({
			skillIds: ["review"],
			builtinCommandNames: [],
			extensionSelections: [{ packageId, revision, componentIds: ["skill"] }],
			mcpServerIds: ["server"],
		}),
	);
});
