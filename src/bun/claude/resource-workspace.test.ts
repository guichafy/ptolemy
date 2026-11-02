import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stageManagedResourceWorkspace } from "./resource-workspace";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
	);
});
async function fixture() {
	const cwd = await mkdtemp(join(tmpdir(), "ptolemy-resource-stage-"));
	roots.push(cwd);
	const archive = await mkdtemp(join(tmpdir(), "ptolemy-resource-backup-"));
	roots.push(archive);
	await mkdir(join(cwd, ".agents/skills/example"), { recursive: true });
	await writeFile(join(cwd, ".agents/skills/example/SKILL.md"), "original");
	return {
		cwd,
		archive,
		expected: new Map([
			[
				".agents/skills/example",
				new Map([["SKILL.md", Buffer.from("original")]]),
			],
		]),
	};
}
it("refuses to replace user-modified generated resources", async () => {
	const f = await fixture();
	await writeFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "user edit");
	await expect(
		stageManagedResourceWorkspace(f.cwd, f.archive, f.expected),
	).rejects.toThrow(/alterad/i);
	expect(
		await readFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "utf8"),
	).toBe("user edit");
});
it("restores the previous generated directories after preparation failure", async () => {
	const f = await fixture();
	const stage = await stageManagedResourceWorkspace(
		f.cwd,
		f.archive,
		f.expected,
	);
	await mkdir(join(f.cwd, ".agents/skills/example"), { recursive: true });
	await writeFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "new");
	await stage.rollback([...f.expected.keys()]);
	expect(
		await readFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "utf8"),
	).toBe("original");
});
it("does not follow a workspace symlink", async () => {
	const f = await fixture();
	const { symlink } = await import("node:fs/promises");
	await rm(join(f.cwd, ".agents/skills/example"), { recursive: true });
	await symlink(f.archive, join(f.cwd, ".agents/skills/example"));
	await expect(
		stageManagedResourceWorkspace(f.cwd, f.archive, f.expected),
	).rejects.toThrow(/link/i);
});

it("rollback never deletes a pre-existing user-owned destination that rejected activation", async () => {
	const f = await fixture();
	const userPath = join(f.cwd, ".agents/skills/user-owned");
	await mkdir(userPath, { recursive: true });
	await writeFile(join(userPath, "SKILL.md"), "USER CONTENT");
	const stage = await stageManagedResourceWorkspace(
		f.cwd,
		f.archive,
		f.expected,
	);
	await stage.rollback([...f.expected.keys(), ".agents/skills/user-owned"]);
	expect(await readFile(join(userPath, "SKILL.md"), "utf8")).toBe(
		"USER CONTENT",
	);
	expect(
		await readFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "utf8"),
	).toBe("original");
});

it("checks new destinations before moving any managed files", async () => {
	const f = await fixture();
	const userPath = join(f.cwd, ".agents/skills/collision");
	await mkdir(userPath, { recursive: true });
	await writeFile(join(userPath, "notes.txt"), "user notes");
	await expect(
		stageManagedResourceWorkspace(f.cwd, f.archive, f.expected, [
			".agents/skills/collision",
		]),
	).rejects.toThrow(/destino.*existe/i);
	expect(await readFile(join(userPath, "notes.txt"), "utf8")).toBe(
		"user notes",
	);
	expect(
		await readFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "utf8"),
	).toBe("original");
});
it("removes only registered absent destinations when rolling back new resources", async () => {
	const f = await fixture();
	const created = ".agents/skills/created";
	const stage = await stageManagedResourceWorkspace(
		f.cwd,
		f.archive,
		f.expected,
		[created],
	);
	await mkdir(join(f.cwd, created), { recursive: true });
	await writeFile(join(f.cwd, created, "SKILL.md"), "new skill");
	await stage.rollback([created]);
	await expect(
		readFile(join(f.cwd, created, "SKILL.md")),
	).rejects.toMatchObject({ code: "ENOENT" });
	expect(
		await readFile(join(f.cwd, ".agents/skills/example/SKILL.md"), "utf8"),
	).toBe("original");
});
