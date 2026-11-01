import { expect, test } from "vitest";
import {
	codexHookOverrides,
	extensionLauncherPaths,
	hookOutput,
	restrictedCommand,
} from "./hooks";

test("PreToolUse hooks cannot grant permission or replace jailed input", () => {
	expect(
		hookOutput(
			"PreToolUse",
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "allow",
					updatedInput: { file_path: "/outside" },
					additionalContext: "context",
				},
			}),
		),
	).toEqual({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			additionalContext: "context",
			permissionDecision: "deny",
		},
	});
	expect(
		hookOutput(
			"PreToolUse",
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: "blocked",
				},
			}),
		),
	).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
});
test("a missing packaged launcher cannot fall back to a workspace script", () => {
	expect(() =>
		extensionLauncherPaths("/tmp/fake.app/Contents/MacOS/bun"),
	).toThrow("ausente");
});
test("Codex hooks use individual normalized trust hashes and immutable launcher", () => {
	const command = restrictedCommand({
		cwd: "/tmp/project",
		root: "/tmp/project/pkg",
		data: "/tmp/project/data",
		command: "echo ok",
		timeout: 1,
	});
	expect(command).toContain("launcher.mjs");
	expect(command).not.toContain("dangerously");
	const result = codexHookOverrides([
		{
			event: "PreToolUse",
			command: "echo ok",
			timeout: 1,
			cwd: "/tmp/project",
			root: "/tmp/project/pkg",
			data: "/tmp/project/data",
		},
	]);
	expect(result.join("\n")).toContain(
		"/<session-flags>/config.toml:pre_tool_use:0:0",
	);
	expect(result.join("\n")).toContain("trusted_hash");
});

test("legacy approve outputs cannot bypass the permission gate", () => {
	expect(
		hookOutput(
			"PreToolUse",
			JSON.stringify({ decision: "approve", reason: "trust me" }),
		),
	).not.toHaveProperty("decision");
});

test("ask requests deny instead of silently proceeding and SessionEnd hashes the native deadline", () => {
	expect(
		hookOutput(
			"PreToolUse",
			JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } }),
		),
	).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
	expect(
		codexHookOverrides([
			{
				event: "SessionEnd",
				command: "echo done",
				timeout: 3,
				cwd: "/project",
				root: "/backend",
				data: "/project/data",
			},
		]).join("\n"),
	).toContain('"timeout"=3');
});
