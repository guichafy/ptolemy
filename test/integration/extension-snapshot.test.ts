import { expect, test } from "bun:test";

test("removed catalog packages and package-owned MCP retain frozen behavior through agent switching", async () => {
	const child = Bun.spawn(
		[process.execPath, "test/integration/helpers/extension-snapshot.ts"],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PTOLEMY_IT_MODE: "local" },
		},
	);
	const [output, error, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw Error(`${output}\n${error}`);
	expect(output).toContain("PACKAGE_SNAPSHOT_RESUME_OK");
}, 120000);
