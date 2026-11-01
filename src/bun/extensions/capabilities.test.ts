import { expect, test } from "vitest";
import { componentCapability } from "./capabilities";
import { normalizePackage } from "./manifests";

function hook(
	harness: "claude" | "codex",
	event: string,
	matcher?: string,
	timeout?: number,
) {
	const pkg = normalizePackage(
		[
			{
				path: "hooks/hooks.json",
				executable: false,
				content: Buffer.from(
					JSON.stringify({
						hooks: {
							[event]: [
								{
									matcher,
									hooks: [{ type: "command", command: "echo ok", timeout }],
								},
							],
						},
					}),
				).toString("base64"),
			},
		],
		"demo",
		{},
	);
	const c = pkg.components[0];
	c.sources = c.sources.map((s) => ({ ...s, harness }));
	return c;
}
test("tool matchers never silently change between native tool vocabularies", () => {
	expect(
		componentCapability(
			hook("claude", "PreToolUse", "Bash|Write"),
			"claude",
			true,
		).status,
	).toBe("adapted");
	expect(
		componentCapability(
			hook("claude", "PreToolUse", "Bash|Write"),
			"codex",
			true,
		).reason,
	).toContain("payloads codex");
	expect(
		componentCapability(
			hook("codex", "PreToolUse", "exec_command"),
			"claude",
			true,
		).status,
	).toBe("incompatible");
	expect(
		componentCapability(hook("claude", "PreToolUse", "*"), "codex", true)
			.status,
	).toBe("adapted");
});
test("Codex SessionEnd diagnoses deadlines the native runtime cannot honor", () => {
	expect(
		componentCapability(
			hook("codex", "SessionEnd", undefined, 5),
			"codex",
			true,
		).reason,
	).toContain("3 segundos");
	expect(
		componentCapability(hook("codex", "SessionEnd"), "codex", true).status,
	).toBe("adapted");
});
