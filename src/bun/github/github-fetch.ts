import { getToken } from "../github-token";
import { fetchWithProxy } from "../net/proxy";
import type { CustomFilter, GitHubSearchType } from "../settings";
import { getCached, setCached } from "./search-cache";
import {
	fetchAllTeamRepos,
	filterTeamRepos,
	type TeamRepo,
} from "./team-repos-cache";

export type GitHubSubType =
	| { kind: "native"; type: GitHubSearchType }
	| { kind: "custom"; filter: CustomFilter };

export type GitHubItem =
	| {
			kind: "repo";
			id: number;
			fullName: string;
			description: string | null;
			stars: number;
			language: string | null;
			url: string;
	  }
	| {
			kind: "code";
			id: string;
			path: string;
			repoFullName: string;
			url: string;
	  }
	| {
			kind: "issue";
			id: number;
			number: number;
			title: string;
			state: "open" | "closed";
			isPR: boolean;
			repoFullName: string;
			url: string;
	  }
	| {
			kind: "user";
			id: number;
			login: string;
			name: string | null;
			avatarUrl: string;
			url: string;
	  };

interface FetchArgs {
	subType: GitHubSubType;
	query: string;
}

const NATIVE_ENDPOINT: Record<GitHubSearchType, string> = {
	repos: "/search/repositories",
	code: "/search/code",
	issues: "/search/issues",
	users: "/search/users",
};

async function apiRequest(
	endpoint: string,
	query: string,
	token: string | null,
): Promise<unknown> {
	const url = `https://api.github.com${endpoint}?q=${encodeURIComponent(query)}`;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "Ptolemy",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetchWithProxy(url, { headers });
	if (res.status === 403) {
		const reset = res.headers.get("x-ratelimit-reset");
		throw new Error(
			`Rate limit atingido${reset ? ` (reset ${reset})` : ""}. Configure um token no Settings para 5000 req/h.`,
		);
	}
	if (res.status === 401) {
		throw new Error("Token inválido. Reconfigurar no Settings → GitHub.");
	}
	if (!res.ok) {
		throw new Error(`GitHub ${res.status}: ${res.statusText}`);
	}
	return res.json();
}

interface SearchReposResponse {
	items: Array<{
		id: number;
		full_name: string;
		description: string | null;
		stargazers_count: number;
		language: string | null;
		html_url: string;
	}>;
}

interface SearchCodeResponse {
	items: Array<{
		sha: string;
		path: string;
		repository: { full_name: string };
		html_url: string;
	}>;
}

interface SearchIssuesResponse {
	items: Array<{
		id: number;
		number: number;
		title: string;
		state: "open" | "closed";
		pull_request?: unknown;
		repository_url: string;
		html_url: string;
	}>;
}

interface SearchUsersResponse {
	items: Array<{
		id: number;
		login: string;
		name?: string | null;
		avatar_url: string;
		html_url: string;
	}>;
}

function repoItemsFromSearch(data: SearchReposResponse): GitHubItem[] {
	return data.items.map((r) => ({
		kind: "repo",
		id: r.id,
		fullName: r.full_name,
		description: r.description,
		stars: r.stargazers_count,
		language: r.language,
		url: r.html_url,
	}));
}

function codeItemsFromSearch(data: SearchCodeResponse): GitHubItem[] {
	return data.items.map((c) => ({
		kind: "code",
		id: c.sha,
		path: c.path,
		repoFullName: c.repository.full_name,
		url: c.html_url,
	}));
}

function issueItemsFromSearch(data: SearchIssuesResponse): GitHubItem[] {
	return data.items.map((i) => ({
		kind: "issue",
		id: i.id,
		number: i.number,
		title: i.title,
		state: i.state,
		isPR: Boolean(i.pull_request),
		repoFullName: i.repository_url.split("/repos/")[1] ?? "",
		url: i.html_url,
	}));
}

function userItemsFromSearch(data: SearchUsersResponse): GitHubItem[] {
	return data.items.map((u) => ({
		kind: "user",
		id: u.id,
		login: u.login,
		name: u.name ?? null,
		avatarUrl: u.avatar_url,
		url: u.html_url,
	}));
}

async function fetchNative(
	type: GitHubSearchType,
	query: string,
	token: string | null,
): Promise<GitHubItem[]> {
	const data = await apiRequest(NATIVE_ENDPOINT[type], query, token);
	switch (type) {
		case "repos":
			return repoItemsFromSearch(data as SearchReposResponse);
		case "code":
			return codeItemsFromSearch(data as SearchCodeResponse);
		case "issues":
			return issueItemsFromSearch(data as SearchIssuesResponse);
		case "users":
			return userItemsFromSearch(data as SearchUsersResponse);
	}
}

function teamReposToItems(repos: TeamRepo[]): GitHubItem[] {
	return repos.map(
		(r): GitHubItem => ({
			kind: "repo",
			id: r.id,
			fullName: r.fullName,
			description: r.description,
			stars: r.stars,
			language: r.language,
			url: r.url,
		}),
	);
}

async function fetchFromNetwork(
	subType: GitHubSubType,
	query: string,
	token: string | null,
): Promise<GitHubItem[]> {
	if (subType.kind === "native") {
		return fetchNative(subType.type, query, token);
	}
	const filter = subType.filter;
	if (filter.kind === "search") {
		const combined = [filter.qualifiers, query].filter(Boolean).join(" ");
		return fetchNative(filter.baseType, combined, token);
	}
	const all = await fetchAllTeamRepos(filter.org, filter.team, token);
	return teamReposToItems(filterTeamRepos(all, query));
}

export interface FetchResult {
	items: GitHubItem[];
	cached: boolean;
}

export async function githubFetchSearch(args: FetchArgs): Promise<FetchResult> {
	const { subType, query } = args;
	const cached = getCached(subType, query);
	if (cached) {
		return { items: cached, cached: true };
	}
	const token = await getToken();
	const items = await fetchFromNetwork(subType, query, token);
	setCached(subType, query, items);
	return { items, cached: false };
}
