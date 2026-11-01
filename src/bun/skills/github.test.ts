import { describe, expect, test } from "vitest";
import { downloadGithubSkill, parseGithubUrl } from "./github";

const doc =
	"---\nname: review\ndescription: Review code.\n---\nRead references/guide.md.";
const commit = "a".repeat(40);
const blob = "b".repeat(40);
const entry = (path: string, mode = "100644", size = 10) => ({
	path,
	mode,
	size,
	type: "blob",
	sha: blob,
});

function fixture(
	entries = [
		entry("skills/review/SKILL.md"),
		entry("skills/review/references/guide.md"),
	],
	truncated = false,
) {
	const requests: string[] = [];
	const fetcher = async (url: string) => {
		requests.push(url);
		if (url.endsWith("/commits/main")) return Response.json({ sha: commit });
		if (url.includes("/commits/"))
			return Response.json(
				{ message: "No commit found for SHA: missing" },
				{ status: 422 },
			);
		if (url.includes("/git/trees/"))
			return Response.json({ tree: entries, truncated });
		if (url.includes("/git/blobs/"))
			return Response.json({
				encoding: "base64",
				content: Buffer.from(doc).toString("base64"),
			});
		throw new Error(`Unexpected URL: ${url}`);
	};
	return { fetcher, requests };
}

describe("GitHub Skill import", () => {
	test("resolves branch names containing slashes before selecting the Skill folder", async () => {
		const { fetcher } = fixture();
		const bundle = await downloadGithubSkill(
			"https://github.com/org/repo/tree/feature/new/skills/review",
			async (url) =>
				url.endsWith("/commits/feature%2Fnew")
					? Response.json({ sha: commit })
					: fetcher(url),
		);
		expect(bundle.name).toBe("review");
		expect(bundle.source.commit).toBe(commit);
	});
	test.each([
		"http://github.com/a/b",
		"https://evil.com/a/b",
		"https://user@github.com/a/b",
		"https://github.com/a/b/tree/main/%2e%2e",
		"https://github.com/a/b/tree/main/a%2Fb",
		"https://github.com/a/b?token=secret",
	])("rejects unsafe source %s", (url) => {
		expect(() => parseGithubUrl(url)).toThrow();
	});
	test("pins the revision and includes supporting files only from the selected folder", async () => {
		const { fetcher, requests } = fixture([
			entry("skills/review/SKILL.md"),
			entry("skills/review/references/guide.md"),
			entry("unrelated/file.txt"),
		]);
		const result = await downloadGithubSkill(
			"https://github.com/org/repo/tree/main/skills/review",
			fetcher,
		);
		expect(result.name).toBe("review");
		expect(result.source.commit).toBe(commit);
		expect(result.files.map((f) => f.path)).toEqual([
			"SKILL.md",
			"references/guide.md",
		]);
		expect(requests.some((url) => url.includes(`/git/trees/${commit}`))).toBe(
			true,
		);
	});
	test("accepts a direct SKILL.md URL", async () => {
		const { fetcher } = fixture();
		expect(
			(
				await downloadGithubSkill(
					"https://github.com/org/repo/blob/main/skills/review/SKILL.md",
					fetcher,
				)
			).name,
		).toBe("review");
	});
	test.each([
		"120000",
		"160000",
	])("rejects symlinks and submodules (%s)", async (mode) => {
		const { fetcher } = fixture([
			entry("skills/review/SKILL.md"),
			entry("skills/review/escape", mode),
		]);
		await expect(
			downloadGithubSkill(
				"https://github.com/org/repo/tree/main/skills/review",
				fetcher,
			),
		).rejects.toThrow();
	});
	test.each([
		"skills/review/../escape",
		"skills/review/a\\b",
		"skills/review/.git/config",
	])("rejects unsafe package path %s", async (path) => {
		const { fetcher } = fixture([entry("skills/review/SKILL.md"), entry(path)]);
		await expect(
			downloadGithubSkill(
				"https://github.com/org/repo/tree/main/skills/review",
				fetcher,
			),
		).rejects.toThrow();
	});
	test("rejects truncated trees and oversized files", async () => {
		for (const data of [
			fixture(undefined, true),
			fixture([entry("skills/review/SKILL.md", "100644", 2 * 1024 * 1024)]),
		]) {
			await expect(
				downloadGithubSkill(
					"https://github.com/org/repo/tree/main/skills/review",
					data.fetcher,
				),
			).rejects.toThrow();
		}
	});
	test("reports GitHub rate limits", async () => {
		await expect(
			downloadGithubSkill(
				"https://github.com/org/repo",
				async () => new Response(null, { status: 403 }),
			),
		).rejects.toThrow(/GitHub/);
	});
});
