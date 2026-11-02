import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionSelection } from "@/shared/extensions";
import { findClaudeCli } from "../claude/claude-cli";
import { buildCodexEnv, findCodexCli } from "../codex/codex-cli";
import { mcpRegistry } from "../mcp/registry";
import { ptolemyDataDir } from "../paths";
import { prepareSessionExtensions } from "./activation";
import { extensionMcpId } from "./mcp";
import {
	inventoryClaudeBuiltins,
	inventoryClaudePlugins,
	inventoryCodexHooks,
	inventoryCodexPlugins,
} from "./native";
import { extensionsStore } from "./store";

/** RPC-safe metadata only; never return PreparedSessionExtensions or native definitions. */
export async function extensionInventory(agent: AgentKind, cwd: string) {
	await mkdir(cwd, { recursive: true, mode: 0o700 });
	const installed = await extensionsStore.installed();
	const nativePlugins =
		agent === "claude"
			? await inventoryClaudePlugins(cwd)
			: await inventoryCodexPlugins(
					await findCodexCli(),
					cwd,
					await buildCodexEnv(),
				);
	const builtins =
		agent === "claude"
			? await inventoryClaudeBuiltins(await findClaudeCli())
			: [];
	return {
		installed,
		nativePlugins: nativePlugins.map((plugin) => ({
			...plugin,
			canImport: !!plugin.path,
			...(!plugin.path
				? {
						importLimitation:
							"O CLI não expõe um pacote local exportável para este plugin. Use uma fonte pública da biblioteca quando existir; conectores remotos/proprietários sem pacote não são selecionáveis como componentes locais.",
					}
				: {}),
		})),
		builtins,
		defaults: await extensionsStore.defaults(agent),
		verifiedRuntime: agent === "claude" ? "2.1.118" : "0.166.0",
		...(agent === "codex"
			? {
					commandLimitation:
						"Comandos da interface TUI do Codex não são comandos de codex exec; Skills internas de arquivo continuam no inventário de Skills.",
				}
			: {}),
	};
}
export async function extensionSelectionCapabilities(
	agent: AgentKind,
	selections: ExtensionSelection[],
) {
	const servers = await mcpRegistry.list();
	const prepared = await prepareSessionExtensions(
		"preview",
		join(ptolemyDataDir(), "projects", "extension-preview"),
		selections,
		agent,
		{ materialize: false },
	);
	const selectedHookIds = new Set<string>();
	for (const selection of selections) {
		const pkg = await extensionsStore.getPackage(
			selection.packageId,
			selection.revision,
		);
		for (const c of pkg.components)
			if (c.kind === "hook" && selection.componentIds.includes(c.id))
				selectedHookIds.add(`${pkg.id}:${c.id}`);
	}
	const hookSetupReason =
		agent === "codex" && prepared.hooks.length
			? await codexHookSetupReason()
			: undefined;
	return prepared.capabilities.map((capability) => {
		if (
			hookSetupReason &&
			selectedHookIds.has(`${capability.packageId}:${capability.componentId}`)
		)
			return {
				...capability,
				status: "requires-configuration" as const,
				reason: hookSetupReason,
			};

		const selected = selections.find(
			(s) => s.packageId === capability.packageId,
		)!;
		if (
			capability.status === "requires-configuration" &&
			prepared.mcpComponents.some(
				(c) =>
					c.packageId === capability.packageId &&
					c.componentId === capability.componentId,
			) &&
			servers.some(
				(s) =>
					s.id ===
						extensionMcpId(
							selected.packageId,
							capability.componentId,
							selected.revision,
						) && s.packageId === selected.packageId,
			)
		)
			return {
				...capability,
				status: "adapted" as const,
				reason:
					"Configurado no registro MCP compartilhado; conexão não testada.",
			};
		return capability;
	});
}
export async function codexHookSetupReason(): Promise<string | undefined> {
	try {
		const cwd = join(ptolemyDataDir(), "projects");
		await mkdir(cwd, { recursive: true, mode: 0o700 });
		const hooks = await inventoryCodexHooks(
			await findCodexCli(),
			cwd,
			await buildCodexEnv(),
		);
		if (hooks.some((h) => h.enabled && h.managed))
			return "Hook obrigatório por política externa impede uma seleção isolada nesta conversa.";
	} catch (error) {
		return error instanceof Error
			? error.message
			: "Não foi possível verificar hooks do Codex.";
	}
}

/** Resolve path from a fresh backend inventory; never accept a renderer-supplied filesystem path. */
export async function importNativeExtension(
	agent: AgentKind,
	id: string,
	cwd: string,
) {
	const inventory =
		agent === "claude"
			? await inventoryClaudePlugins(cwd)
			: await inventoryCodexPlugins(
					await findCodexCli(),
					cwd,
					await buildCodexEnv(),
				);
	const plugin = inventory.find((p) => p.id === id);
	if (!plugin) throw Error("Plugin não encontrado no inventário atual do CLI.");
	return extensionsStore.importNative(agent, plugin);
}
