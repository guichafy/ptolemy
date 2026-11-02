import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExtensionCapability } from "@/shared/extension-rpc";
import { ConversationConfiguration } from "./conversation-configuration";

const request = vi.hoisted(() => ({
	agentExtensionReview: vi.fn(async () => []),
	agentMcpSave: vi.fn(),
	agentMcpGetEditable: vi.fn(),
	agentMcpStatus: vi.fn(async () => ({ state: "disconnected" })),
	agentExtensionCapabilities: vi.fn(
		async (): Promise<ExtensionCapability[]> => [],
	),
	agentExtensionSetDefaults: vi.fn(async () => true),
}));
vi.mock("@/components/agents/resource-rpc", () => ({
	resourceRpc: { request },
}));
const library = {
	skills: Array.from({ length: 80 }, (_, i) => ({
		id: `skill-${i}`,
		name: `skill-${i}`,
		description: "A very long Skill description ".repeat(30),
		source: { kind: "harness" as const, agent: "codex" as const },
		defaultFor: [],
	})),
	inventory: {
		installed: [],
		builtins: [],
		nativePlugins: [],
		verifiedRuntime: "test",
	},
	servers: [],
	loading: false,
	error: null,
};
const choices = {
	skillIds: library.skills.map((s) => s.id),
	extensionSelections: [],
	builtinCommandNames: [],
	mcpServerIds: [],
};
beforeEach(() => vi.clearAllMocks());
it("keeps eighty selected Skills out of the composer and summary", async () => {
	render(
		<ConversationConfiguration
			agent="codex"
			library={library}
			choices={choices}
			onApply={() => {}}
			onRefresh={() => {}}
		/>,
	);
	expect(screen.queryByText("skill-79")).not.toBeInTheDocument();
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	expect(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	).toHaveTextContent("80");
	expect(screen.queryByText("skill-79")).not.toBeInTheDocument();
	expect(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	).toBeVisible();
});
it("cancel discards the draft and apply commits all choices explicitly", async () => {
	const apply = vi.fn();
	render(
		<ConversationConfiguration
			agent="codex"
			library={library}
			choices={choices}
			onApply={apply}
			onRefresh={() => {}}
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	await userEvent.click(
		await screen.findByRole("checkbox", { name: "Usar skill-0" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
	expect(apply).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	expect(screen.getByRole("checkbox", { name: "Usar skill-0" })).toBeChecked();
	await userEvent.click(screen.getByRole("checkbox", { name: "Usar skill-0" }));
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	expect(apply).toHaveBeenCalledWith({
		...choices,
		skillIds: choices.skillIds.slice(1),
	});
	expect(request.agentExtensionSetDefaults).not.toHaveBeenCalled();
});
it("refuses applying while a turn is running", async () => {
	render(
		<ConversationConfiguration
			agent="codex"
			library={library}
			choices={choices}
			onApply={() => {}}
			onRefresh={() => {}}
			blocked="Aguarde a resposta terminar."
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
	expect(screen.getByText("Aguarde a resposta terminar.")).toBeVisible();
});

it("keeps the draft open if a package lost readiness before applying", async () => {
	const apply = vi.fn();
	const pkg = {
		id: "package",
		revision: "revision",
		name: "Package",
		description: "",
		sourceId: "source",
		url: "https://github.com/a/b",
		diagnostics: [],
		components: [
			{
				id: "mcp",
				kind: "mcp" as const,
				name: "Remote",
				sources: [],
				diagnostics: [],
			},
		],
	};
	request.agentExtensionCapabilities.mockResolvedValueOnce([
		{
			packageId: pkg.id,
			componentId: "mcp",
			status: "requires-configuration",
			reason: "OAuth indisponível",
		},
	]);
	render(
		<ConversationConfiguration
			agent="codex"
			library={{
				...library,
				inventory: { ...library.inventory, installed: [pkg] },
			}}
			choices={{
				...choices,
				extensionSelections: [
					{ packageId: pkg.id, revision: pkg.revision, componentIds: ["mcp"] },
				],
			}}
			onApply={apply}
			onRefresh={() => {}}
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Plugins da conversa/ }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"OAuth indisponível",
	);
	expect(apply).not.toHaveBeenCalled();
	expect(screen.getByRole("dialog")).toBeVisible();
});

it("resets an open draft when conversation ownership changes", async () => {
	const first = vi.fn(),
		second = vi.fn();
	const props = {
		agent: "codex" as const,
		library,
		choices: { ...choices, skillIds: ["skill-0"] },
		onApply: first,
		onRefresh: () => {},
	};
	const view = render(
		<ConversationConfiguration {...props} scopeKey="first" />,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	view.rerender(
		<ConversationConfiguration
			{...props}
			scopeKey="second"
			choices={{ ...choices, skillIds: ["skill-1"] }}
			onApply={second}
		/>,
	);
	await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	expect(screen.getByRole("checkbox", { name: "Usar skill-1" })).toBeChecked();
	expect(
		screen.getByRole("checkbox", { name: "Usar skill-0" }),
	).not.toBeChecked();
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	expect(second).toHaveBeenCalledWith({ ...choices, skillIds: ["skill-1"] });
	expect(first).not.toHaveBeenCalled();
});
it("initializes a draft opened before the actual selection loads", async () => {
	const apply = vi.fn();
	const props = {
		agent: "codex" as const,
		library,
		choices: { ...choices, skillIds: ["skill-0"] },
		onApply: apply,
		onRefresh: () => {},
	};
	const view = render(
		<ConversationConfiguration
			{...props}
			library={{ ...library, loading: true }}
			choices={{ ...choices, skillIds: [] }}
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
	view.rerender(<ConversationConfiguration {...props} />);
	await waitFor(() =>
		expect(
			screen.getByRole("checkbox", { name: "Usar skill-0" }),
		).toBeChecked(),
	);
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	expect(apply).toHaveBeenCalledWith({ ...choices, skillIds: ["skill-0"] });
});
it("cannot leave a busy MCP editor and releases modal actions after saving", async () => {
	let finish!: () => void;
	request.agentMcpSave.mockReturnValue(
		new Promise<void>((resolve) => {
			finish = resolve;
		}),
	);
	request.agentMcpGetEditable.mockResolvedValue({
		id: "server",
		name: "Server",
		transport: "stdio",
		command: "test",
		defaults: { claude: false, codex: false },
	});
	const server = {
		id: "server",
		name: "Server",
		transport: "stdio" as const,
		defaults: { claude: false, codex: false },
		credentials: { env: [], headers: [], oauthClientSecret: false },
		authentication: { required: false, ready: true },
		connection: { state: "disconnected" as const },
	};
	render(
		<ConversationConfiguration
			agent="codex"
			library={{ ...library, servers: [server] }}
			choices={{ ...choices, skillIds: [] }}
			onApply={() => {}}
			onRefresh={() => {}}
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar MCP da conversa/ }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar Server" }),
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Salvar servidor" }),
	);
	expect(
		screen.getByRole("button", { name: "Voltar aos servidores" }),
	).toBeDisabled();
	await act(async () => {
		finish();
	});
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Voltar aos servidores" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Voltar aos servidores" }),
	);
	expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
	expect(screen.getByRole("button", { name: "Aplicar" })).toBeEnabled();
});
it("identifies snapshots removed from the library and hides unavailable registry actions", async () => {
	const server = {
		id: "frozen-server",
		name: "Frozen",
		transport: "stdio" as const,
		defaults: { claude: false, codex: false },
		credentials: { env: [], headers: [], oauthClientSecret: false },
		authentication: { required: false, ready: true },
		connection: { state: "disconnected" as const },
	};
	const savedChoices = {
		...choices,
		skillIds: ["skill-0"],
		mcpServerIds: [server.id],
	};
	const archived = {
		agent: "codex" as const,
		revision: 1,
		legacy: false,
		busy: false,
		choices: savedChoices,
		skills: [library.skills[0]],
		packages: [],
		servers: [server],
		capabilities: [],
	};
	render(
		<ConversationConfiguration
			agent="codex"
			library={{ ...library, skills: [], servers: [] }}
			archived={archived}
			choices={savedChoices}
			onApply={() => {}}
			onRefresh={() => {}}
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	expect(screen.getByText(/Arquivada nesta conversa/)).toBeVisible();
	await userEvent.click(screen.getByRole("button", { name: "MCP" }));
	expect(screen.getByText(/Arquivado nesta conversa/)).toBeVisible();
	expect(
		screen.queryByRole("button", { name: "Configurar Frozen" }),
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole("button", { name: "Remover da biblioteca" }),
	).not.toBeInTheDocument();
});
