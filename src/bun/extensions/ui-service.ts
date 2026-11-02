import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionRequests } from "@/shared/extension-rpc";
import type { ExtensionSelection } from "@/shared/extensions";
import type { McpEditableServer } from "@/shared/mcp";
import { ensureMcpCutover } from "../mcp/cutover";
import { mcpOAuthService } from "../mcp/oauth";
import { mcpRegistry } from "../mcp/registry";
import { ptolemyDataDir } from "../paths";
import { skillsStore } from "../skills/store";
import { effectiveComponents, prepareSessionExtensions } from "./activation";
import { componentCapability } from "./capabilities";
import {
	codexHookSetupReason,
	extensionInventory,
	extensionSelectionCapabilities,
	importNativeExtension,
} from "./inventory";
import { boundMcpCapability, extensionMcpId } from "./mcp";
import { extensionsStore } from "./store";
import * as validate from "./ui-validation";

type Handlers = {
	[K in Exclude<
		keyof ExtensionRequests,
		"agentSessionCommands" | "agentSessionResources"
	>]: (
		params: ExtensionRequests[K]["params"],
	) => Promise<ExtensionRequests[K]["response"]>;
};
const cwd = () => join(ptolemyDataDir(), "projects");
export async function selectedCommands(
	agent: "claude" | "codex",
	selections: ExtensionSelection[],
) {
	const prepared = await prepareSessionExtensions(
		"preview",
		cwd(),
		selections,
		agent,
		{ materialize: false },
	);
	return prepared.commands.map((c) => ({
		name: c.name,
		description:
			typeof c.metadata.description === "string" ? c.metadata.description : "",
	}));
}
export async function validateInstalledSelections(
	selections: ExtensionSelection[],
) {
	const installed = await extensionsStore.installed();
	if (
		selections.some(
			(selection) =>
				!installed.some(
					(pkg) =>
						pkg.id === selection.packageId &&
						pkg.revision === selection.revision,
				),
		)
	)
		throw Error(
			"Extensão removida ou atualizada. Selecione a revisão instalada e autorize seus hooks novamente.",
		);
}
export async function validateCombinedSelection(
	input: ExtensionRequests["agentExtensionSetDefaults"]["params"],
) {
	validate.choices(input);
	await validateInstalledSelections(input.extensionSelections);
	await ensureMcpCutover();
	const inventory = await extensionInventory(input.agent, cwd());
	if (
		input.builtinCommandNames.some(
			(n) => !inventory.builtins.some((b) => b.name === n),
		)
	)
		throw Error("Comando interno indisponível.");
	const skills = await skillsStore.resolveForSession(
		input.agent,
		input.skillIds,
	);
	const prepared = await prepareSessionExtensions(
		"preview",
		cwd(),
		input.extensionSelections,
		input.agent,
		{ materialize: false },
	);
	const caps = await extensionSelectionCapabilities(
		input.agent,
		input.extensionSelections,
	);
	if (
		caps.some(
			(c) =>
				c.status === "incompatible" || c.status === "requires-configuration",
		)
	)
		throw Error("Seleção com componentes indisponíveis ou sem configuração.");
	if (
		prepared.skills.some((s) => skills.some((other) => other.name === s.name))
	)
		throw Error("Skills com mesmo nome na seleção.");
	await validateStandaloneMcp(input.mcpServerIds);
	await mcpRegistry.snapshot(input.mcpServerIds);
}
export async function validateStandaloneMcp(ids: string[]) {
	for (const id of ids) {
		const s = await mcpRegistry.get(id);
		if (s.packageId)
			throw Error(
				"Selecione o MCP pelo componente da extensão para preservar o contexto do pacote.",
			);
	}
}
export const extensionRequestHandlers: Handlers = {
	agentExtensionSources: async () => extensionsStore.sources(),
	agentExtensionAddSource: async ({ url }) => {
		validate.text(url);
		return extensionsStore.addSource(url);
	},
	agentExtensionRemoveSource: async ({ id }) => {
		validate.text(id);
		await extensionsStore.removeSource(id);
		return true;
	},
	agentExtensionBrowse: async ({ sourceId }) => {
		validate.text(sourceId);
		return extensionsStore.browse(sourceId);
	},
	agentExtensionInspect: async ({ sourceId, itemId, agent }) => {
		validate.text(sourceId);
		validate.text(itemId);
		validate.agent(agent);
		return extensionsStore.inspectReview(sourceId, itemId, agent);
	},
	agentExtensionInstall: async ({ sourceId, itemId }) => {
		validate.text(sourceId);
		validate.text(itemId);
		return extensionsStore.install(sourceId, itemId);
	},
	agentExtensionInstalled: async () => extensionsStore.installed(),
	agentExtensionRemove: async ({ id }) => {
		validate.text(id);
		await extensionsStore.remove(id);
		return true;
	},
	agentExtensionInventory: async ({ agent }) => {
		validate.agent(agent);
		const result = await extensionInventory(agent, cwd());
		return {
			...result,
			nativePlugins: result.nativePlugins.map(
				({ path: _path, ...safe }) => safe,
			),
		};
	},
	agentExtensionImportNative: async ({ agent, id }) => {
		validate.agent(agent);
		validate.text(id);
		await mkdir(cwd(), { recursive: true, mode: 0o700 });
		return importNativeExtension(agent, id, cwd());
	},
	agentExtensionReview: async ({
		agent,
		packageId,
		revision,
		trustedHookDigest,
	}) => {
		validate.agent(agent);
		validate.selections([
			{
				packageId,
				revision,
				componentIds: [],
				...(trustedHookDigest ? { trustedHookDigest } : {}),
			},
		]);
		await ensureMcpCutover();
		const pkg = await extensionsStore.getPackage(packageId, revision);
		const components = effectiveComponents(
			pkg,
			pkg.components.map((c) => c.id),
			agent,
		);
		const servers = await mcpRegistry.list();
		const setupReason =
			agent === "codex" &&
			trustedHookDigest === revision &&
			components.some(
				(c) =>
					c.kind === "hook" &&
					componentCapability(c, agent, true).status === "adapted",
			)
				? await codexHookSetupReason()
				: undefined;
		return components.map((c) => {
			let cap = componentCapability(c, agent, trustedHookDigest === revision);
			if (setupReason && c.kind === "hook" && cap.status === "adapted")
				cap = { ...cap, status: "requires-configuration", reason: setupReason };
			return {
				...(c.kind === "mcp"
					? boundMcpCapability(cap, servers, packageId, revision)
					: cap),
				packageId,
			};
		});
	},
	agentExtensionCapabilities: async ({ agent, selections }) => {
		validate.agent(agent);
		validate.selections(selections);
		await ensureMcpCutover();
		return extensionSelectionCapabilities(agent, selections);
	},
	agentExtensionCommands: async ({ agent, selections }) => {
		validate.agent(agent);
		validate.selections(selections);
		return selectedCommands(agent, selections);
	},
	agentExtensionSetDefaults: async (input) => {
		await validateCombinedSelection(input);
		await extensionsStore.setDefaults(
			input.agent,
			input.extensionSelections,
			input.builtinCommandNames,
		);
		await skillsStore.setDefaults(input.agent, input.skillIds);
		await mcpRegistry.setDefaults(input.agent, input.mcpServerIds);
		return true;
	},
	agentMcpList: async () => {
		await ensureMcpCutover();
		return mcpRegistry.list();
	},
	agentMcpGetEditable: async ({ id }) => {
		validate.text(id);
		await ensureMcpCutover();
		return mcpRegistry.getEditable(id);
	},
	agentMcpSave: async ({ draft, binding }) => {
		validate.editable(draft);
		await ensureMcpCutover();
		const original = await mcpRegistry.getEditable(draft.id).catch(() => null);
		if (original?.packageId !== draft.packageId && original)
			throw Error("Vínculo MCP inválido.");
		if (!draft.packageId && draft.id.startsWith("extension-mcp:"))
			throw Error("Vínculo MCP inválido.");
		if (draft.packageId) {
			if (!original) {
				if (!binding)
					throw Error(
						"Use a configuração do componente para criar um vínculo MCP.",
					);
				validate.selections([
					{
						packageId: binding.packageId,
						revision: binding.revision,
						componentIds: [binding.componentId],
					},
				]);
				const pkg = await extensionsStore.getPackage(
					binding.packageId,
					binding.revision,
				);
				if (
					binding.packageId !== draft.packageId ||
					extensionMcpId(
						binding.packageId,
						binding.componentId,
						binding.revision,
					) !== draft.id ||
					!pkg.components.some(
						(c) =>
							c.id === binding.componentId &&
							c.kind === "mcp" &&
							c.sources.some((s) => s.effective),
					)
				)
					throw Error("Vínculo MCP inválido.");
			} else if (original.packageId !== draft.packageId)
				throw Error("Vínculo MCP inválido.");
			if (draft.defaults.claude || draft.defaults.codex)
				throw Error("Defina o padrão pelo componente da extensão.");
		}
		await mcpRegistry.saveEditable(draft);
		return true;
	},
	agentMcpRemove: async ({ id }) => {
		validate.text(id);
		await ensureMcpCutover();
		await mcpOAuthService.disconnect(id);
		await mcpRegistry.remove(id);
		return true;
	},
	agentMcpBindingDraft: async ({ packageId, revision, componentId }) => {
		validate.selections([{ packageId, revision, componentIds: [componentId] }]);
		await ensureMcpCutover();
		const pkg = await extensionsStore.getPackage(packageId, revision);
		const c = pkg.components.find(
			(c) => c.id === componentId && c.kind === "mcp",
		);
		if (!c || c.kind !== "mcp" || !c.sources.some((s) => s.effective))
			throw Error("Componente MCP indisponível.");
		const id = extensionMcpId(packageId, componentId, revision);
		const existing = await mcpRegistry.list();
		if (existing.some((s) => s.id === id)) return mcpRegistry.getEditable(id);
		const config = c.definition?.config;
		if (!config) throw Error("Componente MCP inválido.");
		const base = {
			id,
			name: `${`${pkg.name}-${c.name}`.slice(0, 88)}-${id.slice(-12)}`,
			packageId,
			defaults: { claude: false, codex: false },
		};
		// Never export package environment/header literals or references; ask for explicit credentials.
		const draft: McpEditableServer =
			typeof config.command === "string"
				? {
						...base,
						transport: "stdio",
						command: config.command,
						env:
							config.env &&
							typeof config.env === "object" &&
							!Array.isArray(config.env)
								? Object.fromEntries(
										Object.keys(config.env).map((key) => [key, { value: "" }]),
									)
								: undefined,
						args: Array.isArray(config.args)
							? config.args.filter((s): s is string => typeof s === "string")
							: [],
					}
				: {
						...base,
						transport: "http",
						url: typeof config.url === "string" ? config.url : "",
						headers:
							config.headers &&
							typeof config.headers === "object" &&
							!Array.isArray(config.headers)
								? Object.fromEntries(
										Object.keys(config.headers).map((key) => [
											key,
											{ value: "" },
										]),
									)
								: undefined,
						...(typeof config.oauth_resource === "string"
							? { auth: { type: "oauth", resource: config.oauth_resource } }
							: {}),
					};
		return draft;
	},
	agentMcpStatus: async ({ id }) => {
		validate.text(id);
		await ensureMcpCutover();
		return mcpOAuthService.status(id);
	},
	agentMcpConnect: async ({ id }) => {
		validate.text(id);
		await ensureMcpCutover();
		return mcpOAuthService.connect(id);
	},
	agentMcpCancel: async ({ id }) => {
		validate.text(id);
		await mcpOAuthService.cancel(id);
		return true;
	},
	agentMcpDisconnect: async ({ id }) => {
		validate.text(id);
		await mcpOAuthService.disconnect(id);
		return true;
	},
	agentMcpRegistration: async ({ id }) => {
		validate.text(id);
		await ensureMcpCutover();
		return mcpOAuthService.getRegistrationInfo(id);
	},
};
