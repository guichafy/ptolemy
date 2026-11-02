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

async function configure(page: "Skills" | "Plugins" | "MCP" = "Skills") {
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", {
			name: new RegExp(`Configurar ${page} da conversa`),
		}),
	);
}
async function apply() {
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
}
async function start() {
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Iniciar conversa" }),
	);
}

describe("Compact agent composer", () => {
	test("has one configuration control and no selected Skill chips", async () => {
		render(<Composer />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
		expect(
			screen.queryByRole("button", { name: "Remover review" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /Configurar Skills/ }),
		).not.toBeInTheDocument();
		expect(screen.queryByText("review")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Configurar recursos da conversa" }),
		).toBeEnabled();
	});
	test("freezes all four selections and the default model on create", async () => {
		render(<Composer />);
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith({
			agent: "codex",
			prompt: "Revisar alteração",
			skillIds: ["review"],
			extensionSelections: [],
			builtinCommandNames: [],
			mcpServerIds: [],
			model: "default",
		});
	});
	test.each([
		"claude",
		"codex",
	] as const)("selects the %s model before the first turn", async (agent) => {
		render(<Composer agent={agent} />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Selecionar modelo" }),
			).toBeEnabled(),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Selecionar modelo" }),
		);
		await userEvent.click(
			await screen.findByRole("option", {
				name: agent === "claude" ? /Opus/ : /GPT-6.1 Sol/,
			}),
		);
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agent,
				model: agent === "claude" ? "opus" : "gpt-6.1-sol",
			}),
		);
	});
	test("system Skills are edited in the modal and explicit none survives apply", async () => {
		request.agentListSkills.mockResolvedValue([
			{
				...skill,
				id: "native",
				source: { kind: "harness", agent: "codex" },
				origin: "system",
			},
		]);
		render(<Composer />);
		await configure();
		const check = await screen.findByRole("checkbox", { name: "Usar review" });
		await waitFor(() => expect(check).toBeChecked());
		expect(screen.getByText("Integrada ao Codex")).toBeVisible();
		await userEvent.click(check);
		await apply();
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ skillIds: [] }),
		);
	});
	test("cancel discards a changed selection", async () => {
		render(<Composer />);
		await configure();
		const check = await screen.findByRole("checkbox", { name: "Usar review" });
		await userEvent.click(check);
		await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ skillIds: ["review"] }),
		);
	});
	test("unavailable Skills show their reason and cannot be enabled", async () => {
		request.agentListSkills.mockResolvedValue([
			{ ...skill, unavailableReason: "Skill contém link simbólico." },
		]);
		render(<Composer />);
		await configure();
		const check = await screen.findByRole("checkbox", { name: "Usar review" });
		expect(check).not.toBeChecked();
		expect(check).toBeDisabled();
		expect(screen.getByText("Skill contém link simbólico.")).toBeVisible();
	});
	test("imports a Skill into the draft and saves defaults only through the explicit action", async () => {
		request.agentImportSkill.mockResolvedValue({
			...skill,
			id: "debug",
			name: "debug",
			defaultFor: [],
		});
		request.agentListSkills.mockResolvedValue([
			{ ...skill, id: "debug", name: "debug", defaultFor: [] },
		]);
		render(<Composer agent="claude" />);
		await configure();
		await userEvent.type(
			screen.getByLabelText("URL da Skill no GitHub"),
			"https://github.com/a/b/tree/main/debug",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Importar Skill" }),
		);
		expect(
			await screen.findByRole("checkbox", { name: "Usar debug" }),
		).toBeChecked();
		expect(request.agentExtensionSetDefaults).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getByRole("button", { name: "Usar seleção como padrão" }),
		);
		await waitFor(() =>
			expect(request.agentExtensionSetDefaults).toHaveBeenCalledWith({
				agent: "claude",
				skillIds: ["debug"],
				extensionSelections: [],
				builtinCommandNames: [],
				mcpServerIds: [],
			}),
		);
	});
	test("failed import retains its URL and never commits a selection", async () => {
		request.agentImportSkill.mockRejectedValue(Error("SKILL.md inválido"));
		render(<Composer />);
		await configure();
		await userEvent.type(
			screen.getByLabelText("URL da Skill no GitHub"),
			"https://github.com/a/b",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Importar Skill" }),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"SKILL.md inválido",
		);
		expect(screen.getByLabelText("URL da Skill no GitHub")).toHaveValue(
			"https://github.com/a/b",
		);
		expect(request.claudeCreateSession).not.toHaveBeenCalled();
	});
	test("pending import keeps the modal open and blocks background submission", async () => {
		let finish!: (value: typeof skill) => void;
		request.agentImportSkill.mockReturnValue(
			new Promise((r) => {
				finish = r;
			}),
		);
		render(<Composer />);
		await configure();
		await userEvent.type(
			screen.getByLabelText("URL da Skill no GitHub"),
			"https://github.com/a/b",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Importar Skill" }),
		);
		await userEvent.keyboard("{Escape}");
		expect(screen.getByRole("dialog")).toBeVisible();
		expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
		finish({ ...skill, id: "imported" });
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled(),
		);
	});
	test("missing CLI keeps import reachable while validated creation and apply are blocked", async () => {
		request.agentExtensionInventory.mockRejectedValue(
			Error("CLI não encontrado"),
		);
		render(<Composer agent="claude" />);
		await screen.findByText("CLI não encontrado");
		await configure();
		expect(screen.getByLabelText("URL da Skill no GitHub")).toBeEnabled();
		expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Usar seleção como padrão" }),
		).toBeDisabled();
	});
	test("pending inventory can be inspected without enabling apply", async () => {
		request.agentExtensionInventory.mockReturnValue(new Promise(() => {}));
		render(<Composer />);
		await configure();
		expect(screen.getByRole("dialog")).toBeVisible();
		expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
	});
	test("agent switch ignores a stale catalog and uses the new defaults", async () => {
		let finish!: (value: unknown) => void;
		request.agentListSkills.mockImplementationOnce(
			() =>
				new Promise((r) => {
					finish = r;
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
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
		finish([skill]);
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ agent: "claude", skillIds: ["claude-skill"] }),
		);
	});
	test("can retry model discovery without blocking the configured model", async () => {
		request.codexListModels.mockRejectedValueOnce(
			Error("Falha ao carregar modelos"),
		);
		render(<Composer />);
		await screen.findByText("Falha ao carregar modelos");
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Tentar carregar modelos novamente" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Selecionar modelo" }),
			).toBeEnabled(),
		);
	});
	test("retains text and selection when creation fails", async () => {
		request.claudeCreateSession.mockRejectedValue(Error("CLI indisponível"));
		render(<Composer />);
		await start();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"CLI indisponível",
		);
		expect(
			screen.getByRole("textbox", { name: "Mensagem para Codex" }),
		).toHaveValue("Revisar alteração");
	});
	test("Shift Enter and IME never submit; Enter submits exactly once", async () => {
		render(<Composer />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Iniciar conversa" }),
			).toBeEnabled(),
		);
		const input = screen.getByRole("textbox", { name: "Mensagem para Codex" });
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		expect(request.claudeCreateSession).not.toHaveBeenCalled();
		fireEvent.keyDown(input, { key: "Enter" });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() =>
			expect(request.claudeCreateSession).toHaveBeenCalledTimes(1),
		);
	});
	test("a stale plugin default blocks creation and can be removed in the modal", async () => {
		request.agentExtensionInventory.mockResolvedValue({
			installed: [],
			nativePlugins: [],
			builtins: [],
			defaults: {
				selections: [
					{ packageId: "old", revision: "old", componentIds: ["missing"] },
				],
				builtinCommandNames: [],
			},
		});
		render(<Composer />);
		await screen.findByRole("alert");
		expect(
			screen.getByRole("button", { name: "Iniciar conversa" }),
		).toBeDisabled();
		await configure("Plugins");
		await userEvent.click(
			screen.getByRole("button", { name: "Remover seleção indisponível" }),
		);
		await apply();
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ extensionSelections: [] }),
		);
	});
	test("OAuth unavailable defaults remain removable while unchecked OAuth is disabled", async () => {
		request.agentMcpList.mockResolvedValue([
			{
				id: "oauth",
				name: "Precisa login",
				transport: "http",
				defaults: { claude: false, codex: true },
				connection: { state: "disconnected" },
				authentication: {
					required: true,
					ready: false,
					reason: "Conecte OAuth",
				},
			},
		]);
		render(<Composer />);
		await screen.findByRole("alert");
		await configure("MCP");
		const check = screen.getByRole("checkbox", { name: "Usar Precisa login" });
		expect(check).toBeChecked();
		expect(check).toBeEnabled();
		await userEvent.click(check);
		expect(check).toBeDisabled();
		await apply();
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ mcpServerIds: [] }),
		);
	});
	test("preference refresh applies newly saved defaults", async () => {
		request.agentExtensionInventory.mockResolvedValue({
			installed: [],
			nativePlugins: [],
			builtins: [],
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
			builtins: [{ name: "debug", kind: "skill", description: "Debug" }],
			defaults: { selections: [], builtinCommandNames: ["debug"] },
		});
		settingsState.isOpen = false;
		rerender(<Composer agent="claude" />);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Configurar recursos da conversa" }),
			).toHaveTextContent("1"),
		);
		await start();
		expect(request.claudeCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ builtinCommandNames: ["debug"] }),
		);
	});
});
