import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ExtensionChoices } from "@/shared/extension-rpc";
import { ExtensionPicker } from "./extension-picker";

const request = vi.hoisted(() => ({
	agentExtensionReview: vi.fn(),
	agentExtensionSetDefaults: vi.fn(),
}));
vi.mock("../providers/rpc", () => ({ rpc: { request } }));
vi.mock("../settings/settings-context", () => ({
	useSettings: () => ({ openDialog: vi.fn() }),
}));
const revision = "a".repeat(64),
	id = `extension:${"b".repeat(64)}`;
const components = [
	{
		id: "command",
		name: "Command",
		kind: "command" as const,
		sources: [
			{
				effective: true,
				harness: "portable" as const,
				manifest: "x",
				declaration: "x",
			},
		],
		diagnostics: [],
	},
	{
		id: "hook",
		name: "Hook",
		kind: "hook" as const,
		sources: [
			{
				effective: true,
				harness: "portable" as const,
				manifest: "x",
				declaration: "x",
			},
		],
		diagnostics: [],
	},
];
let initial: ExtensionChoices;
function Fixture() {
	const [choices, setChoices] = useState(initial);
	return (
		<ExtensionPicker
			agent="codex"
			inventory={{
				installed: [
					{
						id,
						name: "Tools",
						sourceId: "s",
						description: "",
						url: "https://github.com/a/b",
						revision,
						components,
						diagnostics: [],
					},
				],
				nativePlugins: [],
				builtins: [],
				verifiedRuntime: "test",
			}}
			servers={[]}
			choices={choices}
			onChange={setChoices}
			disabled={false}
			onBusyChange={() => {}}
		/>
	);
}
beforeEach(() => {
	vi.resetAllMocks();
	initial = {
		skillIds: [],
		extensionSelections: [],
		builtinCommandNames: [],
		mcpServerIds: [],
	};
	request.agentExtensionReview.mockImplementation(
		async ({ trustedHookDigest }) =>
			components.map((c) => ({
				packageId: id,
				componentId: c.id,
				status:
					c.kind === "hook" && !trustedHookDigest
						? "requires-configuration"
						: "adapted",
				reason:
					c.kind === "hook" && !trustedHookDigest
						? "Autorize hooks desta revisão."
						: "Compatível",
			})),
	);
	request.agentExtensionSetDefaults.mockResolvedValue(true);
});
test("hook trust is explicit, unavailable hooks are unchecked, defaults preserve concrete revisions", async () => {
	render(<Fixture />);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar extensões/ }),
	);
	const hook = await screen.findByRole("checkbox", {
		name: "Usar Tools: Hook",
	});
	expect(hook).toBeDisabled();
	expect(hook).not.toBeChecked();
	await userEvent.click(
		screen.getByRole("checkbox", { name: /Autorizar hooks/ }),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("checkbox", { name: "Usar Tools: Hook" }),
		).toBeEnabled(),
	);
	await userEvent.click(
		screen.getByRole("checkbox", { name: "Usar Tools: Hook" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Salvar seleção como padrão" }),
	);
	expect(request.agentExtensionSetDefaults).toHaveBeenCalledWith(
		expect.objectContaining({
			extensionSelections: [
				{
					packageId: id,
					revision,
					componentIds: ["hook"],
					trustedHookDigest: revision,
				},
			],
		}),
	);
});
test("selecting a component of an updated package never reuses the old revision trust", async () => {
	initial.extensionSelections = [
		{
			packageId: id,
			revision: "c".repeat(64),
			componentIds: [],
			trustedHookDigest: "c".repeat(64),
		},
	];
	render(<Fixture />);
	await userEvent.click(
		screen.getByRole("button", { name: /Configurar extensões/ }),
	);
	await userEvent.click(
		await screen.findByRole("checkbox", { name: "Usar Tools: Command" }),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Salvar seleção como padrão" }),
	);
	expect(request.agentExtensionSetDefaults).toHaveBeenCalledWith(
		expect.objectContaining({
			extensionSelections: [
				{ packageId: id, revision, componentIds: ["command"] },
			],
		}),
	);
});
