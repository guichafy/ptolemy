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

describe("raw immutable downloads without per-file API quota", () => {
	it("downloads over 60 files using only two metadata API calls and at most six concurrent raw requests", async () => {
		const fixture = githubFixture(
			Object.fromEntries(
				Array.from({ length: 70 }, (_, i) => [`assets/${i}.txt`, `${i}`]),
			),
		);
		let active = 0;
		let maximum = 0;
		const fetcher = async (url: string, init?: RequestInit) => {
			expect(init?.redirect).toBe("error");
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			if (new URL(url).hostname !== "raw.githubusercontent.com")
				return fixture.fetcher(url);
			active++;
			maximum = Math.max(active, maximum);
			await new Promise((resolve) => setTimeout(resolve, 2));
			const response = await fixture.fetcher(url);
			active--;
			return response;
		};
		const repo = await GithubRepository.open("https://github.com/o/r", fetcher);
		expect(await repo.download()).toHaveLength(70);
		expect(
			fixture.requests.filter(
				(url) => new URL(url).hostname === "api.github.com",
			),
		).toHaveLength(2);
		expect(
			fixture.requests.filter(
				(url) => new URL(url).hostname === "raw.githubusercontent.com",
			),
		).toHaveLength(70);
		expect(maximum).toBeGreaterThan(1);
		expect(maximum).toBeLessThanOrEqual(6);
		expect(
			fixture.requests
				.filter((url) => new URL(url).hostname === "raw.githubusercontent.com")
				.every((url) => url.includes(`/${commit}/`)),
		).toBe(true);
	});
	it("encodes immutable raw paths and validates cache content once", async () => {
		const fixture = githubFixture({ "assets/a #?.txt": "data" });
		const repo = await GithubRepository.open(
			"https://github.com/o/r",
			fixture.fetcher,
		);
		await repo.download();
		await repo.read("assets/a #?.txt");
		expect(
			fixture.requests.filter(
				(url) => new URL(url).hostname === "raw.githubusercontent.com",
			),
		).toEqual([
			`https://raw.githubusercontent.com/o/r/${commit}/assets/a%20%23%3F.txt`,
		]);
	});
	it("does not echo malformed JSON source text in repository parser errors", async () => {
		const fixture = githubFixture({ "plugin.json": "credential-probe" });
		const repo = await GithubRepository.open(
			"https://github.com/o/r",
			fixture.fetcher,
		);
		let message = "";
		try {
			await repo.json("plugin.json");
		} catch (error) {
			message = String(error);
		}
		expect(message).toMatch(/JSON/);
		expect(message).not.toContain("credential-probe");
	});
});

it("rejects same-length corrupt raw bytes using the pinned Git object hash", async () => {
	const fixture = githubFixture({ "file.txt": "first" });
	const fetcher = (url: string) =>
		new URL(url).hostname === "raw.githubusercontent.com"
			? Promise.resolve(new Response("other"))
			: fixture.fetcher(url);
	const repo = await GithubRepository.open("https://github.com/o/r", fetcher);
	await expect(repo.download()).rejects.toThrow(/corrompido/);
});
