import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { toToml } from "./hooks";

export { inventoryCodexHooks } from "./codex-hook-inventory";
export interface NativePlugin {
	id: string;
	name: string;
	enabled: boolean;
	path?: string;
	managed: boolean;
}
export interface NativeHook {
	source?: string;
	key: string;
	enabled: boolean;
	managed: boolean;
}
export interface BuiltinCommand {
	id: string;
	name: string;
	description: string;
	kind: "skill" | "command";
	origin: "builtin";
	limitation: string;
}
export function parseCodexPlugins(value: unknown): NativePlugin[] {
	const entries = (value as { installed?: unknown[] })?.installed;
	if (!Array.isArray(entries))
		throw Error("Inventário de plugins Codex inválido.");
	return entries
		.filter(
			(p): p is Record<string, unknown> =>
				!!p &&
				typeof p === "object" &&
				(p as { installed?: boolean }).installed === true,
		)
		.map((p) => {
			if (
				typeof p.pluginId !== "string" ||
				typeof p.name !== "string" ||
				typeof p.enabled !== "boolean"
			)
				throw Error("Inventário de plugins Codex inválido.");
			const source = p.source as { path?: string; source?: string } | undefined;
			return {
				id: p.pluginId,
				name: p.name,
				enabled: p.enabled,
				path:
					source?.source === "local" && typeof source.path === "string"
						? source.path
						: undefined,
				managed: p.installPolicy === "REQUIRED",
			};
		});
}
export async function inventoryCodexPlugins(
	cli: string,
	cwd: string,
	env: Record<string, string>,
): Promise<NativePlugin[]> {
	try {
		const { stdout } = await promisify(execFile)(
			"/usr/bin/sandbox-exec",
			[
				"-p",
				"(version 1)(allow default)(deny network*)(deny file-write*)",
				cli,
				"plugin",
				"list",
				"--json",
			],
			{ cwd, env, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
		);
		return parseCodexPlugins(JSON.parse(stdout));
	} catch {
		throw Error("Não foi possível verificar os plugins herdados do Codex.");
	}
}
export function suppressCodexPlugins(plugins: NativePlugin[]): string {
	if (plugins.some((p) => p.enabled && p.managed))
		throw Error(
			"Plugin obrigatório por política externa não pode ser desabilitado nesta seleção.",
		);
	return `plugins=${toToml(Object.fromEntries([["_default", { enabled: false }], ...plugins.map((p) => [p.id, { enabled: false }])]))}`;
}
async function jsonOptional(path: string): Promise<Record<string, unknown>> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw Error("Inventário de plugins Claude inválido.");
	}
}
/** Metadata-only discovery cannot run global SessionStart hooks. Cached files alone never imply enablement. */
export async function inventoryClaudePlugins(
	cwd?: string,
	configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
): Promise<NativePlugin[]> {
	const installed = await jsonOptional(
		join(configDir, "plugins", "installed_plugins.json"),
	);
	const settings = [await jsonOptional(join(configDir, "settings.json"))];
	if (cwd)
		settings.push(
			await jsonOptional(join(cwd, ".claude", "settings.json")),
			await jsonOptional(join(cwd, ".claude", "settings.local.json")),
		);
	const enabled = Object.assign(
		{},
		...settings.map((s) => s.enabledPlugins ?? {}),
	) as Record<string, boolean>;
	const plugins = (installed.plugins ?? {}) as Record<
		string,
		Array<{ installPath?: string; scope?: string; projectPath?: string }>
	>;
	return Object.entries(plugins).flatMap(([id, records]) => {
		if (!Array.isArray(records))
			throw Error("Inventário de plugins Claude inválido.");
		const applicable = records.filter(
			(r) =>
				(r.scope !== "project" && r.scope !== "local") || r.projectPath === cwd,
		);
		const record = applicable.at(-1);
		return record
			? [
					{
						id,
						name: id.split("@")[0],
						enabled: enabled[id] === true,
						path: record.installPath,
						managed: false,
					},
				]
			: [];
	});
}
export async function inventoryClaudeBuiltins(
	cli: string,
): Promise<BuiltinCommand[]> {
	const config = await mkdtemp(join(tmpdir(), "ptolemy-cli-inventory-"));
	const { query } = await import("@anthropic-ai/claude-agent-sdk");
	// /clear is a local command: it emits init.skills without a model request.
	// The disposable config and disabled hooks prevent inventory from activating globals.
	const q = query({
		prompt: "/clear",
		options: {
			cwd: config,
			pathToClaudeCodeExecutable: cli,
			env: {
				...process.env,
				CLAUDE_CONFIG_DIR: config,
				CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			},
			settingSources: [],
			strictMcpConfig: true,
			mcpServers: {},
			managedSettings: {
				disableAllHooks: true,
				strictPluginOnlyCustomization: true,
			},
		},
	});
	const timeout = setTimeout(() => q.close(), 15000);
	try {
		const commands = await q.supportedCommands();
		const skills = new Set<string>();
		for await (const message of q)
			if (message.type === "system" && message.subtype === "init")
				for (const name of message.skills) skills.add(name);
		return commands.map((c) => ({
			id: `builtin:claude:${c.name}`,
			name: c.name,
			description: c.description,
			kind: skills.has(c.name) ? "skill" : "command",
			origin: "builtin",
			limitation:
				"Execução e pedidos /comando são controlados; o runtime pode manter a descrição no contexto.",
		}));
	} catch {
		throw Error("Não foi possível inventariar os comandos internos do Claude.");
	} finally {
		clearTimeout(timeout);
		q.close();
		await rm(config, { recursive: true, force: true });
	}
}
export function refreshClaudeBuiltinSelection(
	saved: { all: string[]; selected: string[] },
	currentNames: string[],
): { all: string[]; selected: string[] } {
	return {
		all: [...new Set([...saved.all, ...currentNames])],
		selected: [...saved.selected],
	};
}
export function claudeBuiltinControls(
	all: string[],
	selected: string[],
	hasFileSkills: boolean,
): Pick<Options, "disallowedTools" | "extraArgs"> {
	if (!selected.length && !hasFileSkills)
		return {
			disallowedTools: ["Skill"],
			extraArgs: { "disable-slash-commands": null },
		};
	return {
		disallowedTools: all
			.filter((name) => !selected.includes(name))
			.map((name) => `Skill(${name})`),
	};
}
export function denyUnselectedSlash(
	prompt: string,
	all: string[],
	selected: string[],
): void {
	const name = prompt.trimStart().match(/^\/([^\s]+)/)?.[1];
	if (name && all.includes(name) && !selected.includes(name))
		throw Error("Este comando interno está desabilitado nesta conversa.");
}
