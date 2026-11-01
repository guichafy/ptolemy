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
		expect((await store.resolveForSession("claude", []))[0].files).toHaveLength(
			2,
		);
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
