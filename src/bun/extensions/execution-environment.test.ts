import { afterEach, expect, test, vi } from "vitest";
import type { PreparedSessionExtensions } from "./activation";
import { buildExtensionEnvironment } from "./execution-environment";
import {
	executeHookSequence,
	executeRestricted,
} from "./extension-executor.mjs";
import { claudeExtensionOptions, resolveExtensionPrompt } from "./runtime";

vi.mock("../codex/codex-cli", () => ({
	getLoginShellPath: vi.fn(async () => "/login/bin:/usr/bin:/bin"),
}));
vi.mock("./extension-executor.mjs", async (importOriginal) => ({
	...(await importOriginal<typeof import("./extension-executor.mjs")>()),
	executeRestricted: vi.fn(async () => ({ code: 0, stdout: "resolved" })),
	executeHookSequence: vi.fn(async () => ({})),
}));
vi.mock("./native", async (importOriginal) => ({
	...(await importOriginal<typeof import("./native")>()),
	inventoryClaudePlugins: vi.fn(async () => []),
}));
afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});
test("direct expansion uses login PATH, live proxy and real HOME without inherited credentials", async () => {
	vi.stubEnv("PATH", "/usr/bin:/bin");
	vi.stubEnv("HTTPS_PROXY", "http://proxy-one:8080");
	vi.stubEnv("MCP_SECRET", "secret");
	vi.stubEnv("ANTHROPIC_API_KEY", "secret");
	vi.stubEnv("CODEX_AUTH_TOKEN", "secret");
	const prepared = {
		commands: [
			{
				name: "demo:run",
				prompt: "!`login-only`",
				metadata: {},
				root: "/package",
			},
		],
	} as PreparedSessionExtensions;
	const signal = new AbortController().signal;
	expect(
		await resolveExtensionPrompt(
			prepared,
			"/demo:run",
			"/project",
			false,
			signal,
		),
	).toBe("resolved");
	expect(vi.mocked(executeRestricted).mock.calls[0]).toEqual([
		expect.objectContaining({ cwd: "/project" }),
		"",
		signal,
		expect.objectContaining({
			PATH: "/login/bin:/usr/bin:/bin",
			HOME: process.env.HOME,
			HTTPS_PROXY: "http://proxy-one:8080",
		}),
	]);
	const env = vi.mocked(executeRestricted).mock.calls[0][3]!;
	for (const key of ["MCP_SECRET", "ANTHROPIC_API_KEY", "CODEX_AUTH_TOKEN"])
		expect(env).not.toHaveProperty(key);
	vi.stubEnv("HTTPS_PROXY", "http://proxy-two:9090");
	expect((await buildExtensionEnvironment()).HTTPS_PROXY).toBe(
		"http://proxy-two:9090",
	);
});

test("Claude callback hooks rebuild the same filtered environment at invocation", async () => {
	const prepared = {
		explicit: true,
		hooks: [
			{
				event: "PreToolUse",
				cwd: "/project",
				root: "/package",
				data: "/data",
				command: "login-only",
				timeout: 5,
			},
		],
		agents: [],
		claudePlugins: [],
		skills: [],
	} as unknown as PreparedSessionExtensions;
	const options = await claudeExtensionOptions(prepared);
	const callback = options.hooks!.PreToolUse![0].hooks[0];
	const signal = new AbortController().signal;
	vi.stubEnv("HTTPS_PROXY", "http://live-proxy:8080");
	vi.stubEnv("MCP_SECRET", "hidden");
	await callback({ tool_name: "Read" } as never, undefined, { signal });
	const call = vi.mocked(executeHookSequence).mock.calls[0];
	expect(call[2]).toBe(signal);
	expect(call[3]).toMatchObject({
		PATH: "/login/bin:/usr/bin:/bin",
		HOME: process.env.HOME,
		HTTPS_PROXY: "http://live-proxy:8080",
	});
	expect(call[3]).not.toHaveProperty("MCP_SECRET");
});
