import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ExtensionsSection } from "./extensions-section";

const request = vi.hoisted(() => ({
	agentExtensionSources: vi.fn(),
	agentExtensionInstalled: vi.fn(),
	agentExtensionInventory: vi.fn(),
	agentExtensionBrowse: vi.fn(),
	agentExtensionInspect: vi.fn(),
	agentExtensionInstall: vi.fn(),
	agentExtensionAddSource: vi.fn(),
	agentExtensionRemoveSource: vi.fn(),
	agentExtensionCapabilities: vi.fn(),
	agentExtensionReview: vi.fn(),
	agentMcpList: vi.fn(),
	agentMcpGetEditable: vi.fn(),
	agentMcpSave: vi.fn(),
	agentMcpRegistration: vi.fn(),
	agentMcpStatus: vi.fn(),
	agentMcpConnect: vi.fn(),
	agentMcpCancel: vi.fn(),
	agentMcpDisconnect: vi.fn(),
}));
vi.mock("../providers/rpc", () => ({ rpc: { request } }));
const pkg = {
	id: "p",
	name: "Pacote longo de revisão",
	description: "Revisar",
	sourceId: "s",
	url: "https://github.com/a/b",
	revision: "final",
	components: [
		{
			id: "c",
			name: "Comando",
			kind: "command",
			sources: [{ effective: true, harness: "portable" }],
			diagnostics: [],
		},
	],
	diagnostics: [],
};
beforeEach(() => {
	vi.resetAllMocks();
	request.agentExtensionSources.mockResolvedValue([
		{ id: "s", name: "a/b", url: "https://github.com/a/b" },
	]);
	request.agentExtensionInstalled.mockResolvedValue([]);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [],
		builtins: [],
	});
	request.agentExtensionBrowse.mockResolvedValue([pkg]);
	request.agentExtensionInspect.mockResolvedValue({
		summary: pkg,
		capabilities: [
			{ componentId: "c", status: "adapted", reason: "Compatível" },
		],
	});
	request.agentExtensionCapabilities.mockResolvedValue([]);
	request.agentMcpList.mockResolvedValue([]);
});
test("inspects before installing, shows failure and retries", async () => {
	render(<ExtensionsSection />);
	await userEvent.click(screen.getByRole("tab", { name: "Marketplace" }));
	await userEvent.click(
		await screen.findByRole("button", {
			name: "Inspecionar Pacote longo de revisão",
		}),
	);
	expect(request.agentExtensionInstall).not.toHaveBeenCalled();
	await screen.findByText("Compatível");
	request.agentExtensionInstall.mockRejectedValueOnce(
		Error("Falha ao instalar"),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Instalar pacote" }),
	);
	await screen.findByRole("alert");
	request.agentExtensionInstall.mockResolvedValue(pkg);
	await userEvent.click(
		screen.getByRole("button", { name: "Instalar pacote" }),
	);
	await screen.findByText(/Instalado/);
});
test("MCP keeps invalid JSON draft and never saves on typing", async () => {
	render(<ExtensionsSection />);
	await userEvent.click(screen.getByRole("tab", { name: "MCP" }));
	await userEvent.click(
		await screen.findByRole("button", { name: "Novo servidor" }),
	);
	fireEvent.change(screen.getByLabelText("Nome"), {
		target: { value: "Servidor" },
	});
	fireEvent.change(screen.getByLabelText("Comando"), {
		target: { value: "runner" },
	});
	fireEvent.change(screen.getByLabelText("Argumentos (JSON)"), {
		target: { value: "[invalid" },
	});
	expect(request.agentMcpSave).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Salvar servidor" }),
	);
	await screen.findByRole("alert");
	expect(screen.getByLabelText("Argumentos (JSON)")).toHaveValue("[invalid");
	expect(request.agentMcpSave).not.toHaveBeenCalled();
});
test("loading errors remain visible and can retry", async () => {
	request.agentExtensionInstalled.mockRejectedValueOnce(
		Error("Biblioteca indisponível"),
	);
	render(<ExtensionsSection />);
	await screen.findByRole("alert");
	await userEvent.click(
		screen.getByRole("button", { name: "Tentar novamente" }),
	);
	await waitFor(() =>
		expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
	);
});

