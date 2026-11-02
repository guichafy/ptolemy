import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { ExtensionChoices } from "@/shared/extension-rpc";
import { ResourceWorkspace } from "./workspace";

const request = vi.hoisted(() => ({
	agentExtensionReview: vi.fn(async () => []),
	agentImportSkill: vi.fn(),
	agentExtensionSources: vi.fn(async () => []),
}));
vi.mock("@/components/agents/resource-rpc", () => ({
	resourceRpc: { request },
}));
const library = {
	skills: [
		{
			id: "one",
			name: "review",
			description: "Review code",
			source: { kind: "harness" as const, agent: "codex" as const },
			origin: "system" as const,
			defaultFor: [],
		},
	],
	inventory: {
		installed: [],
		nativePlugins: [],
		builtins: [],
		verifiedRuntime: "test",
	},
	servers: [],
	loading: false,
	error: null,
};
function Workspace() {
	const [choices, onChange] = useState<ExtensionChoices>({
		skillIds: [],
		extensionSelections: [],
		builtinCommandNames: [],
		mcpServerIds: [],
	});
	return (
		<ResourceWorkspace
			agent="codex"
			page="skills"
			choices={choices}
			onChange={onChange}
			library={library}
			onRefresh={() => {}}
		/>
	);
}
it("lets both hosts edit system Skills through the same controlled workspace", async () => {
	render(<Workspace />);
	const choice = screen.getByRole("checkbox", { name: "Usar review" });
	await userEvent.click(choice);
	expect(choice).toBeChecked();
	expect(screen.getByText("Integrada ao Codex")).toBeVisible();
	expect(request.agentImportSkill).not.toHaveBeenCalled();
});
it("opens a dedicated Skills marketplace", async () => {
	render(<Workspace />);
	await userEvent.click(
		screen.getByRole("tab", { name: "Marketplace de Skills" }),
	);
	expect(
		screen.getByRole("heading", { name: "Marketplace de Skills" }),
	).toBeVisible();
	expect(screen.queryByText("Marketplace de Plugins")).not.toBeInTheDocument();
});

it("never renders another harness's native Skill even when a mixed library arrives", () => {
	render(
		<ResourceWorkspace
			agent="codex"
			page="skills"
			library={{
				...library,
				skills: [
					...library.skills,
					{
						...library.skills[0],
						id: "claude",
						name: "Claude private",
						source: { kind: "harness", agent: "claude" },
					},
				],
			}}
			choices={{
				skillIds: [],
				extensionSelections: [],
				builtinCommandNames: [],
				mcpServerIds: [],
			}}
			onChange={() => {}}
			onRefresh={() => {}}
		/>,
	);
	expect(
		screen.queryByRole("checkbox", { name: "Usar Claude private" }),
	).not.toBeInTheDocument();
	expect(screen.getByRole("checkbox", { name: "Usar review" })).toBeVisible();
});
it("shows harness ownership and a clear return from native Skill details", async () => {
	render(<Workspace />);
	expect(screen.getByText("Integrada ao Codex")).toBeVisible();
	await userEvent.click(
		screen.getByRole("button", { name: "Detalhes de review" }),
	);
	expect(
		screen.getByRole("button", { name: "Voltar à lista de Skills" }),
	).toBeVisible();
	expect(screen.getByText(/Instalação gerenciada pelo Codex/)).toBeVisible();
	await userEvent.click(
		screen.getByRole("button", { name: "Voltar à lista de Skills" }),
	);
	expect(screen.getByRole("checkbox", { name: "Usar review" })).toBeVisible();
	expect(
		screen.getByRole("button", { name: "Detalhes de review" }),
	).toHaveFocus();
});
