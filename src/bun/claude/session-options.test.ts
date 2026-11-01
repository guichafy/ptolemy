import { describe, expect, test } from "vitest";
import { buildQueryOptions } from "./session-options";

const baseArgs = {
	model: "claude-sonnet-4-6",
	permissionMode: "acceptEdits" as const,
	claudePath: "/usr/local/bin/claude",
	canUseTool: async () => ({ behavior: "allow" as const, updatedInput: {} }),
	mcpServers: {},
	cwd: "/tmp/proj",
};

describe("buildQueryOptions", () => {
	test("loads Skills through a local plugin without enabling filesystem settings or bypassing the tool gate", () => {
		const opts = buildQueryOptions(baseArgs);
		expect(opts.plugins).toEqual([
			{ type: "local", path: "/tmp/proj/.ptolemy/claude-harness" },
		]);
		expect(opts.settingSources).toBeUndefined();
		expect(opts.canUseTool).toBe(baseArgs.canUseTool);
		expect(opts.allowedTools).not.toContain("Skill");
	});
	test("blocks native Skill rediscovery only for explicit selections while selected plugin Skills stay enabled", () => {
		expect(
			buildQueryOptions({ ...baseArgs, explicitSkillSelection: true })
				.managedSettings,
		).toEqual({ strictPluginOnlyCustomization: ["skills"] });
		expect(buildQueryOptions(baseArgs).managedSettings).toBeUndefined();
	});

	test("includes model, cwd, permissionMode, allowed read-only tools", () => {
		const opts = buildQueryOptions(baseArgs);
		expect(opts.model).toBe("claude-sonnet-4-6");
		expect(opts.cwd).toBe("/tmp/proj");
		expect(opts.permissionMode).toBe("acceptEdits");
		expect(opts.allowedTools).toEqual(["Read", "Glob", "Grep", "LS"]);
		expect(opts.includePartialMessages).toBe(true);
		expect(opts.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
	});

	test("attaches mcpServers only when non-empty", () => {
		const empty = buildQueryOptions(baseArgs);
		expect(empty.mcpServers).toBeUndefined();
		const withMcp = buildQueryOptions({
			...baseArgs,
			mcpServers: { foo: { type: "stdio", command: "foo" } as never },
		});
		expect(withMcp.mcpServers).toBeDefined();
	});

	test("attaches resume sessionId when provided", () => {
		const opts = buildQueryOptions({
			...baseArgs,
			resumeSdkSessionId: "abc-123",
		});
		expect(opts.resume).toBe("abc-123");
	});

	test("omits resume when not provided", () => {
		const opts = buildQueryOptions(baseArgs);
		expect("resume" in opts).toBe(false);
	});

	test("omits permissionMode when not provided", () => {
		const { permissionMode: _, ...argsWithoutMode } = baseArgs;
		const opts = buildQueryOptions(argsWithoutMode);
		expect("permissionMode" in opts).toBe(false);
	});
});
