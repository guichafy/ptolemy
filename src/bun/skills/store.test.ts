import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SkillsStore } from "./store";

let root: string;
const bundle = {
	name: "review",
	description: "Review code.",
	source: {
		kind: "github" as const,
		url: "https://github.com/a/b/tree/main/review",
		commit: "a".repeat(40),
	},
	files: [
		{
			path: "SKILL.md",
			content: Buffer.from(
				"---\nname: review\ndescription: Review code.\n---\nReview.",
			).toString("base64"),
			executable: false,
		},
	],
};
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ptolemy-skills-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Skills catalog", () => {
	test("a native Claude Skill that cannot be mirrored never blocks a conversation", async () => {
		const native = join(root, "native", "review");
		await mkdir(native, { recursive: true });
		await writeFile(
			join(native, "SKILL.md"),
			Buffer.from(bundle.files[0].content, "base64"),
		);
		await writeFile(join(native, "large.bin"), Buffer.alloc(1024 * 1024 + 1));
		const store = new SkillsStore({
			root,
			harnessRoots: { claude: [join(root, "native")], codex: [] },
		});
		const catalog = await store.list("claude");
		expect(catalog[0].unavailableReason).toMatch(/limite/);
		expect(catalog[0].defaultFor).toEqual([]);
		expect(await store.resolveForSession("claude", [])).toEqual([]);
	});
	test("mirrors native Claude defaults and supporting files without loading global settings", async () => {
		const native = join(root, "native", "review");
		await mkdir(join(native, "references"), { recursive: true });
		await writeFile(
			join(native, "SKILL.md"),
			Buffer.from(bundle.files[0].content, "base64"),
		);
		await writeFile(join(native, "references/guide.md"), "native guide");
		const store = new SkillsStore({
			root,
			harnessRoots: { claude: [join(root, "native")], codex: [] },
		});
		expect((await store.list("claude"))[0]).toMatchObject({
			name: "review",
			source: { kind: "harness", agent: "claude" },
			defaultFor: ["claude"],
		});
		expect(
			(
				await store.resolveForSession("claude", await store.defaults("claude"))
			)[0].files,
		).toHaveLength(2);
	});
	test.each([
		"claude",
		"codex",
	] as const)("selects only requested native %s Skills and saves explicit empty defaults", async (agent) => {
		for (const name of ["review", "debug"]) {
			await mkdir(join(root, "native", name), { recursive: true });
			await writeFile(
				join(root, "native", name, "SKILL.md"),
				`---\nname: ${name}\ndescription: Review code.\n---\nReview.`,
			);
		}
		const store = new SkillsStore({
			root,
			harnessRoots: {
				claude: [join(root, "native")],
				codex: [join(root, "native")],
			},
		});
		const catalog = await store.list(agent);
		expect(await store.defaults(agent)).toHaveLength(2);
		expect(
			(await store.resolveForSession(agent, [catalog[0].id])).map((s) => s.id),
		).toEqual([catalog[0].id]);
		expect(await store.resolveForSession(agent, [])).toEqual([]);
		await store.setDefaults(agent, []);
		const reloaded = new SkillsStore({
			root,
			harnessRoots: {
				claude: [join(root, "native")],
				codex: [join(root, "native")],
			},
		});
		expect(await reloaded.defaults(agent)).toEqual([]);
		expect(
			await reloaded.defaults(agent === "claude" ? "codex" : "claude"),
		).toHaveLength(2);
		expect(
			(await reloaded.list(agent)).every((s) => !s.defaultFor.includes(agent)),
		).toBe(true);
	});
	test("keeps colliding native origins visible and rejects only an active name collision", async () => {
		for (const dir of ["one", "two"]) {
			await mkdir(join(root, dir, "review"), { recursive: true });
			await writeFile(
				join(root, dir, "review", "SKILL.md"),
				Buffer.from(bundle.files[0].content, "base64"),
			);
		}
		const store = new SkillsStore({
			root,
			harnessRoots: {
				claude: [],
				codex: [join(root, "one"), join(root, "two")],
			},
		});
		const catalog = await store.list("codex");
		expect(catalog).toHaveLength(2);
		await expect(
			store.resolveForSession(
				"codex",
				catalog.map((s) => s.id),
			),
		).rejects.toThrow(/duplicad|mesmo nome/);
		expect(
			await store.resolveForSession("codex", [catalog[1].id]),
		).toHaveLength(1);
	});
	test("inventories nested native and ancestor workspace discovery paths", async () => {
		const roots = { claude: [], codex: [join(root, "native")] };
		for (const path of [
			join(root, "native/category/review"),
			join(root, ".agents/skills/unmanaged"),
		]) {
			await mkdir(path, { recursive: true });
			await writeFile(
				join(path, "SKILL.md"),
				`---\nname: ${path.endsWith("review") ? "review" : "unmanaged"}\ndescription: Review code.\n---\nReview.`,
			);
		}
		const store = new SkillsStore({
			root: join(root, "catalog"),
			harnessRoots: roots,
		});
		expect((await store.list("codex")).map((s) => s.name)).toEqual(["review"]);
		expect(await store.nativePaths("codex", join(root, "project"))).toContain(
			join(root, ".agents/skills/unmanaged/SKILL.md"),
		);
	});

	test("keeps incompatible native metadata visible with a specific unavailable reason", async () => {
		await mkdir(join(root, "native", "broken"), { recursive: true });
		await writeFile(
			join(root, "native/broken/SKILL.md"),
			"not a Skill document",
		);
		const store = new SkillsStore({
			root: join(root, "catalog"),
			harnessRoots: { claude: [], codex: [join(root, "native")] },
		});
		const [skill] = await store.list("codex");
		expect(skill).toMatchObject({
			name: "broken",
			defaultFor: [],
			unavailableReason: expect.stringContaining("frontmatter"),
		});
		await expect(store.resolveForSession("codex", [skill.id])).rejects.toThrow(
			/frontmatter/,
		);
	});

	test("migrates old imported defaults while including native defaults", async () => {
		const store = new SkillsStore({
			root,
			download: async () => bundle,
			harnessRoots: { claude: [], codex: [] },
		});
		const imported = await store.importGithub(bundle.source.url);
		const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
		delete index.defaults;
		index.skills[0].defaultFor = ["codex"];
		await writeFile(join(root, "index.json"), JSON.stringify(index));
		expect(await store.defaults("codex")).toEqual([imported.id]);
		await store.setDefaults("claude", []);
		expect(await store.defaults("codex")).toEqual([imported.id]);
	});

	test("persists an accepted import and per-agent defaults across reloads", async () => {
		const store = new SkillsStore({
			root,
			download: async () => bundle,
			harnessRoots: { claude: [], codex: [] },
		});
		const skill = await store.importGithub(bundle.source.url);
		await store.setDefaults("codex", [skill.id]);
		const reloaded = new SkillsStore({
			root,
			harnessRoots: { claude: [], codex: [] },
		});
		expect(await reloaded.list("codex")).toEqual([
			expect.objectContaining({ id: skill.id, defaultFor: ["codex"] }),
		]);
		expect((await reloaded.resolve([skill.id]))[0].files).toEqual(bundle.files);
	});
	test("rejects duplicate names and unknown selections without changing the catalog", async () => {
		const store = new SkillsStore({
			root,
			download: async () => bundle,
			harnessRoots: { claude: [], codex: [] },
		});
		await store.importGithub(bundle.source.url);
		const before = await readFile(join(root, "index.json"), "utf8");
		await expect(store.importGithub(bundle.source.url)).rejects.toThrow(
			/cadastrada/,
		);
		await expect(store.resolve(["../escape"])).rejects.toThrow();
		await expect(store.setDefaults("claude", ["missing"])).rejects.toThrow();
		expect(await readFile(join(root, "index.json"), "utf8")).toBe(before);
	});
	test("does not register failed downloads", async () => {
		const store = new SkillsStore({
			root,
			download: async () => {
				throw new Error("invalid");
			},
			harnessRoots: { claude: [], codex: [] },
		});
		await expect(store.importGithub(bundle.source.url)).rejects.toThrow(
			"invalid",
		);
		expect(await store.list("claude")).toEqual([]);
	});
});

test("saved defaults distinguish absence from explicit none and do not depend on native availability", async () => {
	const native = join(root, "native", "review");
	await mkdir(native, { recursive: true });
	await writeFile(
		join(native, "SKILL.md"),
		Buffer.from(bundle.files[0].content, "base64"),
	);
	const store = new SkillsStore({
		root: join(root, "catalog"),
		harnessRoots: { claude: [join(root, "native")], codex: [] },
	});
	expect(await store.savedDefaults("claude")).toBeUndefined();
	const [skill] = await store.list("claude");
	expect(await store.defaults("claude")).toEqual([skill.id]);
	expect(await store.savedDefaults("claude")).toBeUndefined();
	await store.setDefaults("claude", [skill.id]);
	await rm(native, { recursive: true });
	expect(await store.defaults("claude")).toEqual([]);
	expect(await store.savedDefaults("claude")).toEqual([skill.id]);
	await store.setDefaults("claude", []);
	expect(await store.savedDefaults("claude")).toEqual([]);
	expect(await store.savedDefaults("codex")).toBeUndefined();
});
