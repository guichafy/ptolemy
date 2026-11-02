import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConversationConfiguration } from "@/components/agents/conversation-configuration";
import type { ExtensionChoices } from "@/shared/extension-rpc";
import type { SkillSummary } from "@/shared/skills";

const request = vi.hoisted(() => ({
	agentRemoveSkill: vi.fn(),
	agentExtensionCapabilities: vi.fn(async () => []),
	agentExtensionReview: vi.fn(async () => []),
}));
vi.mock("@/components/agents/resource-rpc", () => ({
	resourceRpc: { request },
}));
const skill: SkillSummary = {
	id: "portable",
	name: "Portable",
	description: "Portable description",
	source: {
		kind: "github",
		url: "https://github.com/a/b",
		commit: "a".repeat(40),
	},
	defaultFor: [],
};
const choices = {
	skillIds: [skill.id],
	extensionSelections: [],
	builtinCommandNames: [],
	mcpServerIds: [],
};
beforeEach(() => {
	vi.clearAllMocks();
	request.agentRemoveSkill.mockResolvedValue(true);
});
function Harness({
	existing = false,
	onApply,
}: {
	existing?: boolean;
	onApply: (choices: ExtensionChoices) => void | Promise<void>;
}) {
	const [skills, setSkills] = useState([skill]);
	return (
		<ConversationConfiguration
			agent="codex"
			library={{
				agent: "codex",
				skills,
				inventory: {
					installed: [],
					builtins: [],
					nativePlugins: [],
					verifiedRuntime: "fixture",
				},
				servers: [],
				loading: false,
				error: null,
			}}
			choices={choices}
			onApply={onApply}
			onRefresh={() => setSkills([])}
			archived={
				existing
					? {
							agent: "codex",
							revision: 1,
							legacy: false,
							busy: false,
							choices,
							skills: [skill],
							packages: [],
							servers: [],
							capabilities: [],
						}
					: undefined
			}
		/>
	);
}
async function uninstall() {
	await userEvent.click(
		screen.getByRole("button", { name: "Configurar recursos da conversa" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar Skills da conversa/ }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Detalhes de Portable" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Desinstalar da biblioteca" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Confirmar desinstalação" }),
	);
}
it("uninstalls a portable library Skill and removes it from the new conversation draft", async () => {
	const apply = vi.fn();
	render(<Harness onApply={apply} />);
	await uninstall();
	expect(
		screen.queryByRole("checkbox", { name: "Usar Portable" }),
	).not.toBeInTheDocument();
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	expect(apply).toHaveBeenCalledWith({ ...choices, skillIds: [] });
});
it("keeps an existing conversation's frozen selection after uninstalling its library copy", async () => {
	const apply = vi.fn();
	render(<Harness existing onApply={apply} />);
	await uninstall();
	expect(screen.getByRole("checkbox", { name: "Usar Portable" })).toBeChecked();
	expect(screen.getByText(/Arquivada nesta conversa/)).toBeVisible();
	await userEvent.click(
		screen.getByRole("button", { name: "Detalhes de Portable" }),
	);
	expect(
		screen.queryByRole("button", { name: "Desinstalar da biblioteca" }),
	).not.toBeInTheDocument();
	await userEvent.click(
		screen.getByRole("button", { name: "Voltar à lista de Skills" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
	expect(apply).toHaveBeenCalledWith(choices);
});