test("adds and removes marketplace sources using IDs", async () => {
	request.agentExtensionAddSource.mockResolvedValue({
		id: "new",
		name: "author/new",
		url: "https://github.com/author/new",
	});
	render(<ExtensionsSection />);
	await userEvent.click(screen.getByRole("tab", { name: "Marketplace" }));
	await screen.findByRole("option", { name: "a/b" });
	await userEvent.type(
		screen.getByLabelText("URL da fonte GitHub"),
		"https://github.com/author/new",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Adicionar fonte" }),
	);
	await waitFor(() =>
		expect(request.agentExtensionAddSource).toHaveBeenCalledWith({
			url: "https://github.com/author/new",
		}),
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Remover fonte" })).toBeEnabled(),
	);
	await userEvent.click(screen.getByRole("button", { name: "Remover fonte" }));
	expect(request.agentExtensionRemoveSource).toHaveBeenCalledWith({ id: "s" });
});
test("old browse responses cannot replace a new source", async () => {
	let resolve!: (v: unknown) => void;
	request.agentExtensionSources.mockResolvedValue([
		{ id: "s", name: "a/b" },
		{ id: "new", name: "new/source" },
	]);
	request.agentExtensionBrowse
		.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		)
		.mockResolvedValueOnce([{ ...pkg, id: "new", name: "Novo pacote" }]);
	render(<ExtensionsSection />);
	await userEvent.click(screen.getByRole("tab", { name: "Marketplace" }));
	await screen.findByRole("option", { name: "new/source" });
	fireEvent.change(screen.getByLabelText("Fonte do marketplace"), {
		target: { value: "new" },
	});
	await screen.findByRole("button", { name: "Inspecionar Novo pacote" });
	resolve([pkg]);
	await waitFor(() =>
		expect(
			screen.queryByRole("button", { name: `Inspecionar ${pkg.name}` }),
		).not.toBeInTheDocument(),
	);
});
test("tabs support arrow focus and narrow layout preserves keyboard access", async () => {
	render(<ExtensionsSection />);
	const tab = screen.getByRole("tab", { name: "Instaladas" });
	tab.focus();
	await userEvent.keyboard("{ArrowRight}");
	expect(screen.getByRole("tab", { name: "Marketplace" })).toHaveFocus();
	await userEvent.keyboard("{End}");
	expect(screen.getByRole("tab", { name: "MCP" })).toHaveFocus();
	expect(screen.getByRole("tabpanel")).toHaveAttribute(
		"aria-labelledby",
		"extension-tab-MCP",
	);
});

