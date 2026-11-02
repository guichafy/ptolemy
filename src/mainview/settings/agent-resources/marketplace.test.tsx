import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExtensionSummary } from "@/shared/extensions";
import { ResourceWorkspace } from "./workspace";

const request = vi.hoisted(() => ({
	agentExtensionSources: vi.fn(),
	agentExtensionBrowse: vi.fn(),
	agentExtensionInspect: vi.fn(),
	agentExtensionInstall: vi.fn(),
	agentExtensionRemove: vi.fn(),
	agentExtensionReview: vi.fn(async () => []),
}));
vi.mock("@/components/agents/resource-rpc", () => ({
	resourceRpc: { request },
}));
const pkg: ExtensionSummary = {
	id: "fixture",
	name: "Fixture Skill",
	description: "A portable fixture",
	sourceId: "portable",
	url: "https://github.com/a/b",
	revision: "revision",
	components: [
		{
			id: "skill",
			name: "fixture",
			kind: "skill",
			path: "SKILL.md",
			sources: [],
			diagnostics: [],
		},
	],
	diagnostics: [],
};
let installed: ExtensionSummary[] = [];
beforeEach(() => {
	vi.clearAllMocks();
	installed = [];
	request.agentExtensionSources.mockResolvedValue([
		{
			id: "portable",
			name: "anthropics/skills",
			url: "https://github.com/anthropics/skills",
			builtin: true,
		},
		{
			id: "claude-plugins",
			name: "anthropics/claude-plugins-official",
			url: "https://github.com/anthropics/claude-plugins-official",
			builtin: true,
		},
		{
			id: "codex-plugins",
			name: "openai/plugins",
			url: "https://github.com/openai/plugins",
			builtin: true,
		},
	]);
	request.agentExtensionBrowse.mockResolvedValue([{ ...pkg, components: [] }]);
	request.agentExtensionInspect.mockResolvedValue({
		summary: pkg,
		capabilities: [],
	});
	request.agentExtensionInstall.mockImplementation(async () => {
		installed = [pkg];
		return pkg;
	});
	request.agentExtensionRemove.mockImplementation(async () => {
		installed = [];
		return true;
	});
});
function Harness({
	agent = "codex",
	page = "skills",
}: {
	agent?: "claude" | "codex";
	page?: "skills" | "plugins";
}) {
	const [packages, setPackages] = useState<ExtensionSummary[]>(installed);
	return (
		<ResourceWorkspace
			agent={agent}
			page={page}
			choices={{
				skillIds: [],
				extensionSelections: [],
				builtinCommandNames: [],
				mcpServerIds: [],
			}}
			onChange={() => {}}
			library={{
				agent,
				skills: [],
				inventory: {
					installed: packages,
					nativePlugins: [],
					builtins: [],
					verifiedRuntime: "fixture",
				},
				servers: [],
				loading: false,
				error: null,
			}}
			onRefresh={() => setPackages([...installed])}
		/>
	);
}
it("shows install state, explicit shared-library uninstall and returns to the filtered catalog", async () => {
	render(<Harness />);
	await userEvent.click(
		screen.getByRole("tab", { name: "Marketplace de Skills" }),
	);
	const search = screen.getByRole("textbox", {
		name: "Buscar no marketplace de Skills",
	});
	await userEvent.type(search, "Fixture");
	await userEvent.click(
		await screen.findByRole("button", { name: /Fixture Skill/ }),
	);
	expect(
		await screen.findByRole("button", { name: "Voltar à lista de Skills" }),
	).toBeVisible();
	await userEvent.click(screen.getByRole("button", { name: "Instalar Skill" }));
	expect(
		await screen.findByText("Instalada na biblioteca compartilhada"),
	).toBeVisible();
	expect(
		screen.queryByRole("button", { name: "Instalar Skill" }),
	).not.toBeInTheDocument();
	await userEvent.click(
		screen.getByRole("button", { name: "Desinstalar da biblioteca" }),
	);
	expect(screen.getByText(/Desinstalar Fixture Skill remove/)).toBeVisible();
	await userEvent.click(
		screen.getByRole("button", { name: "Confirmar desinstalação" }),
	);
	expect(
		await screen.findByRole("button", { name: "Instalar Skill" }),
	).toBeEnabled();
	await userEvent.click(
		screen.getByRole("button", { name: "Voltar à lista de Skills" }),
	);
	expect(
		screen.getByRole("textbox", { name: "Buscar no marketplace de Skills" }),
	).toHaveValue("Fixture");
	expect(screen.getByRole("button", { name: /Fixture Skill/ })).toHaveFocus();
});
it("chooses the Codex plugin catalog independently of Claude", async () => {
	const view = render(<Harness page="plugins" />);
	await userEvent.click(
		screen.getByRole("tab", { name: "Marketplace de Plugins" }),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("combobox", { name: "Fonte de Plugins" }),
		).toHaveValue("codex-plugins"),
	);
	view.rerender(<Harness agent="claude" page="plugins" />);
	await userEvent.click(
		screen.getByRole("tab", { name: "Marketplace de Plugins" }),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("combobox", { name: "Fonte de Plugins" }),
		).toHaveValue("claude-plugins"),
	);
});

