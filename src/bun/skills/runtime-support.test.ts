import { describe, expect, test } from "vitest";
import { assertSkillSelectionSupport } from "./runtime-support";

describe("native Skill selection runtime support", () => {
	test.each([
		["claude", "2.1.118.b3b (Claude Code)"],
		["codex", "codex-cli 0.166.0"],
		["claude", "2.2.0 (Claude Code)"],
	] as const)("accepts verified or newer %s CLI %s", async (agent, version) => {
		await expect(
			assertSkillSelectionSupport(agent, "/cli", async () => version),
		).resolves.toBeUndefined();
	});
	test.each([
		["claude", "2.1.117 (Claude Code)"],
		["codex", "codex-cli 0.165.0"],
		["codex", "unknown"],
	] as const)("rejects unverified %s CLI %s before selection can leak", async (agent, version) => {
		await expect(
			assertSkillSelectionSupport(agent, "/cli", async () => version),
		).rejects.toThrow(/Atualize.*seleção de Skills/);
	});
});
