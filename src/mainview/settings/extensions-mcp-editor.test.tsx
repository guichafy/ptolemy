import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { McpEditor } from "./extensions-mcp-editor";

const request = vi.hoisted(() => ({
	agentMcpSave: vi.fn(),
	agentMcpStatus: vi.fn(),
	agentMcpConnect: vi.fn(),
	agentMcpCancel: vi.fn(),
	agentMcpDisconnect: vi.fn(),
	agentMcpRegistration: vi.fn(),
}));
vi.mock("../providers/rpc", () => ({ rpc: { request } }));
beforeEach(() => {
	vi.resetAllMocks();
	request.agentMcpStatus.mockResolvedValue({ state: "disconnected" });
	request.agentMcpSave.mockResolvedValue(true);
});
test("masked credentials round trip preserve, replace empty and remove without fetching a value", async () => {
	render(
		<McpEditor
			initial={{
				id: "x",
				name: "Servidor",
				transport: "stdio",
				command: "run",
				args: ["with spaces", ""],
				env: { TOKEN: { preserve: true } },
				defaults: { claude: false, codex: false },
			}}
			onSaved={() => {}}
			onCancel={() => {}}
		/>,
	);
	expect(
		screen.getByLabelText("Variáveis de ambiente valor 1"),
	).toHaveAttribute("type", "password");
	expect(screen.getByLabelText("Variáveis de ambiente valor 1")).toHaveValue(
		"",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Salvar servidor" }),
	);
	expect(request.agentMcpSave).toHaveBeenLastCalledWith({
		draft: expect.objectContaining({
			args: ["with spaces", ""],
			env: { TOKEN: { preserve: true } },
		}),
	});
	fireEvent.change(screen.getByLabelText("Variáveis de ambiente valor 1"), {
		target: { value: "replacement" },
	});
	fireEvent.change(screen.getByLabelText("Variáveis de ambiente valor 1"), {
		target: { value: "" },
	});
	await userEvent.click(
		screen.getByRole("button", { name: "Salvar servidor" }),
	);
	expect(request.agentMcpSave).toHaveBeenLastCalledWith({
		draft: expect.objectContaining({ env: { TOKEN: { value: "" } } }),
	});
	await userEvent.click(screen.getByRole("button", { name: "Remover campo" }));
	await userEvent.click(
		screen.getByRole("button", { name: "Salvar servidor" }),
	);
	expect(request.agentMcpSave).toHaveBeenLastCalledWith({
		draft: expect.objectContaining({ env: {} }),
	});
});
test("saved OAuth shows real status and exact issuer callback, then connects and cancels", async () => {
	request.agentMcpStatus.mockResolvedValue({ state: "waiting" });
	request.agentMcpConnect.mockResolvedValue({ state: "connecting" });
	request.agentMcpRegistration.mockResolvedValue({
		issuer: "https://issuer.example",
		resource: "https://mcp.example",
		redirectUri: "http://127.0.0.1/oauth/callback/issuer-digest",
	});
	render(
		<McpEditor
			isSaved
			initial={{
				id: "x",
				name: "Remote",
				transport: "http",
				url: "https://mcp.example",
				auth: { type: "oauth" },
				defaults: { claude: false, codex: false },
			}}
			onSaved={() => {}}
			onCancel={() => {}}
		/>,
	);
	await screen.findByText("Aguardando no navegador");
	await userEvent.click(
		screen.getByRole("button", { name: "Obter URI de registro" }),
	);
	expect(await screen.findByLabelText("URI de redirecionamento")).toHaveValue(
		"http://127.0.0.1/oauth/callback/issuer-digest",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Cancelar conexão" }),
	);
	expect(request.agentMcpCancel).toHaveBeenCalledWith({ id: "x" });
	fireEvent.change(screen.getByLabelText("URL do servidor"), {
		target: { value: "https://changed.example" },
	});
	expect(
		screen.getByRole("button", { name: "Obter URI de registro" }),
	).toBeDisabled();
});
