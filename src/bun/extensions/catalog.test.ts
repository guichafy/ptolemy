import { describe, expect, it } from "vitest";
import type { ExtensionSource } from "@/shared/extensions";
import { catalogSummary, inspectCatalogItem, loadCatalog } from "./catalog";
import { commit, githubFixture, skill } from "./test-fixtures";

const source: ExtensionSource = {
	id: "s",
	name: "test",
	url: "https://github.com/o/r",
};

describe("public GitHub catalogs", () => {
	it("discovers directory Skill catalogs and keeps packages separate", async () => {
		const f = githubFixture({
			"skills/one/SKILL.md": skill("one"),
			"skills/two/SKILL.md": skill("two"),
			"skills/one/scripts/run.sh": "echo ok",
		});
		const items = await loadCatalog(source, f.fetcher);
		expect(items.map((i) => catalogSummary(i).name)).toEqual(["one", "two"]);
		const pkg = await inspectCatalogItem(items[0]);
		expect(pkg.files.map((f) => f.path)).toEqual([
			"SKILL.md",
			"scripts/run.sh",
		]);
	});
	it("resolves Anthropic inline manifests without selecting sibling skills", async () => {
		const f = githubFixture({
			".claude-plugin/marketplace.json": JSON.stringify({
				plugins: [{ name: "suite", source: "./", skills: ["./skills/one"] }],
			}),
			"skills/one/SKILL.md": skill("one"),
			"skills/two/SKILL.md": skill("two"),
			"shared/file.txt": "shared",
		});
		const [item] = await loadCatalog(source, f.fetcher);
		const pkg = await inspectCatalogItem(item);
		expect(
			pkg.components.filter((c) => c.kind === "skill").map((c) => c.name),
		).toEqual(["one"]);
		expect(pkg.files.some((f) => f.path === "shared/file.txt")).toBe(true);
		expect(pkg.manifests["@catalog"]).toMatchObject({
			skills: ["./skills/one"],
		});
	});
	it.each([
		".claude-plugin/marketplace.json",
		".agents/plugins/marketplace.json",
	])("loads local sources relative to repo root in %s", async (path) => {
		const f = githubFixture({
			[path]: JSON.stringify({
				plugins: [
					{ name: "demo", source: { source: "local", path: "./plugins/demo" } },
				],
			}),
			"plugins/demo/.codex-plugin/plugin.json":
				'{"name":"demo","skills":"./skills/"}',
			"plugins/demo/skills/one/SKILL.md": skill("one"),
			"plugins/demo/assets/logo.txt": "logo",
		});
		const [item] = await loadCatalog(source, f.fetcher);
		const pkg = await inspectCatalogItem(item);
		expect(pkg.origin.path).toBe("plugins/demo");
		expect(pkg.components[0].name).toBe("one");
		expect(pkg.files.some((f) => f.path === "assets/logo.txt")).toBe(true);
	});
	it("follows external GitHub git-subdir ref/sha and preserves catalog provenance", async () => {
		const local = githubFixture({
			".claude-plugin/marketplace.json": JSON.stringify({
				plugins: [
					{
						name: "external",
						source: {
							source: "git-subdir",
							url: "https://github.com/vendor/plugin.git",
							path: "plugins/demo",
							ref: "release/v1",
							sha: commit,
						},
					},
				],
			}),
		});
		const remote = githubFixture({
			"plugins/demo/plugin.json": '{"name":"external"}',
			"plugins/demo/skills/one/SKILL.md": skill("one"),
		});
		const fetcher = (url: string) =>
			url.includes("/vendor/plugin/")
				? remote.fetcher(url)
				: local.fetcher(url);
		const [item] = await loadCatalog(source, fetcher);
		expect(remote.requests).toHaveLength(0);
		const pkg = await inspectCatalogItem(item);
		expect(pkg.origin).toMatchObject({
			repository: "vendor/plugin",
			path: "plugins/demo",
			commit,
			catalogUrl: source.url,
		});
		expect(
			remote.requests.some((url) => url.includes(`/commits/${commit}`)),
		).toBe(true);
	});
	it("exposes unsupported sources without failing supported neighbors or leaking credentials", async () => {
		const f = githubFixture({
			".agents/plugins/marketplace.json": JSON.stringify({
				plugins: [
					{
						name: "unsupported",
						source: {
							source: "npm",
							url: "https://token:password@example.test/plugin",
						},
					},
					{ name: "good", source: "./plugins/good" },
				],
			}),
			"plugins/good/plugin.json": '{"name":"good"}',
		});
		const items = await loadCatalog(source, f.fetcher);
		const summary = catalogSummary(items[0]);
		expect(summary.diagnostics[0].code).toBe("unsupported-source");
		expect(JSON.stringify(summary)).not.toMatch(/token|password/);
		await expect(inspectCatalogItem(items[0])).rejects.toThrow(/fonte/i);
		expect((await inspectCatalogItem(items[1])).name).toBe("good");
	});
	it("does not accept a relative source escaping catalog scope", async () => {
		const f = githubFixture({
			".claude-plugin/marketplace.json": JSON.stringify({
				plugins: [{ name: "escape", source: "../../escape" }],
			}),
		});
		const [item] = await loadCatalog(source, f.fetcher);
		expect(catalogSummary(item).diagnostics[0].code).toBe("unsafe-source");
		await expect(inspectCatalogItem(item)).rejects.toThrow();
	});
});

describe("stable catalog identities", () => {
	it("does not change a direct package identity when its display name changes", async () => {
		const before = await loadCatalog(
			source,
			githubFixture({ "plugin.json": '{"name":"before"}' }).fetcher,
		);
		const after = await loadCatalog(
			source,
			githubFixture({ "plugin.json": '{"name":"after"}' }).fetcher,
		);
		expect(after[0].id).toBe(before[0].id);
	});
	it("keeps external string sources with equal names and different folders distinct", async () => {
		const fixture = githubFixture({
			".claude-plugin/marketplace.json": JSON.stringify({
				plugins: [
					{ name: "same", source: "https://github.com/vendor/r/tree/main/one" },
					{ name: "same", source: "https://github.com/vendor/r/tree/main/two" },
				],
			}),
		});
		const items = await loadCatalog(source, fixture.fetcher);
		expect(items[0].id).not.toBe(items[1].id);
	});
	it("resolves external slash refs without SHA and uses GitHub repo shorthand", async () => {
		const local = githubFixture({
			".claude-plugin/marketplace.json": JSON.stringify({
				plugins: [
					{
						name: "remote",
						source: { source: "github", repo: "vendor/r", ref: "release/v1" },
					},
				],
			}),
		});
		const remote = githubFixture(
			{ "plugin.json": '{"name":"remote"}' },
			{ ref: "release/v1" },
		);
		const [item] = await loadCatalog(source, (url) =>
			url.includes("/vendor/r/") ? remote.fetcher(url) : local.fetcher(url),
		);
		expect((await inspectCatalogItem(item)).origin.repository).toBe("vendor/r");
	});
});
