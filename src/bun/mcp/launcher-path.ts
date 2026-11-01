import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Electrobun ships bin/bun next to its launcher; no globally installed Bun needed. */
export function mcpLauncherPaths(
	execPath = process.execPath,
	_cwd = process.cwd(),
) {
	const bin = dirname(execPath);
	const bundled = join(
		bin,
		"..",
		"Resources",
		"app",
		"native",
		"mcp-launcher.mjs",
	);
	const bun = join(bin, "bun");
	if (existsSync(bundled) && existsSync(bun))
		return { command: bun, args: [resolve(bundled)] };

	const script = fileURLToPath(new URL("./launcher.mjs", import.meta.url));
	// Only Bun dev execution may use its own executable. Never run a global lookup.
	if (
		process.versions.bun &&
		execPath === process.execPath &&
		existsSync(script)
	)
		return { command: execPath, args: [script] };
	throw Error("Inicializador MCP indisponível.");
}
