import { homedir } from "node:os";
import { join } from "node:path";

let cachedClaudePath: string | null = null;

export async function findClaudeCli(): Promise<string> {
	// Explicit override for unusual installs (and the integration tests).
	const override = process.env.PTOLEMY_CLAUDE_PATH;
	if (override) return override;
	if (cachedClaudePath) return cachedClaudePath;
	const fromPath = Bun.which("claude");
	if (fromPath) {
		cachedClaudePath = fromPath;
		return fromPath;
	}
	const home = homedir();
	const candidates = [
		join(home, ".local", "bin", "claude"),
		join(home, ".claude", "bin", "claude"),
		"/usr/local/bin/claude",
	];
	for (const candidate of candidates) {
		const file = Bun.file(candidate);
		if (await file.exists()) {
			cachedClaudePath = candidate;
			return candidate;
		}
	}
	throw new Error(
		"Claude Code CLI não encontrado. Instale com: npm install -g @anthropic-ai/claude-code",
	);
}
