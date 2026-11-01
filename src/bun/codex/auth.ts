import { runOsascriptTerminal } from "../claude/auth";
import { buildCodexEnv, detectCodexCli } from "./codex-cli";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodexCliStatus =
	| "not-installed"
	| "not-authenticated"
	| "authenticated";

export interface CodexAuthStatus {
	cliStatus: CodexCliStatus;
	/** How the CLI is signed in, when it says so. */
	method?: "chatgpt" | "api-key";
	/** Resolved CLI path, shown in settings for troubleshooting. */
	cliPath?: string;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const STATUS_TIMEOUT_MS = 10_000;

/**
 * Interprets `codex login status`. The CLI exits 0 and prints
 * "Logged in using ChatGPT" / "Logged in using an API key" when signed in,
 * and exits non-zero with "Not logged in" otherwise. The text may land on
 * stdout or stderr depending on the CLI version, so callers pass both.
 */
export function parseLoginStatus(
	exitCode: number,
	output: string,
): Pick<CodexAuthStatus, "cliStatus" | "method"> {
	const text = output.toLowerCase();
	if (exitCode !== 0 || text.includes("not logged in")) {
		return { cliStatus: "not-authenticated" };
	}
	if (text.includes("chatgpt")) {
		return { cliStatus: "authenticated", method: "chatgpt" };
	}
	if (text.includes("api key")) {
		return { cliStatus: "authenticated", method: "api-key" };
	}
	return { cliStatus: "authenticated" };
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
	const cli = await detectCodexCli();
	if (!cli.installed || !cli.path) return { cliStatus: "not-installed" };

	try {
		const proc = Bun.spawn([cli.path, "login", "status"], {
			stdout: "pipe",
			stderr: "pipe",
			env: await buildCodexEnv(),
		});
		const timer = setTimeout(() => proc.kill(), STATUS_TIMEOUT_MS);
		const [code, out, err] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		clearTimeout(timer);
		return { ...parseLoginStatus(code, `${out}\n${err}`), cliPath: cli.path };
	} catch (err) {
		console.error("[codex:auth] login status failed:", err);
		return { cliStatus: "not-authenticated", cliPath: cli.path };
	}
}

// ---------------------------------------------------------------------------
// Install / login (delegated to Terminal, like the Claude flow)
// ---------------------------------------------------------------------------

export async function installCodexCli(): Promise<{
	ok: boolean;
	error?: string;
}> {
	return runOsascriptTerminal("npm install -g @openai/codex");
}

export async function openCodexLogin(): Promise<{
	ok: boolean;
	error?: string;
}> {
	return runOsascriptTerminal("codex login");
}
