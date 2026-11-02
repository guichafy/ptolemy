import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentResourcePreferences } from "./preferences";

const request = vi.hoisted(() => ({
	agentListSkills: vi.fn(),
	agentExtensionInventory: vi.fn(),
	agentMcpList: vi.fn(),
	agentExtensionReview: vi.fn(),
	agentExtensionSetDefaults: vi.fn(),
}));
vi.mock("../../providers/rpc", () => ({ rpc: { request } }));
beforeEach(() => {
	vi.resetAllMocks();
	request.agentListSkills.mockImplementation(async ({ agent }) => [
		{
			id: agent,
			name: `Skill ${agent}`,
			description: "Description",
			source: { kind: "harness", agent },
			defaultFor: [agent],
		},
	]);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		builtins: [],
		nativePlugins: [],
		verifiedRuntime: "test",
	});
	request.agentMcpList.mockResolvedValue([]);
	request.agentExtensionReview.mockResolvedValue([]);
	request.agentExtensionSetDefaults.mockResolvedValue(true);
});
it("saves explicit empty defaults only for the selected harness", async () => {
	render(<AgentResourcePreferences agent="codex" page="skills" />);
	const choice = await screen.findByRole("checkbox", {
		name: "Usar Skill codex",
	});
	await waitFor(() => expect(choice).toBeChecked());
	await userEvent.click(choice);
	expect(request.agentExtensionSetDefaults).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Usar seleção como padrão" }),
	);
	expect(request.agentExtensionSetDefaults).toHaveBeenCalledWith({
		agent: "codex",
		skillIds: [],
		extensionSelections: [],
		builtinCommandNames: [],
		mcpServerIds: [],
	});
});
it("retains the draft when switching resource pages", async () => {
	const { rerender } = render(
		<AgentResourcePreferences agent="claude" page="skills" />,
	);
	const choice = await screen.findByRole("checkbox", {
		name: "Usar Skill claude",
	});
	await waitFor(() => expect(choice).toBeChecked());
	await userEvent.click(choice);
	rerender(<AgentResourcePreferences agent="claude" page="plugins" />);
	rerender(<AgentResourcePreferences agent="claude" page="skills" />);
	expect(
		await screen.findByRole("checkbox", { name: "Usar Skill claude" }),
	).not.toBeChecked();
});
