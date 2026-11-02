import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ExtensionCapability } from "@/shared/extension-rpc";
import { ConversationConfiguration } from "./conversation-configuration";

const request = vi.hoisted(() => ({
	agentExtensionReview: vi.fn(async () => []),
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
