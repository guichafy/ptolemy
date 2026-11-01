// Shipped, trusted launcher. Never load executable policy from the workspace.
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";

export function hookOutput(event, text) {
	if (!text.trim()) return {};
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw Error("Saída JSON do hook inválida.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Saída JSON do hook inválida.");
	const result = {};
	for (const key of [
		"continue",
		"stopReason",
		"suppressOutput",
		"systemMessage",
		"reason",
	]) {
		if (value[key] !== undefined) result[key] = value[key];
	}
	if (value.decision === "block") result.decision = "block";
	const specific = value.hookSpecificOutput;
	if (specific && typeof specific === "object") {
		result.hookSpecificOutput = { hookEventName: event };
		for (const key of ["additionalContext", "permissionDecisionReason"])
			if (typeof specific[key] === "string")
				result.hookSpecificOutput[key] = specific[key];
		// Hooks may deny, never authorize tools or replace the input checked by the jail.
		if (
			event === "PreToolUse" &&
			(specific.permissionDecision === "deny" ||
				specific.permissionDecision === "ask" ||
				specific.updatedInput !== undefined)
		)
			result.hookSpecificOutput.permissionDecision = "deny";
	}
	return result;
}

/** Native matcher groups run concurrently; a wrapper preserves authored order. */
export async function executeHookSequence(hooks, input, signal) {
	const value = JSON.parse(input);
	let context = "";
	let systemMessage = "";
	let suppressOutput = false;
	for (const hook of hooks) {
		const target =
			value.tool_name ??
			value.source ??
			value.agent_type ??
			value.trigger ??
			value.reason ??
			"";
		if (
			hook.matcher &&
			hook.matcher !== "*" &&
			!new RegExp(hook.matcher).test(String(target))
		)
			continue;
		const result = await executeRestricted(hook, input, signal);
		if (result.code !== 0) throw Error("Hook bloqueou a operação.");
		const output = hookOutput(hook.event, result.stdout);
		if (
			output.continue === false ||
			output.decision === "block" ||
			output.hookSpecificOutput?.permissionDecision === "deny"
		)
			return output;
		if (output.hookSpecificOutput?.additionalContext)
			context += `${output.hookSpecificOutput.additionalContext}\n`;
		if (output.suppressOutput === true) suppressOutput = true;
		if (output.systemMessage) systemMessage += `${output.systemMessage}\n`;
	}
	return {
		...(context
			? {
					hookSpecificOutput: {
						hookEventName: hooks[0].event,
						additionalContext: context,
					},
				}
			: {}),
		...(systemMessage ? { systemMessage } : {}),
		...(suppressOutput ? { suppressOutput: true } : {}),
	};
}

export async function executeRestricted(spec, input = "", signal) {
	const cwd = await realpath(spec.cwd);
	const policy = `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(cwd)}))(allow file-write-data (literal "/dev/null"))`;
	const env = {};
	for (const key of ["PATH", "LANG", "LC_ALL", "TZ"])
		if (process.env[key]) env[key] = process.env[key];
	// No inherited model/MCP/OAuth secrets. Plugin paths are session-local.
	Object.assign(env, {
		CLAUDE_PLUGIN_ROOT: spec.root,
		PLUGIN_ROOT: spec.root,
		CLAUDE_PLUGIN_DATA: spec.data,
		PLUGIN_DATA: spec.data,
	});
	for (const [key, value] of Object.entries(spec.variables ?? {})) {
		if (
			!/^[A-Z][A-Z0-9_]*$/.test(key) ||
			/^(?:HOME|PATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|LD_|DYLD_|CLAUDE_|PLUGIN_)/.test(
				key,
			)
		)
			throw Error("Nome de argumento reservado.");
		env[key] = value;
	}
	return await new Promise((resolve, reject) => {
		const child = spawn(
			"/usr/bin/sandbox-exec",
			[
				"-p",
				policy,
				"/bin/sh",
				"-c",
				spec.command,
				"ptolemy-extension",
				...(spec.args ?? []),
			],
			{ cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "",
			size = 0,
			failed = false;
		const kill = () => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};
		const fail = () => {
			failed = true;
			kill();
		};
		const timer = setTimeout(
			fail,
			Math.min(600000, Math.max(1, spec.timeout * 1000)),
		);
		signal?.addEventListener("abort", fail, { once: true });
		if (signal?.aborted) fail();
		child.stdout.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1024 * 1024) fail();
			else stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1024 * 1024) fail();
		});
		child.stdin.on("error", () => {});
		child.stdin.end(input);
		child.on("error", () => {
			failed = true;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", fail);
			kill();
			if (failed)
				reject(
					Error("Hook excedeu o prazo, foi cancelado ou não pôde executar."),
				);
			else resolve({ stdout, code: code ?? 1 });
		});
	});
}
