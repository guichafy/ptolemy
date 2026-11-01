import { mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "../atomic-json";
import { ptolemyDataDir } from "../paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaudeCliStatus =
	| "not-installed"
	| "not-authenticated"
	| "authenticated";

export interface ClaudeAuthStatus {
	mode: "anthropic" | "bedrock" | "none";
	anthropic?: { cliStatus: ClaudeCliStatus };
	bedrock?: { endpoint: string; profile: string; region: string };
}

export interface BedrockConfig {
	endpoint: string;
	profile: string;
	region: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const AUTH_DIR = join(ptolemyDataDir(), "auth");
const BEDROCK_PATH = join(AUTH_DIR, "bedrock.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureAuthDir(): Promise<void> {
	await mkdir(AUTH_DIR, { recursive: true });
}

function isBedrockConfig(value: unknown): value is BedrockConfig {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.endpoint === "string" &&
		!!v.endpoint &&
		typeof v.profile === "string" &&
		!!v.profile &&
		typeof v.region === "string" &&
		!!v.region
	);
}

// ---------------------------------------------------------------------------
// CLI / Keychain detection
// ---------------------------------------------------------------------------

export interface ClaudeCliInfo {
	installed: boolean;
	path?: string;
}

const FALLBACK_CLI_PATHS = [
	join(homedir(), ".local/bin/claude"),
	"/usr/local/bin/claude",
	"/opt/homebrew/bin/claude",
];

export async function detectClaudeCli(): Promise<ClaudeCliInfo> {
	try {
		const proc = Bun.spawn(["/bin/zsh", "-lc", "command -v claude"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, out] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
		]);
		if (code === 0) {
			const trimmed = out.trim();
			if (trimmed) return { installed: true, path: trimmed };
		}
	} catch {
		// fall through to path probe
	}
	for (const p of FALLBACK_CLI_PATHS) {
		if (await Bun.file(p).exists()) return { installed: true, path: p };
	}
	return { installed: false };
}

export async function detectClaudeCodeKeychain(): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			[
				"security",
				"find-generic-password",
				"-s",
				"Claude Code-credentials",
				"-a",
				userInfo().username,
			],
			{ stdout: "ignore", stderr: "ignore" },
		);
		return (await proc.exited) === 0;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current authentication status by detecting the Claude CLI and
 * checking the system keychain for Claude Code credentials.
 */
export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
	const [cli, bedrockConfig] = await Promise.all([
		detectClaudeCli(),
		getBedrockConfig(),
	]);

	let cliStatus: ClaudeCliStatus;
	if (!cli.installed) cliStatus = "not-installed";
	else if (await detectClaudeCodeKeychain()) cliStatus = "authenticated";
	else cliStatus = "not-authenticated";

	let mode: ClaudeAuthStatus["mode"];
	if (cliStatus === "authenticated") mode = "anthropic";
	else if (bedrockConfig) mode = "bedrock";
	else mode = "none";

	return {
		mode,
		anthropic: { cliStatus },
		...(bedrockConfig
			? {
					bedrock: {
						endpoint: bedrockConfig.endpoint,
						profile: bedrockConfig.profile,
						region: bedrockConfig.region,
					},
				}
			: {}),
	};
}

/** Runs `command` in a new Terminal window (shared with the Codex flow). */
export async function runOsascriptTerminal(
	command: string,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const proc = Bun.spawn(
			[
				"osascript",
				"-e",
				`tell application "Terminal" to do script "${command}"`,
				"-e",
				`tell application "Terminal" to activate`,
			],
			{ stdout: "ignore", stderr: "ignore" },
		);
		const code = await proc.exited;
		if (code !== 0) {
			console.error(`[auth] osascript exited ${code}`);
			return { ok: false, error: "Falha ao abrir o Terminal" };
		}
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Erro desconhecido",
		};
	}
}

export async function installClaudeCli(): Promise<{
	ok: boolean;
	error?: string;
}> {
	return runOsascriptTerminal("curl -fsSL https://claude.ai/install.sh | bash");
}

export async function openClaudeLogin(): Promise<{
	ok: boolean;
	error?: string;
}> {
	return runOsascriptTerminal("claude /login");
}

/**
 * Reads the Bedrock configuration from `~/.ptolomeu/auth/bedrock.json`.
 * Returns `null` if the file doesn't exist or contains invalid data.
 */
export async function getBedrockConfig(): Promise<BedrockConfig | null> {
	const file = Bun.file(BEDROCK_PATH);
	if (!(await file.exists())) return null;
	try {
		const parsed = JSON.parse(await file.text());
		return isBedrockConfig(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Saves the Bedrock configuration to `~/.ptolomeu/auth/bedrock.json`.
 */
export async function setBedrockConfig(
	config: BedrockConfig,
): Promise<boolean> {
	if (!isBedrockConfig(config)) return false;
	try {
		const data: BedrockConfig = {
			endpoint: config.endpoint.trim(),
			profile: config.profile.trim(),
			region: config.region.trim(),
		};
		await ensureAuthDir();
		await writeJsonAtomic(BEDROCK_PATH, data);
		return true;
	} catch {
		return false;
	}
}
