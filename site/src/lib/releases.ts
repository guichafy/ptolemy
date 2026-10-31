const REPO = "guichafy/ptolemy";
const PAGES_BASE = "https://guichafy.github.io/ptolemy";

type GitHubAsset = {
	name: string;
	size: number;
	browser_download_url: string;
};

type GitHubRelease = {
	tag_name: string;
	name: string | null;
	body: string | null;
	html_url: string;
	published_at: string | null;
	draft: boolean;
	prerelease: boolean;
	assets: GitHubAsset[];
};

export type Asset = { name: string; size: number; url: string };
export type ReleaseEntry = {
	version: string;
	tagName: string;
	publishedAt: string | null;
	htmlUrl: string;
	notesUrl: string;
	mirrorUrl: string | null;
	prerelease: boolean;
	assets: Asset[];
};

export type ReleasesResult = {
	releases: ReleaseEntry[];
	latestVersion: string | null;
	source: "github-api" | "empty";
};

function tagToVersion(tag: string): string | null {
	const m = /^v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.exec(tag.trim());
	return m ? m[1] : null;
}

function pickPrimaryAsset(assets: Asset[]): Asset | null {
	return (
		assets.find((a) => /-macos-arm64\.zip$/.test(a.name)) ??
		assets.find((a) => a.name.endsWith(".zip")) ??
		assets[0] ??
		null
	);
}

function buildMirrorUrl(version: string, assetName: string | null): string | null {
	if (!assetName) return null;
	return `${PAGES_BASE}/v${version}/${assetName}`;
}

export async function fetchReleases(limit = 20): Promise<ReleasesResult> {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "ptolemy-site",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	let payload: GitHubRelease[];
	try {
		const res = await fetch(
			`https://api.github.com/repos/${REPO}/releases?per_page=${limit}`,
			{ headers },
		);
		if (!res.ok) {
			console.warn(
				`[releases] GitHub API returned ${res.status}; rendering empty list`,
			);
			return { releases: [], latestVersion: null, source: "empty" };
		}
		payload = (await res.json()) as GitHubRelease[];
	} catch (err) {
		console.warn("[releases] failed to reach GitHub API:", err);
		return { releases: [], latestVersion: null, source: "empty" };
	}

	const entries: ReleaseEntry[] = payload
		.filter((r) => !r.draft)
		.map((r): ReleaseEntry | null => {
			const version = tagToVersion(r.tag_name);
			if (!version) return null;
			const assets: Asset[] = r.assets.map((a) => ({
				name: a.name,
				size: a.size,
				url: a.browser_download_url,
			}));
			const primary = pickPrimaryAsset(assets);
			return {
				version,
				tagName: r.tag_name,
				publishedAt: r.published_at,
				htmlUrl: r.html_url,
				notesUrl: r.html_url,
				mirrorUrl: buildMirrorUrl(version, primary?.name ?? null),
				prerelease: r.prerelease,
				assets,
			};
		})
		.filter((x): x is ReleaseEntry => x !== null);

	const latestStable = entries.find((e) => !e.prerelease);
	const latestVersion = latestStable?.version ?? entries[0]?.version ?? null;

	return { releases: entries, latestVersion, source: "github-api" };
}
