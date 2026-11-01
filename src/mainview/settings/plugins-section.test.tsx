import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake settings context so we can drive the component in isolation.
const settingsState = vi.hoisted(() => ({
	enabledOrder: ["apps", "github", "calc"] as string[],
	updateEnabledOrder: vi.fn() as ReturnType<typeof vi.fn>,
}));
vi.mock("./settings-context", () => ({
	useSettings: () => settingsState,
}));
vi.mock("../providers/rpc", () => ({
	rpc: { request: {} },
	setOpenPreferencesHandler: vi.fn(),
	setClaudeSessionsUpdateHandler: vi.fn(),
}));
vi.mock("./claude-section", () => ({ ClaudeSection: () => null }));

const { PluginsSection } = await import("./plugins-section");

describe("<PluginsSection />", () => {
	beforeEach(() => {
		settingsState.enabledOrder = ["apps", "github", "calc"];
		settingsState.updateEnabledOrder.mockReset();
	});

	it("renders the count badge (x/5)", () => {
		render(<PluginsSection />);
		expect(screen.getByText("3/5 ativos")).toBeInTheDocument();
	});

	it("renders every active plugin with its label", () => {
		render(<PluginsSection />);
		expect(screen.getByText("Apps")).toBeInTheDocument();
		expect(screen.getByText("GitHub")).toBeInTheDocument();
		expect(screen.getByText("Calculadora")).toBeInTheDocument();
	});

	it("renders every available (non-active) plugin under 'Disponíveis'", () => {
		render(<PluginsSection />);
		expect(screen.getByText("Disponíveis")).toBeInTheDocument();
		// web + claude are not in enabledOrder, so they should show as available
		expect(screen.getByText("Busca Web")).toBeInTheDocument();
		expect(screen.getByText("Claude Code")).toBeInTheDocument();
	});

	it("caps active plugins at five while Codex stays opt-in", () => {
		settingsState.enabledOrder = ["apps", "github", "calc", "web", "codex"];
		// Six plugins exist but only five fit; swap one in to reach "all".
		render(<PluginsSection />);
		expect(screen.getByText("5/5 ativos")).toBeInTheDocument();
		// Claude is the only one left out, and it cannot be added at the cap.
		expect(screen.getByLabelText("Habilitar Claude Code")).toBeDisabled();
	});

	it("clicking the + on an available plugin adds it to enabledOrder", async () => {
		const user = userEvent.setup();
		render(<PluginsSection />);

		await user.click(
			screen.getByRole("button", { name: /Habilitar Busca Web/i }),
		);

		expect(settingsState.updateEnabledOrder).toHaveBeenCalledWith([
			"apps",
			"github",
			"calc",
			"web",
		]);
	});

	it("clicking the − on an active plugin removes it", async () => {
		const user = userEvent.setup();
		render(<PluginsSection />);

		await user.click(screen.getByRole("button", { name: /Desabilitar Apps/i }));

		expect(settingsState.updateEnabledOrder).toHaveBeenCalledWith([
			"github",
			"calc",
		]);
	});

	it("removal button is disabled when only one plugin remains", () => {
		settingsState.enabledOrder = ["github"];
		render(<PluginsSection />);

		const disableBtn = screen.getByLabelText("Desabilitar GitHub");
		expect(disableBtn).toBeDisabled();
	});

	it("add button is disabled when reaching MAX_ACTIVE (5)", () => {
		settingsState.enabledOrder = ["apps", "github", "calc", "web", "claude"];
		render(<PluginsSection />);

		// No available plugins rendered, so just confirm counter shows cap.
		expect(screen.getByText("5/5 ativos")).toBeInTheDocument();
	});

	it("calls onNavigateToPlugin when settings icon is clicked on a configurable plugin", async () => {
		const onNavigate = vi.fn();
		settingsState.enabledOrder = ["github", "claude"]; // both configurable
		const user = userEvent.setup();

		render(<PluginsSection onNavigateToPlugin={onNavigate} />);

		// The "Configurar X" button only appears for plugins with configComponent
		await user.click(screen.getByLabelText("Configurar GitHub"));
		expect(onNavigate).toHaveBeenCalledWith("github");
	});
});
