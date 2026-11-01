import { expect, test } from "bun:test";
import { join } from "node:path";

test("both real offline CLIs call selected MCP via the shared runtime without external credentials in argv", async () => {
	const proc = Bun.spawn(
		[process.execPath, join(import.meta.dir, "helpers/mcp-scenario.ts")],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PTOLEMY_IT_MODE: "local" },
		},
	);
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (code !== 0)
		throw Error(`MCP integration failed (${code}):\n${out}\n${err}`);
	expect(out).toContain(
		"MCP actual calls: claude,codex; none and inherited suppression; native isolation; OAuth refresh",
	);
}, 120_000);
