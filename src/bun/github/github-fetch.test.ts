import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as githubToken from "../github-token";
import { githubFetchSearch } from "./github-fetch";
import { invalidateAll as invalidateSearchCache } from "./search-cache";

const originalFetch = globalThis.fetch;

beforeEach(() => {
	invalidateSearchCache();
	vi.spyOn(githubToken, "getToken").mockResolvedValue("tok");
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("githubFetchSearch", () => {
	it("repos nativo → /search/repositories", async () => {
		const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
			expect(String(url)).toContain("/search/repositories");
			expect(String(url)).toContain("q=react");
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer tok");
			return new Response(
				JSON.stringify({
					items: [
						{
							id: 1,
							full_name: "a/b",
							description: null,
							stargazers_count: 0,
							language: null,
							html_url: "u",
						},
					],
				}),
				{ status: 200 },
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await githubFetchSearch({
			subType: { kind: "native", type: "repos" },
			query: "react",
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0].kind).toBe("repo");
		expect(result.cached).toBe(false);
	});

	it("code nativo → /search/code", async () => {
		globalThis.fetch = vi.fn(async (url: string | URL) => {
			expect(String(url)).toContain("/search/code");
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		}) as unknown as typeof fetch;
		const result = await githubFetchSearch({
			subType: { kind: "native", type: "code" },
			query: "useState",
		});
		expect(result.items).toEqual([]);
		expect(result.cached).toBe(false);
	});

	it("issues nativo → /search/issues normaliza PR vs issue", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						items: [
							{
								id: 10,
								number: 1,
								title: "bug",
								state: "open",
								pull_request: null,
								repository_url: "https://api.github.com/repos/a/b",
								html_url: "",
							},
							{
								id: 11,
								number: 2,
								title: "feat",
								state: "closed",
								pull_request: { url: "x" },
								repository_url: "https://api.github.com/repos/a/b",
								html_url: "",
							},
						],
					}),
					{ status: 200 },
				),
		) as unknown as typeof fetch;
		const result = await githubFetchSearch({
			subType: { kind: "native", type: "issues" },
			query: "bug",
		});
		expect(result.items).toHaveLength(2);
		expect(result.items[0].kind).toBe("issue");
		expect((result.items[1] as { isPR: boolean }).isPR).toBe(true);
		expect((result.items[0] as { isPR: boolean }).isPR).toBe(false);
	});

	it("users nativo → /search/users", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						items: [
							{ id: 1, login: "guichafy", avatar_url: "a", html_url: "u" },
						],
					}),
					{ status: 200 },
				),
		) as unknown as typeof fetch;
		const result = await githubFetchSearch({
			subType: { kind: "native", type: "users" },
			query: "guichafy",
		});
		expect(result.items[0].kind).toBe("user");
	});

	it("custom search-query prefixa qualifiers", async () => {
		globalThis.fetch = vi.fn(async (url: string | URL) => {
			const u = new URL(String(url));
			expect(u.pathname).toBe("/search/issues");
			expect(u.searchParams.get("q")).toBe("is:pr is:open author:@me fix");
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		}) as unknown as typeof fetch;
		await githubFetchSearch({
			subType: {
				kind: "custom",
				filter: {
					id: "f1",
					kind: "search",
					name: "PRs",
					baseType: "issues",
					qualifiers: "is:pr is:open author:@me",
				},
			},
			query: "fix",
		});
	});

	it("custom team-repos busca via /orgs/../teams e devolve repo items filtrados", async () => {
		globalThis.fetch = vi.fn(async (url: string | URL) => {
			expect(String(url)).toContain("/orgs/Chafy-Studio/teams/chafy/repos");
			return new Response(
				JSON.stringify([
					{
						id: 99,
						name: "ptolemy",
						full_name: "Chafy-Studio/ptolemy",
						description: "d",
						stargazers_count: 0,
						language: "TS",
						html_url: "u",
					},
				]),
				{ status: 200, headers: { Link: "" } },
			);
		}) as unknown as typeof fetch;
		const result = await githubFetchSearch({
			subType: {
				kind: "custom",
				filter: {
					id: "f2",
					kind: "team-repos",
					name: "x",
					org: "Chafy-Studio",
					team: "chafy",
				},
			},
			query: "ptolemy",
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0].kind).toBe("repo");
	});

	it("propaga erro quando rate limit (403)", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response("", {
					status: 403,
					headers: { "x-ratelimit-reset": "1700000000" },
				}),
		) as unknown as typeof fetch;
		await expect(
			githubFetchSearch({
				subType: { kind: "native", type: "repos" },
				query: "x",
			}),
		).rejects.toThrow(/rate limit/i);
	});

	it("segunda chamada com MESMO termo retorna cached=true sem fetch", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						items: [
							{
								id: 1,
								full_name: "a/b",
								description: null,
								stargazers_count: 0,
								language: null,
								html_url: "",
							},
						],
					}),
					{ status: 200 },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const first = await githubFetchSearch({
			subType: { kind: "native", type: "repos" },
			query: "react",
		});
		expect(first.cached).toBe(false);
		const second = await githubFetchSearch({
			subType: { kind: "native", type: "repos" },
			query: "react",
		});
		expect(second.cached).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("termos diferentes geram fetches diferentes (sem reuso de cache)", async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			const u = new URL(String(url));
			return new Response(
				JSON.stringify({
					items: [
						{
							id: 1,
							full_name: `a/${u.searchParams.get("q")}`,
							description: null,
							stargazers_count: 0,
							language: null,
							html_url: "",
						},
					],
				}),
				{ status: 200 },
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		await githubFetchSearch({
			subType: { kind: "native", type: "repos" },
			query: "foo",
		});
		await githubFetchSearch({
			subType: { kind: "native", type: "repos" },
			query: "bar",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("LRU máximo 3: 4º termo único evicta o primeiro", async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const sub: { kind: "native"; type: "repos" } = {
			kind: "native",
			type: "repos",
		};
		await githubFetchSearch({ subType: sub, query: "a" });
		await githubFetchSearch({ subType: sub, query: "b" });
		await githubFetchSearch({ subType: sub, query: "c" });
		await githubFetchSearch({ subType: sub, query: "d" });
		expect(fetchMock).toHaveBeenCalledTimes(4);
		// Agora "a" foi evictado; refazer "a" vira miss + novo fetch
		const again = await githubFetchSearch({ subType: sub, query: "a" });
		expect(again.cached).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(5);
		// "d" continua no cache
		const dHit = await githubFetchSearch({ subType: sub, query: "d" });
		expect(dHit.cached).toBe(true);
	});
});
