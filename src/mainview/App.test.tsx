import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const { request, settings } = vi.hoisted(() => ({
	request: {
		listApps: vi.fn(),
		getAppIcon: vi.fn(),
		openApp: vi.fn(),
		resizeWindow: vi.fn(),
		githubGetTokenStatus: vi.fn(),
		agentListSkills: vi.fn(),
		agentExtensionInventory: vi.fn(),
		agentMcpList: vi.fn(),
		agentExtensionCapabilities: vi.fn(),
		agentExtensionCommands: vi.fn(),
		claudeListSessions: vi.fn(),
		claudeOpenChat: vi.fn(),
		claudeCreateSession: vi.fn(),
		claudeListSupportedModels: vi.fn(),
		codexListModels: vi.fn(),
	},
	settings: {
		plugins: { enabledOrder: ["apps", "github", "claude", "codex", "web"] },
		claude: { model: "sonnet" },
		codex: { model: "default" },
		github: { customFilters: [] },
	},
}));
vi.mock("./providers/rpc", () => ({
	rpc: { request },
	setClaudeSessionsUpdateHandler: vi.fn(),
}));
vi.mock("./settings/settings-context", () => ({
	SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
	useSettings: () => ({
		settings,
		enabledOrder: settings.plugins.enabledOrder,
		codexSettings: settings.codex,
		isOpen: false,
		analyticsSettings: { consentGiven: false },
		openDialog: vi.fn(),
	}),
}));
vi.mock("./settings/settings-dialog", () => ({ SettingsDialog: () => null }));
vi.mock("./analytics", () => ({
	initRendererAnalytics: vi.fn(),
	shutdownRendererAnalytics: vi.fn(),
}));
vi.mock("./hooks/use-window-shown", () => ({ useWindowShown: vi.fn() }));

beforeEach(() => {
	vi.resetAllMocks();
	request.listApps.mockResolvedValue([
		{ name: "Safari", path: "/Applications/Safari.app" },
		{ name: "Slack", path: "/Applications/Slack.app" },
	]);
	request.getAppIcon.mockResolvedValue({ icon: null });
	request.resizeWindow.mockResolvedValue(true);
	request.githubGetTokenStatus.mockResolvedValue({ hasToken: false });
	request.agentListSkills.mockResolvedValue([]);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [],
		builtins: [],
	});
	request.agentMcpList.mockResolvedValue([]);
	request.agentExtensionCapabilities.mockResolvedValue([]);
	request.agentExtensionCommands.mockResolvedValue([]);
	request.claudeListSessions.mockResolvedValue([
		{
			id: "one",
			title: "Primeira conversa",
			projectId: "project",
			updatedAt: new Date().toISOString(),
		},
		{
			id: "two",
			title: "Segunda conversa",
			projectId: "project",
			updatedAt: new Date().toISOString(),
		},
	]);
	request.claudeListSupportedModels.mockResolvedValue({
		models: [{ value: "sonnet", displayName: "Sonnet", description: "" }],
	});
	request.codexListModels.mockResolvedValue({
		models: [
			{ value: "default", displayName: "Padrão do Codex", description: "" },
		],
	});
});

