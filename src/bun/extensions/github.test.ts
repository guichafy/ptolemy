import { describe, expect, it } from "vitest";
import { GithubRepository, MAX_PACKAGE_BYTES } from "./github";

import { commit, githubFixture } from "./test-fixtures";

describe("immutable GitHub package downloads", () => {
	it("resolves slash refs, pins blobs, preserves executable files and full root", async () => {
		const f = githubFixture(
			{
				"plugins/demo/run.sh": "echo ok",
				"plugins/demo/assets/data.txt": "data",
			},
			{ ref: "feature/catalog", mode: "100755" },
		);
		const repo = await GithubRepository.open(
			"https://github.com/o/r/tree/feature/catalog/plugins/demo",
			f.fetcher,
		);
		expect(repo.commit).toBe(commit);
		expect(repo.folder).toBe("plugins/demo");
		expect(await repo.download()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "run.sh", executable: true }),
			]),
		);
		expect(f.requests.some((u) => u.includes(`/git/trees/${commit}`))).toBe(
			true,
		);
	});
	it.each([
		"https://token@github.com/o/r",
		"https://github.com/o/r/tree/main/../outside",
		"https://github.com/o/r?token=secret",
		"https://other.test/o/r",
	])("rejects unsafe source %s", async (url) => {
		await expect(
			GithubRepository.open(url, githubFixture({ x: "x" }).fetcher),
		).rejects.toThrow();
	});
	it.each(["120000", "160000"])("rejects links/submodules %s", async (mode) => {
		const repo = await GithubRepository.open(
			"https://github.com/o/r",
			githubFixture({ x: "x" }, { mode }).fetcher,
		);
		await expect(repo.download()).rejects.toThrow(/simbólicos|submódulos/);
	});
	it("rejects truncated trees before downloading", async () => {
		await expect(
			GithubRepository.open(
				"https://github.com/o/r",
				githubFixture({ x: "x" }, { truncated: true }).fetcher,
			),
		).rejects.toThrow(/incompleta/);
	});
	it("rejects traversing and duplicate paths", async () => {
		for (const files of [
			{ "../escape": "x" },
			{ a: "a", A: "b" },
			{ dir: "x", "dir/x": "x" },
		] as Record<string, string>[]) {
			await expect(
				GithubRepository.open(
					"https://github.com/o/r",
					githubFixture(files).fetcher,
				).then((repo) => repo.download()),
			).rejects.toThrow(/caminho|Conflito/i);
		}
	});
	it("rejects declared limits, excess files and corrupted blob lengths/digests", async () => {
		const scenarios = [
			githubFixture({ x: "x" }, { size: MAX_PACKAGE_BYTES }),
			githubFixture(
				Object.fromEntries(
					Array.from({ length: 2049 }, (_, i) => [`${i}`, "x"]),
				),
			),
			githubFixture({ x: "x" }, { mismatch: true }),
		];
		for (const fixture of scenarios) {
			const repo = await GithubRepository.open(
				"https://github.com/o/r",
				fixture.fetcher,
			);
			await expect(repo.download()).rejects.toThrow();
		}
	});
});

describe("bounded repository responses", () => {
	it("rejects total package bytes before fetching any blob", async () => {
		const fixture = githubFixture(
			{ a: "a", b: "b", c: "c", d: "d", e: "e" },
			{ size: 8 * 1024 * 1024 },
		);
		const repo = await GithubRepository.open(
			"https://github.com/o/r",
			fixture.fetcher,
		);
		await expect(repo.download()).rejects.toThrow(/32 MiB/);
		expect(fixture.requests.some((url) => url.includes("/git/blobs/"))).toBe(
			false,
		);
	});
	it("rejects oversized manifest responses and HTTP failures without echoing remote content", async () => {
		const fixture = githubFixture(
			{ "plugin.json": "x" },
			{ size: 1024 * 1024 + 1 },
		);
		const repo = await GithubRepository.open(
			"https://github.com/o/r",
			fixture.fetcher,
		);
		await expect(repo.json("plugin.json")).rejects.toThrow(/limite/);
		await expect(
			GithubRepository.open(
				"https://github.com/o/r",
				async () => new Response("secret-server-body", { status: 403 }),
			),
		).rejects.toThrow(/HTTP 403/);
	});
	it("rejects the response stream exceeding the tree JSON bound", async () => {
		const fixture = githubFixture({ x: "x" });
		const fetcher = (url: string) =>
			url.includes("/git/trees/")
				? Promise.resolve(
						new Response(
							`{"truncated":false,"tree":[],"extra":"${"x".repeat(8 * 1024 * 1024)}"}`,
						),
					)
				: fixture.fetcher(url);
		await expect(
			GithubRepository.open("https://github.com/o/r", fetcher),
		).rejects.toThrow(/limite/);
	});
});

it("rejects a commit response that does not match an explicitly pinned SHA", async () => {
	const pinned = "b".repeat(40);
	const fixture = githubFixture({ "plugin.json": "{}" }, { ref: pinned });
	await expect(
		GithubRepository.open(
			`https://github.com/o/r/tree/${pinned}`,
			fixture.fetcher,
		),
	).rejects.toThrow(/fixada/);
});
