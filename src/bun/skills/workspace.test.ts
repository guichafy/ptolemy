import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { activateSkills, snapshotSkills } from "./workspace";

let root: string;
const bundle = (name: string) => ({
	id: crypto.randomUUID(),
	name,
	description: "Review code.",
	source: {
		kind: "github" as const,
		url: "https://github.com/a/b",
		commit: "a".repeat(40),
	},
	files: [
		{
			path: "SKILL.md",
			content: Buffer.from(
				`---\nname: ${name}\ndescription: Review code.\n---\nReview.`,
			).toString("base64"),
			executable: false,
		},
		{
			path: "scripts/run.sh",
			content: Buffer.from("echo ok").toString("base64"),
			executable: true,
		},
	],
});
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ptolemy-workspace-skills-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("conversation Skills", () => {
	test.each([
		"claude",
		"codex",
	] as const)("materializes a durable snapshot for %s and restores a shared project", async (agent) => {
		const snapshots = join(root, "sessions");
		const cwd = join(root, "project");
		await mkdir(cwd);
		const first = bundle("review");
		await snapshotSkills(snapshots, "first", [first]);
		await snapshotSkills(snapshots, "second", [bundle("debug")]);
		const skillsDir = join(
			cwd,
			agent === "claude" ? ".ptolemy/claude-harness" : ".agents",
			"skills",
		);
		const personal = join(
			cwd,
			agent === "claude" ? ".claude/skills" : ".agents/skills",
			"personal",
		);
		await mkdir(personal, { recursive: true });
		await writeFile(join(personal, "SKILL.md"), "user content");
		await activateSkills(snapshots, "first", cwd, agent);
		expect(
			await readFile(join(skillsDir, "review", "scripts/run.sh"), "utf8"),
		).toBe("echo ok");
		await activateSkills(snapshots, "second", cwd, agent);
		await expect(
			readFile(join(skillsDir, "review", "SKILL.md")),
		).rejects.toThrow();
		await activateSkills(snapshots, "first", cwd, agent);
		expect(
			await readFile(join(skillsDir, "review", "SKILL.md"), "utf8"),
		).toContain("name: review");
		expect(await readFile(join(personal, "SKILL.md"), "utf8")).toBe(
			"user content",
		);
	});
	test("Claude reload removes workspace-added plugin hooks and tool grants", async () => {
		const cwd = join(root, "project");
		await mkdir(cwd);
		const skill = bundle("review");
		skill.files[0].content = Buffer.from(
			"---\nname: review\ndescription: Review code.\nallowed-tools: Bash\n---\nReview.",
		).toString("base64");
		await snapshotSkills(root, "first", [skill]);
		await activateSkills(root, "first", cwd, "claude");
		const plugin = join(cwd, ".ptolemy/claude-harness");
		await mkdir(join(plugin, "hooks"));
		await writeFile(
			join(plugin, "hooks/hooks.json"),
			'{"hooks":{"SessionStart":[]}}',
		);
		await activateSkills(root, "first", cwd, "claude");
		await expect(readFile(join(plugin, "hooks/hooks.json"))).rejects.toThrow();
		expect(
			await readFile(join(plugin, "skills/review/SKILL.md"), "utf8"),
		).not.toContain("allowed-tools");
	});
	test("never traverses workspace symlinks or overwrites an unmanaged Skill", async () => {
		const snapshots = join(root, "sessions");
		const cwd = join(root, "project");
		await mkdir(cwd);
		await snapshotSkills(snapshots, "first", [bundle("review")]);
		await symlink(root, join(cwd, ".agents"));
		await expect(
			activateSkills(snapshots, "first", cwd, "codex"),
		).rejects.toThrow(/simbólico/);
		await rm(join(cwd, ".agents"));
		await mkdir(join(cwd, ".agents/skills/review"), { recursive: true });
		await writeFile(join(cwd, ".agents/skills/review/SKILL.md"), "personal");
		await expect(
			activateSkills(snapshots, "first", cwd, "codex"),
		).rejects.toThrow(/existente/);
		expect(
			await readFile(join(cwd, ".agents/skills/review/SKILL.md"), "utf8"),
		).toBe("personal");
	});
	test("old sessions without a snapshot still work and clear only managed Skills", async () => {
		const cwd = join(root, "project");
		await mkdir(cwd);
		await snapshotSkills(root, "first", [bundle("review")]);
		await activateSkills(root, "first", cwd, "codex");
		await activateSkills(root, "old", cwd, "codex");
		await expect(
			readFile(join(cwd, ".agents/skills/review/SKILL.md")),
		).rejects.toThrow();
	});
});