describe("Palette keyboard navigation", () => {
	test("Tab follows controls and arrows move through plugins without entering the prompt", async () => {
		render(<App />);
		const apps = screen.getByRole("tab", { name: "Apps" });
		apps.focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(screen.getByRole("tab", { name: "GitHub" })).toHaveFocus();
		expect(screen.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await userEvent.keyboard("{ArrowRight}");
		expect(screen.getByRole("tab", { name: "Claude Code" })).toHaveFocus();
		await userEvent.tab();
		expect(
			screen.getByRole("textbox", { name: "Mensagem para Claude" }),
		).toHaveFocus();
		await userEvent.tab({ shift: true });
		expect(screen.getByRole("tab", { name: "Claude Code" })).toHaveFocus();
		await userEvent.keyboard("{End}");
		expect(screen.getByRole("tab", { name: "Web" })).toHaveFocus();
		await userEvent.keyboard("{ArrowRight}");
		expect(apps).toHaveFocus();
	});
	test("Ctrl+Tab switches plugins from the composer in both directions", async () => {
		render(<App />);
		await userEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
		const prompt = screen.getByRole("textbox", {
			name: "Mensagem para Claude",
		});
		prompt.focus();
		await userEvent.keyboard("{Control>}{Tab}{/Control}");
		expect(screen.getByRole("tab", { name: "Codex" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await userEvent.keyboard("{Control>}{Shift>}{Tab}{/Shift}{/Control}");
		expect(screen.getByRole("tab", { name: "Claude Code" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
	test("Ctrl+Tab from the tab bar focuses the newly selected plugin's input", async () => {
		render(<App />);
		screen.getByRole("tab", { name: "Apps" }).focus();
		await userEvent.keyboard("{Control>}{Tab}{/Control}");
		expect(screen.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByRole("textbox")).toHaveFocus();
	});
	test("arrows reach recent sessions while editing arrows remain in a nonempty prompt", async () => {
		render(<App />);
		await userEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
		const first = await screen.findByRole("button", {
			name: /Primeira conversa/,
		});
		const second = screen.getByRole("button", { name: /Segunda conversa/ });
		const prompt = screen.getByRole("textbox", {
			name: "Mensagem para Claude",
		});
		await userEvent.type(prompt, "duas linhas");
		await userEvent.keyboard("{ArrowDown}");
		expect(prompt).toHaveFocus();
		await userEvent.clear(prompt);
		await userEvent.keyboard("{ArrowDown}");
		expect(first).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		expect(second).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		expect(request.claudeOpenChat).toHaveBeenCalledTimes(1);
		expect(request.claudeCreateSession).not.toHaveBeenCalled();
	});
	test("Tab does not change plugins and Enter on a focused result opens it once", async () => {
		render(<App />);
		const search = screen.getByRole("textbox");
		await userEvent.type(search, "Sa");
		const result = await screen.findByRole("button", { name: /Safari/ });
		await userEvent.tab();
		expect(result).toHaveFocus();
		expect(screen.getByRole("tab", { name: "Apps" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await userEvent.keyboard("{Enter}");
		expect(request.openApp).toHaveBeenCalledTimes(1);
	});
	test("GitHub filter owns Tab, arrows and Enter instead of palette search", async () => {
		render(<App />);
		await userEvent.click(screen.getByRole("tab", { name: "GitHub" }));
		await userEvent.click(screen.getByRole("button", { name: "Repositories" }));
		const code = await screen.findByRole("button", { name: /Code/ });
		code.focus();
		await userEvent.keyboard("{ArrowDown}");
		expect(screen.getByRole("button", { name: /Issues/ })).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		expect(screen.getByRole("button", { name: "Issues" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "GitHub" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
	test("model and Skills selectors can be opened and closed entirely by keyboard", async () => {
		request.agentListSkills.mockResolvedValue([
			{
				id: "review",
				name: "review",
				description: "Revisão",
				source: { kind: "github" },
				defaultFor: [],
			},
			{
				id: "debug",
				name: "debug",
				description: "Depuração",
				source: { kind: "github" },
				defaultFor: [],
			},
		]);
		render(<App />);
		await userEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
		const prompt = screen.getByRole("textbox", {
			name: "Mensagem para Claude",
		});
		await userEvent.click(prompt);
		await userEvent.tab();
		expect(
			screen.getByRole("button", { name: "Selecionar modelo" }),
		).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		expect(await screen.findByRole("combobox")).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}{Enter}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		await userEvent.tab();
		expect(
			screen.getByRole("button", { name: "Configurar Skills" }),
		).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		const review = await screen.findByRole("checkbox", { name: "Usar review" });
		expect(review).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		expect(screen.getByRole("checkbox", { name: "Usar debug" })).toHaveFocus();
		await userEvent.keyboard(" {Escape}");
		expect(
			screen.getByRole("button", { name: "Configurar Skills (1)" }),
		).toHaveFocus();
		expect(request.claudeCreateSession).not.toHaveBeenCalled();
		expect(screen.getByRole("tab", { name: "Claude Code" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
	test("IME and modified arrows do not navigate away from search", () => {
		render(<App />);
		const search = screen.getByRole("textbox");
		search.focus();
		fireEvent.keyDown(search, { key: "ArrowDown", isComposing: true });
		fireEvent.keyDown(search, { key: "ArrowDown", metaKey: true });
		expect(search).toHaveFocus();
	});
});
