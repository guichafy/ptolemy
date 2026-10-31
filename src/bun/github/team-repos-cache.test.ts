import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchAllTeamRepos,
	filterTeamRepos,
	type TeamRepo,
} from "./team-repos-cache";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("fetchAllTeamRepos", () => {
	it("normaliza payload do endpoint team", async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			expect(String(url)).toContain("/orgs/Chafy-Studio/teams/chafy/repos");
			return new Response(
				JSON.stringify([
					{
						id: 1,
						name: "ptolemy",
						full_name: "Chafy-Studio/ptolemy",
						description: "menu bar app",
						stargazers_count: 5,
						language: "TypeScript",
						html_url: "https://github.com/x",
					},
				]),
				{ status: 200, headers: { Link: "" } },
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const results = await fetchAllTeamRepos("Chafy-Studio", "chafy", "tok");
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("ptolemy");
		expect(results[0].fullName).toBe("Chafy-Studio/ptolemy");
	});

	it("inclui Authorization quando token fornecido", async () => {
		const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer tok123");
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { Link: "" },
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		await fetchAllTeamRepos("o", "t", "tok123");
	});

	it("omite Authorization quando token é null", async () => {
		const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBeNull();
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { Link: "" },
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		await fetchAllTeamRepos("o", "t", null);
	});
});

describe("filterTeamRepos", () => {
	const sample: TeamRepo[] = [
		{
			id: 1,
			name: "ptolemy",
			fullName: "o/ptolemy",
			description: "menu BAR",
			stars: 0,
			language: null,
			url: "",
		},
		{
			id: 2,
			name: "other",
			fullName: "o/other",
			description: "not relevant",
			stars: 0,
			language: null,
			url: "",
		},
		{
			id: 3,
			name: "bar-service",
			fullName: "o/bar-service",
			description: null,
			stars: 0,
			language: null,
			url: "",
		},
	];

	it("retorna tudo quando query vazia", () => {
		expect(filterTeamRepos(sample, "")).toHaveLength(3);
	});

	it("filtra por name e description case-insensitive", () => {
		const matches = filterTeamRepos(sample, "bar");
		expect(matches.map((r: TeamRepo) => r.name).sort()).toEqual([
			"bar-service",
			"ptolemy",
		]);
	});

	it("retorna vazio quando nada bate", () => {
		expect(filterTeamRepos(sample, "zzz")).toEqual([]);
	});
});
