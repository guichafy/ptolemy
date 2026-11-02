import { describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
	reconcileLegacyMigration: vi.fn(),
	finalizeLegacyMigration: vi.fn(),
	list: vi.fn(),
	saveEditable: vi.fn(),
	getEditable: vi.fn(),
	get: vi.fn(),
}));
vi.mock("../mcp/oauth", () => ({ mcpOAuthService: {} }));
vi.mock("../mcp/registry", () => ({ mcpRegistry: registry }));
const { extensionRequestHandlers: handlers } = await import("./ui-service");
describe("extension RPC boundary", () => {
	it("retires the plaintext writer", () =>
		expect("agentSaveMcpServers" in handlers).toBe(false));
	it("reconciles before finalization and retries failed cutover without saving", async () => {
		registry.reconcileLegacyMigration.mockRejectedValueOnce(Error("collision"));
		await expect(
			handlers.agentMcpSave({
				draft: {
					id: "a",
					name: "a",
					transport: "stdio",
					command: "x",
					defaults: { claude: false, codex: false },
				},
			}),
		).rejects.toThrow();
		expect(registry.saveEditable).not.toHaveBeenCalled();
		registry.reconcileLegacyMigration.mockResolvedValue(undefined);
		registry.finalizeLegacyMigration.mockResolvedValue(undefined);
		registry.list.mockResolvedValue([]);
		await handlers.agentMcpList();
		expect(
			registry.reconcileLegacyMigration.mock.invocationCallOrder.at(-1),
		).toBeLessThan(
			registry.finalizeLegacyMigration.mock.invocationCallOrder.at(-1)!,
		);
	});
	it.each([
		{ agent: "other" },
		{
			agent: "codex",
			selections: [
				{ packageId: "a", revision: "x", componentIds: [], secretRef: "bad" },
			],
		},
	])("rejects invalid selection input", async (input) => {
		await expect(
			handlers.agentExtensionCapabilities(input as never),
		).rejects.toThrow(/inválid/);
	});
	it("rejects raw secret references before registry IO", async () => {
		const calls = registry.saveEditable.mock.calls.length;
		await expect(
			handlers.agentMcpSave({
				draft: {
					id: "a",
					name: "a",
					transport: "stdio",
					command: "x",
					defaults: { claude: false, codex: false },
					env: { KEY: { secretRef: "stolen" } },
				} as never,
			}),
		).rejects.toThrow();
		expect(registry.saveEditable.mock.calls.length).toBe(calls);
	});
});

it("does not allow removing package provenance or enabling a package server as standalone", async () => {
	registry.getEditable.mockResolvedValue({ id: "bound", packageId: "package" });
	await expect(
		handlers.agentMcpSave({
			draft: {
				id: "bound",
				name: "Bound",
				transport: "stdio",
				command: "run",
				defaults: { claude: false, codex: false },
			},
		}),
	).rejects.toThrow(/Vínculo/);
});

it("rejects a package-bound server without its component context even when no ROOT token exists", async () => {
	const { validateStandaloneMcp } = await import("./ui-service");
	registry.get.mockResolvedValue({
		id: "bound",
		packageId: "package",
		transport: "http",
		url: "https://example.test",
	});
	await expect(validateStandaloneMcp(["bound"])).rejects.toThrow(
		/componente da extensão/,
	);
});
it("binding templates expose credential names but never the package literals or references", async () => {
	const { extensionsStore } = await import("./store");
	const id = `extension:${"a".repeat(64)}`,
		revision = "b".repeat(64);
	const spy = vi.spyOn(extensionsStore, "getPackage").mockResolvedValue({
		id,
		name: "Tools",
		revision,
		components: [
			{
				id: "mcp",
				name: "Docs",
				kind: "mcp",
				sources: [{ effective: true }],
				definition: {
					config: {
						command: "runner",
						args: [`\${PLUGIN_ROOT}/server.mjs`],
						env: {
							TOKEN: "DO_NOT_EXPORT",
							OTHER: { secretRef: "private-ref" },
						},
					},
				},
			},
		],
	} as never);
	registry.list.mockResolvedValue([]);
	const draft = await handlers.agentMcpBindingDraft({
		packageId: id,
		revision,
		componentId: "mcp",
	});
	expect(JSON.stringify(draft)).not.toMatch(
		/DO_NOT_EXPORT|private-ref|secretRef|definition/,
	);
	expect(draft).toMatchObject({
		packageId: id,
		transport: "stdio",
		env: { TOKEN: { value: "" }, OTHER: { value: "" } },
		args: [`\${PLUGIN_ROOT}/server.mjs`],
	});
	spy.mockRestore();
});

it("new selections require the currently installed revision while historical packages stay backend-only", async () => {
	const { extensionsStore } = await import("./store");
	const { validateInstalledSelections } = await import("./ui-service");
	const spy = vi
		.spyOn(extensionsStore, "installed")
		.mockResolvedValue([{ id: "package", revision: "new" }] as never);
	await expect(
		validateInstalledSelections([
			{ packageId: "package", revision: "old", componentIds: [] },
		]),
	).rejects.toThrow(/removida ou atualizada/);
	await expect(
		validateInstalledSelections([
			{ packageId: "package", revision: "new", componentIds: [] },
		]),
	).resolves.toBeUndefined();
	spy.mockRestore();
});
