import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HookEvent, Options } from "@anthropic-ai/claude-agent-sdk";
import { ptolemyDataDir } from "../paths";
import type { PreparedSessionExtensions } from "./activation";
import { claudeAgent } from "./agents";
import { COMMON_HOOK_EVENTS } from "./capabilities";
import { resolveExtensionCommand } from "./commands";
import { buildExtensionEnvironment } from "./execution-environment";
import { executeRestricted } from "./extension-executor.mjs";
import { codexHookOverrides, runExtensionHookSequence, toToml } from "./hooks";
import {
	claudeBuiltinControls,
	inventoryClaudePlugins,
	inventoryCodexHooks,
	inventoryCodexPlugins,
	suppressCodexPlugins,
} from "./native";
export async function resolveExtensionPrompt(
	prepared: PreparedSessionExtensions,
	prompt: string,
	cwd: string,
	readOnly = false,
	signal?: AbortSignal,
): Promise<string> {
	const match = prompt.trimStart().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	const command = match && prepared.commands.find((c) => c.name === match[1]);
	if (!command) return prompt;
	signal?.throwIfAborted();
	const environment = await buildExtensionEnvironment();
	signal?.throwIfAborted();
	return resolveExtensionCommand(
		command,
		{ arguments: match?.[2] },
		async (script, variables, args) => {
			const result = await executeRestricted(
				{
					cwd,
					root: command.root,
					data: command.data ?? cwd,
					command: script,
					timeout: 60,
					variables,
					args,
					readOnly,
				},
				"",
				signal,
				environment,
			);
			if (result.code !== 0)
				throw Error("Expansão dinâmica do comando falhou.");
			return result.stdout;
		},
		signal,
	);
}

export async function claudeExtensionOptions(
	prepared: PreparedSessionExtensions,
	builtins?: { all: string[]; selected: string[]; hasFileSkills: boolean },
): Promise<Options> {
	if (!prepared.explicit) return {};
	const hooks: NonNullable<Options["hooks"]> = {};
	// One callback per event preserves source ordering (native matcher callbacks run in parallel).
	for (const event of new Set(prepared.hooks.map((h) => h.event))) {
		const sequence = prepared.hooks.filter((h) => h.event === event);
		hooks[event as HookEvent] = [
			{
				timeout: sequence.reduce((n, h) => n + h.timeout, 0) + 2,
				hooks: [
					async (input, _id, { signal }) =>
						runExtensionHookSequence(
							sequence,
							input,
							signal,
							await buildExtensionEnvironment(),
						),
				],
			},
		];
	}
	const plugins = await inventoryClaudePlugins();
	return {
		settingSources: [],
		settings: {
			enabledPlugins: Object.fromEntries(plugins.map((p) => [p.id, false])),
		},
		managedSettings: {
			strictPluginOnlyCustomization: ["skills", "agents", "hooks", "mcp"],
		},
		hooks,
		agents: Object.fromEntries(
			prepared.agents.map((a) => [a.name, claudeAgent(a)]),
		),
		plugins: prepared.claudePlugins.map((path) => ({ type: "local", path })),
		...(builtins
			? claudeBuiltinControls(
					builtins.all,
					builtins.selected,
					builtins.hasFileSkills || prepared.skills.length > 0,
				)
			: {}),
	};
}
export async function codexExtensionOverrides(
	prepared: PreparedSessionExtensions,
	cli: string,
	cwd: string,
	env: Record<string, string>,
	sessionId: string,
	readOnly = false,
): Promise<string[]> {
	if (!prepared.explicit) return [];
	const disabled = suppressCodexPlugins(
		await inventoryCodexPlugins(cli, cwd, env),
	);
	const inheritedHooks = prepared.hooks.length
		? await inventoryCodexHooks(cli, cwd, env)
		: [];
	if (inheritedHooks.some((h) => h.enabled && h.managed))
		throw Error(
			"Hook obrigatório por política externa impede uma seleção isolada nesta conversa.",
		);
	const result = [
		disabled,
		"sandbox_workspace_write.exclude_tmpdir_env_var=true",
		"sandbox_workspace_write.exclude_slash_tmp=true",
		...COMMON_HOOK_EVENTS.map((e) => `hooks.${e}=[]`),
		...(prepared.hooks.length
			? codexHookOverrides(
					prepared.hooks.map((h) => ({ ...h, readOnly })),
					inheritedHooks.map((h) => h.key),
				)
			: ["features.hooks=false"]),
	];
	if (prepared.agents.length) {
		const roles: Record<string, unknown> = { enabled: true };
		const directory = join(
			ptolemyDataDir(),
			"extensions",
			"runtime",
			sessionId,
		);
		await mkdir(directory, { recursive: true });
		for (const agent of prepared.agents) {
			const path = join(directory, `${agent.name}.toml`);
			// Backend-owned config outside the writable project; no native permission fields from packages.
			await writeFile(
				path,
				`developer_instructions=${JSON.stringify(agent.prompt)}\n${typeof agent.metadata.model === "string" ? `model=${JSON.stringify(agent.metadata.model)}\n` : ""}`,
				{ mode: 0o600 },
			);
			roles[agent.name] = {
				description: String(agent.metadata.description ?? agent.name),
				config_file: path,
			};
		}
		result.push(`agents=${toToml(roles)}`);
	}
	return result;
}