const commandAndHook = {
	...pkg,
	components: [
		...pkg.components,
		{
			id: "h",
			name: "Hook",
			kind: "hook",
			sources: [{ effective: true, harness: "portable" }],
			diagnostics: [],
		},
	],
};
const reviewCaps = (componentId = "c") => [
	{ componentId, status: "adapted", reason: "Componente compatível" },
	{
		componentId: "h",
		status: "requires-configuration",
		reason: "Autorize hooks",
	},
];
function deferredReview() {
	let resolve!: (value: ReturnType<typeof reviewCaps>) => void;
	const promise = new Promise<ReturnType<typeof reviewCaps>>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function inspectInstalled(name = pkg.name) {
	await userEvent.click(
		await screen.findByRole("button", { name: `Inspecionar ${name}` }),
	);
	await screen.findByRole("checkbox", { name: "Ativar Comando" });
}
test("pending hook review never restores older component toggles", async () => {
	request.agentExtensionInstalled.mockResolvedValue([commandAndHook]);
	request.agentExtensionReview.mockResolvedValue(reviewCaps());
	render(<ExtensionsSection />);
	await inspectInstalled();
	const pending = deferredReview();
	request.agentExtensionReview.mockReturnValueOnce(pending.promise);
	await userEvent.click(
		screen.getByRole("checkbox", { name: /Autorizar execução/ }),
	);
	await userEvent.click(
		screen.getByRole("checkbox", { name: "Ativar Comando" }),
	);
	expect(
		screen.getByRole("checkbox", { name: "Ativar Comando" }),
	).toBeChecked();
	await act(async () => pending.resolve(reviewCaps()));
	expect(
		screen.getByRole("checkbox", { name: "Ativar Comando" }),
	).toBeChecked();
});
test.each([
	"detail",
	"agent",
] as const)("stale hook review cannot apply previous enabled IDs after changing %s", async (change) => {
	const other = {
		...pkg,
		id: "other",
		name: "Outro pacote",
		components: [{ ...pkg.components[0], id: "different" }],
	};
	request.agentExtensionInstalled.mockResolvedValue([commandAndHook, other]);
	request.agentExtensionReview.mockResolvedValue(reviewCaps());
	request.agentExtensionInventory.mockImplementation(async ({ agent }) => ({
		installed: [],
		nativePlugins: [],
		builtins: [],
		defaults: {
			selections: [
				{
					packageId: agent === "codex" ? "p" : "other",
					revision: "final",
					componentIds: [agent === "codex" ? "c" : "different"],
				},
			],
		},
	}));
	render(<ExtensionsSection />);
	await inspectInstalled();
	const pending = deferredReview();
	request.agentExtensionReview.mockReturnValueOnce(pending.promise);
	await userEvent.click(
		screen.getByRole("checkbox", { name: /Autorizar execução/ }),
	);
	if (change === "detail") {
		request.agentExtensionReview.mockResolvedValue(reviewCaps("different"));
		await inspectInstalled("Outro pacote");
	} else {
		fireEvent.change(screen.getByLabelText("Agente das extensões"), {
			target: { value: "codex" },
		});
		await inspectInstalled();
	}
	expect(
		screen.getByRole("checkbox", { name: "Ativar Comando" }),
	).toBeChecked();
	await act(async () => pending.resolve(reviewCaps()));
	expect(
		screen.getByRole("checkbox", { name: "Ativar Comando" }),
	).toBeChecked();
});

test("reopening a trusted installed revision reviews siblings with its saved digest", async () => {
	const installed = {
		...pkg,
		components: [
			...pkg.components,
			{
				id: "hook",
				name: "Hook",
				kind: "hook",
				sources: [{ effective: true, harness: "portable" }],
				diagnostics: [],
			},
		],
	};
	request.agentExtensionInstalled.mockResolvedValue([installed]);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [installed],
		nativePlugins: [],
		builtins: [],
		defaults: {
			selections: [
				{
					packageId: pkg.id,
					revision: pkg.revision,
					componentIds: ["c"],
					trustedHookDigest: pkg.revision,
				},
			],
			builtinCommandNames: [],
		},
	});
	request.agentExtensionReview.mockImplementation(
		async ({ trustedHookDigest }) => [
			{
				componentId: "hook",
				status:
					trustedHookDigest === pkg.revision
						? "adapted"
						: "requires-configuration",
				reason: trustedHookDigest ? "Autorizado" : "Autorize",
			},
		],
	);
	render(<ExtensionsSection />);
	await userEvent.click(
		await screen.findByRole("button", { name: `Inspecionar ${pkg.name}` }),
	);
	expect(request.agentExtensionReview).toHaveBeenCalledWith(
		expect.objectContaining({ trustedHookDigest: pkg.revision }),
	);
	await screen.findByText("Autorizado");
	const hook = screen.getByRole("checkbox", { name: "Ativar Hook" });
	expect(hook).not.toBeChecked();
	expect(hook).toBeEnabled();
	expect(
		screen.getByRole("checkbox", { name: /Autorizar execução dos hooks/ }),
	).toBeChecked();
	await userEvent.click(hook);
	expect(hook).toBeChecked();
});
