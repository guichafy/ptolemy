import { fetchWithProxy } from "../net/proxy";

export interface TeamRepo {
	id: number;
	name: string;
	fullName: string;
	description: string | null;
	stars: number;
	language: string | null;
	url: string;
}

interface GithubTeamRepo {
	id: number;
	name: string;
	full_name: string;
	description: string | null;
	stargazers_count: number;
	language: string | null;
	html_url: string;
}

function parseNextUrl(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	const parts = linkHeader.split(",");
	for (const part of parts) {
		const match = part.match(/<([^>]+)>;\s*rel="next"/);
		if (match) return match[1];
	}
	return null;
}

export async function fetchAllTeamRepos(
	org: string,
	team: string,
	token: string | null,
): Promise<TeamRepo[]> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "Ptolemy",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	let url: string | null = `https://api.github.com/orgs/${encodeURIComponent(
		org,
	)}/teams/${encodeURIComponent(team)}/repos?per_page=100`;
	const all: TeamRepo[] = [];
	while (url) {
		const res = await fetchWithProxy(url, { headers });
		if (!res.ok) {
			throw new Error(`GitHub ${res.status}: ${res.statusText}`);
		}
		const data = (await res.json()) as GithubTeamRepo[];
		for (const r of data) {
			all.push({
				id: r.id,
				name: r.name,
				fullName: r.full_name,
				description: r.description,
				stars: r.stargazers_count,
				language: r.language,
				url: r.html_url,
			});
		}
		url = parseNextUrl(res.headers.get("Link"));
	}
	return all;
}

export function filterTeamRepos(repos: TeamRepo[], query: string): TeamRepo[] {
	const q = query.trim().toLowerCase();
	if (!q) return repos;
	return repos.filter(
		(r) =>
			r.name.toLowerCase().includes(q) ||
			(r.description?.toLowerCase().includes(q) ?? false),
	);
}
