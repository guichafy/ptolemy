#!/usr/bin/env bun
import { $ } from "bun";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Public URL of the GitHub Pages site. Explicit PAGES_BASE wins; in Actions it is
// derived from GITHUB_REPOSITORY (owner.github.io/<repo>), matching the site's
// `base` in astro.config.mjs, so a repo rename needs no code change here.
const PAGES_BASE = (
	process.env.PAGES_BASE ??
	(process.env.GITHUB_REPOSITORY
		? `https://${process.env.GITHUB_REPOSITORY.split("/")[0].toLowerCase()}.github.io/${process.env.GITHUB_REPOSITORY.split("/")[1]}`
		: "https://guichafy.github.io/ptolemy")
).replace(/\/$/, "");
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const USAGE = [
	"Usage:",
	"  bun run scripts/build-pages-mirror.ts <semver> <zipPath>   stage a release zip + latest.json",
	"  bun run scripts/build-pages-mirror.ts --latest-only        regenerate latest.json from gh-pages",
].join("\n");

const root = resolve(import.meta.dir, "..");
const pagesDist = resolve(root, "pages-dist");
await mkdir(pagesDist, { recursive: true });

const latestOnly = process.argv[2] === "--latest-only";
let version: string | null = null;
let zipName: string | null = null;

if (!latestOnly) {
	version = process.argv[2] ?? null;
	const zipArg = process.argv[3];
	if (!version || !SEMVER_RE.test(version)) {
		console.error(USAGE);
		process.exit(1);
	}
	if (!zipArg) {
		console.error(`Missing <zipPath> argument\n${USAGE}`);
		process.exit(1);
	}
	const zipSrc = resolve(root, zipArg);
	if (!(await Bun.file(zipSrc).exists())) {
		console.error(`Zip not found: ${zipSrc}`);
		process.exit(1);
	}
	const versionDir = resolve(pagesDist, `v${version}`);
	zipName = `ptolemy-${version}-macos-arm64.zip`;
	await mkdir(versionDir, { recursive: true });
	await copyFile(zipSrc, resolve(versionDir, zipName));
	console.log(`Staged ${zipName} → pages-dist/v${version}/`);
}

// Maps each published version to its zip name. Releases up to v0.10.x were
// published as `ptolomeu-*` (the project's former name); newer ones as `ptolemy-*`.
const zipsByVersion = await listPriorZips();
if (version && zipName) zipsByVersion.set(version, zipName);
const allVersions = Array.from(zipsByVersion.keys()).sort(compareSemverDesc);
if (allVersions.length === 0) {
	console.warn("No published versions found — skipping latest.json");
	process.exit(0);
}
const latestVersion = allVersions.find((v) => !v.includes("-")) ?? allVersions[0];
const latestZip = zipsByVersion.get(latestVersion);
const latest = {
	version: latestVersion,
	url: `${PAGES_BASE}/v${latestVersion}/${latestZip}`,
	publishedAt: (await previousPublishedAt(latestVersion)) ?? new Date().toISOString(),
};
await Bun.write(resolve(pagesDist, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Wrote latest.json → ${latestVersion}`);

async function listPriorZips(): Promise<Map<string, string>> {
	const zips = new Map<string, string>();
	try {
		// Explicit refspec: shallow/single-branch clones (e.g. actions/checkout)
		// don't map gh-pages to a remote-tracking ref otherwise.
		await $`git fetch --depth=1 origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages`.quiet();
	} catch {
		console.warn("gh-pages branch not reachable yet — starting with empty version list");
		return zips;
	}
	const list = await $`git ls-tree -r --name-only origin/gh-pages`.text();
	const re = /^v(\d+\.\d+\.\d+(?:-[\w.-]+)?)\/((?:ptolemy|ptolomeu)-\1-macos-arm64\.zip)$/;
	for (const line of list.split("\n")) {
		const m = line.match(re);
		if (!m) continue;
		// Prefer the current name if a version somehow has both.
		if (!zips.has(m[1]) || m[2].startsWith("ptolemy-")) zips.set(m[1], m[2]);
	}
	return zips;
}

// Keeps the original publish date when latest.json is regenerated for a
// version that was already the latest (e.g. a site redeploy after a path change).
async function previousPublishedAt(latestVersion: string): Promise<string | null> {
	try {
		const prev = JSON.parse(await $`git show origin/gh-pages:latest.json`.quiet().text());
		return prev?.version === latestVersion && typeof prev.publishedAt === "string"
			? prev.publishedAt
			: null;
	} catch {
		return null;
	}
}

function parseSemver(v: string): [number, number, number] {
	const [core] = v.split("-");
	const [maj, min, pat] = core.split(".").map(Number);
	return [maj, min, pat];
}

function compareSemverDesc(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pb[i] - pa[i];
	}
	const preA = a.split("-")[1] ?? "";
	const preB = b.split("-")[1] ?? "";
	if (!preA && preB) return -1;
	if (preA && !preB) return 1;
	return preB.localeCompare(preA);
}
