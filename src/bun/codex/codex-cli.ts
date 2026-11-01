import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Locates the user's Codex CLI and the login-shell PATH it needs.
 *
 * Ptolemy runs as a menu bar app, so it inherits launchd's minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), not the user's shell PATH. That breaks
 * Codex twice over: `codex` itself usually lives in Homebrew, npm or bun
 * prefixes, and the npm-installed `codex` is a `#!/usr/bin/env node` script
 * that needs `node` on PATH. Both are resolved through a login shell once and
 * cached for the lifetime of the process.
 */

export interface CodexCliInfo {
	installed: boolean;
	path?: string;
}

const FALLBACK_CLI_PATHS = [
	join(homedir(), ".local", "bin", "codex"),
	join(homedir(), ".bun", "bin", "codex"),
	join(homedir(), ".npm-global", "bin", "codex"),
	"/opt/homebrew/bin/codex",
	"/usr/local/bin/codex",
];

let cachedCliPath: string | null = null;
let cachedLoginPath: string | null = null;

async function runLoginShell(script: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["/bin/zsh", "-lc", script], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const [code, out] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
		]);
		if (code !== 0) return null;
		const trimmed = out.trim();
		return trimmed || null;
	} catch {
		return null;
	}
}

export async function detectCodexCli(): Promise<CodexCliInfo> {
	if (cachedCliPath && (await Bun.file(cachedCliPath).exists())) {
		return { installed: true, path: cachedCliPath };
	}
	cachedCliPath = null;
	const fromShell = await runLoginShell("command -v codex");
	// `command -v` prints the name itself for aliases/functions; keep only paths.
	if (fromShell?.startsWith("/")) {
		cachedCliPath = fromShell;
		return { installed: true, path: fromShell };
	}
	for (const candidate of FALLBACK_CLI_PATHS) {
		if (await Bun.file(candidate).exists()) {
			cachedCliPath = candidate;
			return { installed: true, path: candidate };
		}
	}
	return { installed: false };
}

export async function findCodexCli(): Promise<string> {
	const info = await detectCodexCli();
	if (info.installed && info.path) return info.path;
	throw new Error(
		"Codex CLI não encontrado. Instale com: npm install -g @openai/codex",
	);
}

/**
 * PATH from the user's login shell, merged with the current process PATH so
 * nothing the app already relies on is lost. Falls back to the process PATH.
 */
export async function getLoginShellPath(): Promise<string> {
	if (cachedLoginPath) return cachedLoginPath;
	const current = process.env.PATH ?? "";
	const fromShell = await runLoginShell('printf %s "$PATH"');
	const merged = mergePathLists(fromShell ?? "", current);
	cachedLoginPath = merged;
	return merged;
}

export function mergePathLists(...lists: string[]): string {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const list of lists) {
		for (const entry of list.split(":")) {
			if (!entry || seen.has(entry)) continue;
			seen.add(entry);
			out.push(entry);
		}
	}
	return out.join(":");
}

/**
 * Environment for the Codex subprocess. Built per turn from the live
 * `process.env`, so proxy changes applied by `initProxy` (which mutates
 * `process.env`) reach the next turn without restarting the app.
 */
export async function buildCodexEnv(): Promise<Record<string, string>> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") env[key] = value;
	}
	env.PATH = await getLoginShellPath();
	return env;
}

/** Test hook: forget cached lookups. */
export function resetCodexCliCache(): void {
	cachedCliPath = null;
	cachedLoginPath = null;
}
