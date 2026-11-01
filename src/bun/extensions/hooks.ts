import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	HookInput,
	SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
	executeHookSequence,
	executeRestricted,
	hookOutput,
} from "./extension-executor.mjs";

export { hookOutput };
export interface RestrictedExecution {
	cwd: string;
	root: string;
	data: string;
	command: string;
	timeout: number;
	event?: string;
}
export interface PreparedHook extends RestrictedExecution {
	event: string;
	matcher?: string;
}
export const shellQuote = (value: string) =>
	`'${value.replace(/'/g, "'\\''")}'`;
export function extensionLauncherPaths(execPath = process.execPath): {
	executable: string;
	launcher: string;
} {
	const bundled = join(
		dirname(execPath),
		"..",
		"Resources",
		"app",
		"native",
		"extension-launcher.mjs",
	);
	const source = fileURLToPath(new URL("./launcher.mjs", import.meta.url));
	const bun = join(dirname(execPath), "bun");
	if (existsSync(bundled) && existsSync(bun))
		return { executable: bun, launcher: bundled };
	if (execPath === process.execPath && existsSync(source))
		return { executable: execPath, launcher: source };
	throw Error("Executor de extensões ausente no aplicativo.");
}
export function restrictedCommand(
	spec: RestrictedExecution | PreparedHook[],
): string {
	const { executable, launcher } = extensionLauncherPaths();
	return [
		executable,
		launcher,
		Buffer.from(JSON.stringify(spec)).toString("base64url"),
	]
		.map(shellQuote)
		.join(" ");
}
export async function runExtensionHook(
	hook: PreparedHook,
	input: HookInput | Record<string, unknown>,
	signal?: AbortSignal,
): Promise<SyncHookJSONOutput> {
	try {
		const result = await executeRestricted(hook, JSON.stringify(input), signal);
		if (result.code !== 0) throw Error();
		return hookOutput(hook.event, result.stdout);
	} catch {
		if (hook.event === "PreToolUse")
			return {
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason:
						"Hook da extensão falhou ou bloqueou a operação.",
				},
			};
		return {
			continue: false,
			stopReason: "Hook da extensão falhou ou bloqueou a operação.",
		};
	}
}
export async function runExtensionHookSequence(
	hooks: PreparedHook[],
	input: HookInput,
	signal?: AbortSignal,
): Promise<SyncHookJSONOutput> {
	try {
		return await executeHookSequence(hooks, JSON.stringify(input), signal);
	} catch {
		return hooks[0]?.event === "PreToolUse"
			? {
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						permissionDecision: "deny",
						permissionDecisionReason:
							"Hook da extensão falhou ou bloqueou a operação.",
					},
				}
			: {
					continue: false,
					stopReason: "Hook da extensão falhou ou bloqueou a operação.",
				};
	}
}
function sorted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sorted);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, sorted(v)]),
		);
	return value;
}
export const toToml = (value: unknown): string =>
	Array.isArray(value)
		? `[${value.map(toToml).join(",")}]`
		: value && typeof value === "object"
			? `{${Object.entries(value)
					.map(([k, v]) => `${JSON.stringify(k)}=${toToml(v)}`)
					.join(",")}}`
			: JSON.stringify(value);
/** A single ordered group per event; individual trust is derived only after revision consent. */
export function codexHookOverrides(
	hooks: PreparedHook[],
	disabledKeys: string[] = [],
): string[] {
	const groups: Record<string, unknown[]> = {};
	const state: Record<string, unknown> = Object.fromEntries(
		disabledKeys.map((key) => [key, { enabled: false }]),
	);
	for (const eventName of new Set(hooks.map((h) => h.event))) {
		const sequence = hooks.filter((h) => h.event === eventName);
		const event = eventName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
		const group = {
			hooks: [
				{
					type: "command",
					command: restrictedCommand(sequence),
					timeout: Math.min(
						eventName === "SessionEnd" ? 3 : Infinity,
						sequence.reduce((n, h) => n + h.timeout, 0) + 2,
					),
					async: false,
				},
			],
		};
		groups[eventName] = [group];
		const index = 0;
		const digest =
			"sha256:" +
			createHash("sha256")
				.update(JSON.stringify(sorted({ event_name: event, ...group })))
				.digest("hex");
		state[`/<session-flags>/config.toml:${event}:${index}:0`] = {
			trusted_hash: digest,
		};
	}
	return [
		"features.hooks=true",
		...Object.entries(groups).map(
			([event, groups]) => `hooks.${event}=${toToml(groups)}`,
		),
		`hooks.state=${toToml(state)}`,
	];
}
