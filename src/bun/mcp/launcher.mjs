/** Shipped backend-only stdio launcher. Never invoked by the agent CLI.
 * Per-server configuration travels in this child's environment, never argv/files.
 * No error body/stderr from credential-bearing children reaches application logs.
 */
import { spawn } from "node:child_process";

try {
	const raw = process.env.PTOLEMY_MCP_STDIO;
	delete process.env.PTOLEMY_MCP_STDIO;
	if (!raw) throw Error();
	const config = JSON.parse(raw);
	const child = spawn(config.command, config.args, {
		cwd: config.cwd,
		env: config.env,
		stdio: ["inherit", "inherit", "ignore"],
		detached: true,
	});
	const kill = (signal) => {
		try {
			if (child.pid) process.kill(-child.pid, signal);
		} catch {}
	};
	for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
		process.on(signal, () => {
			kill(signal);
			setTimeout(() => kill("SIGKILL"), 500).unref();
		});
	child.on("error", () => process.exit(1));
	child.on("exit", (code) => {
		kill("SIGKILL");
		process.exit(code ?? 1);
	});
} catch {
	process.exit(1);
}
