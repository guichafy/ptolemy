import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SettingsSection = "plugins" | "general" | "network" | `plugin:${string}`;

const settingsState = vi.hoisted(() => ({
	isOpen: true,
	closeDialog: vi.fn(),
	initialSection: null as SettingsSection | null,
	enabledOrder: ["github", "claude"] as string[],
}));
vi.mock("./settings-context", () => ({
	useSettings: () => settingsState,
}));
vi.mock("../providers/rpc", () => ({
	rpc: { request: {} },
	setOpenPreferencesHandler: vi.fn(),
	setClaudeSessionsUpdateHandler: vi.fn(),
}));

// Heavy-weight section components — replace with markers so we can assert
// which one renders without pulling in their deps.
vi.mock("./plugins-section", () => ({
	PluginsSection: ({
		onNavigateToPlugin,
	}: {
		onNavigateToPlugin?: (id: string) => void;
	}) => (
		<div data-testid="plugins-section">
			<button
				type="button"
				onClick={() => onNavigateToPlugin?.("github")}
				data-testid="nav-to-github"
			>
				go
			</button>
		</div>
	),
}));
vi.mock("./general-section", () => ({
	GeneralSection: () => <div data-testid="general-section" />,
}));
vi.mock("./network-section", () => ({
	NetworkSection: () => <div data-testid="network-section" />,
}));
vi.mock("./claude-section", () => ({
	ClaudeSection: () => <div data-testid="claude-section" />,
}));
vi.mock("./github-section", () => ({
	GitHubSection: () => <div data-testid="github-section" />,
}));

vi.mock("./agent-resources/preferences", () => ({
	AgentResourcePreferences: ({
		agent,
		page,
	}: {
		agent: string;
		page: string;
	}) => (
		<div data-testid="agent-resource-page">
			{agent}:{page}
		</div>
	),
}));
vi.mock("./codex-section", () => ({
	CodexSection: () => <div data-testid="codex-section" />,
}));

const { SettingsDialog } = await import("./settings-dialog");

describe("<SettingsDialog />", () => {
	beforeEach(() => {
		settingsState.isOpen = true;
		settingsState.initialSection = null;
		settingsState.enabledOrder = ["github", "claude"];
		settingsState.closeDialog.mockReset();
	});

	it("organizes resource pages under the selected harness instead of central Extensions", async () => {
		settingsState.enabledOrder = ["github", "claude", "codex"];
		render(<SettingsDialog />);
		expect(
			screen.queryByRole("button", { name: "Extensões" }),
		).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Codex" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Skills do Codex" }),
		);
		expect(screen.getByTestId("agent-resource-page")).toHaveTextContent(
			"codex:skills",
		);
		await userEvent.click(screen.getByRole("button", { name: "MCP do Codex" }));
		expect(screen.getByTestId("agent-resource-page")).toHaveTextContent(
			"codex:mcp",
		);
	});
	it("renders nothing when isOpen is false", () => {
		settingsState.isOpen = false;
		render(<SettingsDialog />);
		expect(screen.queryByText("Preferências")).not.toBeInTheDocument();
		expect(screen.queryByTestId("plugins-section")).not.toBeInTheDocument();
	});

	it("defaults to the Plugins section when opened without initialSection", () => {
		render(<SettingsDialog />);
		expect(screen.getByTestId("plugins-section")).toBeInTheDocument();
		expect(screen.queryByTestId("general-section")).not.toBeInTheDocument();
	});

	it("honors initialSection when provided", () => {
		settingsState.initialSection = "network";
		render(<SettingsDialog />);
		expect(screen.getByTestId("network-section")).toBeInTheDocument();
		expect(screen.queryByTestId("plugins-section")).not.toBeInTheDocument();
	});

	it("clicking a nav item switches the section", async () => {
		const user = userEvent.setup();
		render(<SettingsDialog />);

		// "Rede" is the button label for network
		await user.click(screen.getByRole("button", { name: /Rede/i }));
		expect(screen.getByTestId("network-section")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /Geral/i }));
		expect(screen.getByTestId("general-section")).toBeInTheDocument();
	});

	it("lists sub-nav entries for enabled plugins that have a configComponent", () => {
		render(<SettingsDialog />);
		// Claude has a configComponent and is in enabledOrder → sub-nav shows up
		const claudeEntries = screen.getAllByText("Claude Code");
		expect(claudeEntries.length).toBeGreaterThanOrEqual(1);
	});

	it("clicking a plugin sub-nav routes to its config section", async () => {
		const user = userEvent.setup();
		render(<SettingsDialog />);

		// The sub-nav button for Claude (only rendered because configComponent exists)
		const claudeBtn = screen
			.getAllByRole("button")
			.find((b) => b.textContent?.trim() === "Claude Code");
		expect(claudeBtn).toBeDefined();
		await user.click(claudeBtn!);

		expect(screen.getByTestId("claude-section")).toBeInTheDocument();
	});

	it("PluginsSection → onNavigateToPlugin switches to that plugin's config", async () => {
		const user = userEvent.setup();
		render(<SettingsDialog />);

		await user.click(screen.getByTestId("nav-to-github"));
		// github has a configComponent → GitHubSection is rendered.
		expect(screen.getByTestId("github-section")).toBeInTheDocument();
	});

	it("falls back to PluginsSection when navigating to an unknown plugin config", async () => {
		settingsState.initialSection = "plugin:does-not-exist";
		render(<SettingsDialog />);
		expect(screen.getByTestId("plugins-section")).toBeInTheDocument();
	});
});