it("immediately acknowledges a slow item inspection and prevents duplicate clicks until details open", async () => {
	let finish!: (value: { summary: ExtensionSummary; capabilities: [] }) => void;
	request.agentExtensionInspect.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	render(<Harness />);
	await userEvent.click(
		screen.getByRole("tab", { name: "Marketplace de Skills" }),
	);
	const item = await screen.findByRole("button", { name: /Fixture Skill/ });
	await userEvent.click(item);
	expect(screen.getByRole("status")).toHaveTextContent(
		"Carregando detalhes de Fixture Skill",
	);
	expect(item).toHaveAttribute("aria-busy", "true");
	expect(item).toBeDisabled();
	await userEvent.click(item);
	expect(request.agentExtensionInspect).toHaveBeenCalledTimes(1);
	await act(async () => {
		finish({ summary: pkg, capabilities: [] });
	});
	expect(
		await screen.findByRole("heading", { name: "Fixture Skill" }),
	).toBeVisible();
	expect(screen.queryByText(/Carregando detalhes de/)).not.toBeInTheDocument();
	expect(
		screen.getByRole("button", { name: "Voltar à lista de Skills" }),
	).toBeEnabled();
});
it("replaces inspection feedback with a nearby error and lets the user retry without losing the catalog", async () => {
	let fail!: (error: Error) => void;
	request.agentExtensionInspect.mockReturnValueOnce(
		new Promise((_resolve, reject) => {
			fail = reject;
		}),
	);
	render(<Harness />);
	await userEvent.click(
		screen.getByRole("tab", { name: "Marketplace de Skills" }),
	);
	const item = await screen.findByRole("button", { name: /Fixture Skill/ });
	await userEvent.click(item);
	expect(screen.getByRole("status")).toHaveTextContent(
		"Carregando detalhes de Fixture Skill",
	);
	await act(async () => {
		fail(new Error("Não foi possível buscar os detalhes."));
	});
	expect(screen.queryByText(/Carregando detalhes de/)).not.toBeInTheDocument();
	const error = screen.getByRole("alert");
	expect(error).toHaveTextContent("Não foi possível buscar os detalhes.");
	expect(item).toBeEnabled();
	expect(item).not.toHaveAttribute("aria-busy", "true");
	request.agentExtensionInspect.mockResolvedValueOnce({
		summary: pkg,
		capabilities: [],
	});
	await userEvent.click(
		within(error).getByRole("button", { name: "Tentar novamente" }),
	);
	expect(
		await screen.findByRole("heading", { name: "Fixture Skill" }),
	).toBeVisible();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
