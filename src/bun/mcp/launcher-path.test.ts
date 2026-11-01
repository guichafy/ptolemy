import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { mcpLauncherPaths } from "./launcher-path";

test("never substitutes an agent-writable cwd launcher for a missing shipped launcher", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-launcher-path-"));
	try {
		const bin = join(root, "Example.app/Contents/MacOS");
		const workspace = join(root, "workspace");
		await mkdir(bin, { recursive: true });
		await writeFile(join(bin, "bun"), "test");
		await mkdir(join(workspace, "native"), { recursive: true });
		await writeFile(join(workspace, "native/mcp-launcher.mjs"), "untrusted");
		expect(() => mcpLauncherPaths(join(bin, "bun"), workspace)).toThrow(
			"Inicializador MCP indisponível",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
