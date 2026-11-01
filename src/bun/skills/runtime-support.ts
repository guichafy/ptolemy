import type { AgentKind } from "@/shared/agent-protocol";

async function readCliVersion(
	path: string,
	env?: Record<string, string>,
): Promise<string> {
	const proc = Bun.spawn([path, "--version"], {
		stdout: "pipe",
		stderr: "ignore",
		timeout: 5000,
		env,
	});
	const [output, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error("CLI não respondeu à consulta de versão.");
	return output;
}

/** Fail closed rather than silently rediscover native Skills on older CLIs. */
export async function assertSkillSelectionSupport(
	agent: AgentKind,
	path: string,
	readVersion?: (path: string) => Promise<string>,
	env?: Record<string, string>,
): Promise<void> {
	const minimum = agent === "claude" ? [2, 1, 118] : [0, 166, 0];
	const error = `Atualize ${agent === "claude" ? "Claude Code" : "Codex"} para ${minimum.join(".")} ou superior para controlar a seleção de Skills desta conversa.`;
	let version: string;
	try {
		version = await (readVersion
			? readVersion(path)
			: readCliVersion(path, env));
	} catch {
		throw new Error(error);
	}
	const match = version.match(/\b(\d+)\.(\d+)\.(\d+)/);
	if (!match) throw new Error(error);
	const parts = match.slice(1, 4).map(Number);
	for (let i = 0; i < minimum.length; i++) {
		if (parts[i] > minimum[i]) return;
		if (parts[i] < minimum[i]) throw new Error(error);
	}
}
