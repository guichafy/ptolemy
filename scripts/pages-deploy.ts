#!/usr/bin/env bun
/**
 * Waits until GitHub Pages serves the current head of `gh-pages`, and asks
 * for a new Pages build when it does not.
 *
 *   bun run scripts/pages-deploy.ts <gh-pages sha>
 *
 * Why: Pages builds every push to `gh-pages` independently. When two pushes
 * land close together, the build of the first one errors out ("superseded")
 * and, if it is retried, it can finish after the newer one and put the old
 * site back online. The Site workflow is now the only publisher and runs
 * serialized (`concurrency`), and this check closes the remaining gap: the
 * job only succeeds once the live deployment is the commit it pushed, and it
 * re-requests the build itself instead of someone retrying an old run.
 *
 * Needs GITHUB_TOKEN (pages: write, deployments: read) and GITHUB_REPOSITORY.
 */

export interface PagesBuild {
	status: "queued" | "building" | "built" | "errored" | string;
	commit: string | null;
	error?: string | null;
}

export interface CheckState {
	/** The commit this run published (or found as head). */
	target: string;
	/** Current head of `gh-pages`. */
	head: string;
	/** Latest Pages build, as reported by the Pages API. */
	build: PagesBuild | null;
	/** Latest deployment status of `target` in the github-pages environment. */
	deployment: "success" | "failure" | "error" | "in_progress" | "queued" | "pending" | "inactive" | null;
	/** Seconds since the check started. */
	elapsed: number;
	/** Seconds since the last build request (or since the start). */
	sinceRequest: number;
	/** Build requests made so far. */
	requests: number;
}

export type Step =
	| { kind: "done"; reason: string }
	| { kind: "superseded"; reason: string }
	| { kind: "request-build"; reason: string }
	| { kind: "wait"; reason: string }
	| { kind: "fail"; reason: string };

export const LIMITS = {
	/** Give up after this long. */
	timeout: 15 * 60,
	/** Request a build when nothing has happened for this long. */
	stall: 4 * 60,
	/** Build requests per run. */
	maxRequests: 3,
};

/** Pure decision for one polling round. */
export function nextStep(s: CheckState): Step {
	if (s.head !== s.target) {
		return {
			kind: "superseded",
			reason: `gh-pages avançou para ${s.head.slice(0, 7)}; a execução que publicou esse commit verifica o deploy dele`,
		};
	}
	if (s.deployment === "success") {
		return { kind: "done", reason: `Pages servindo ${s.target.slice(0, 7)}` };
	}
	if (s.elapsed >= LIMITS.timeout) {
		return {
			kind: "fail",
			reason: `Pages não publicou ${s.target.slice(0, 7)} em ${LIMITS.timeout / 60} min`,
		};
	}

	const ours = s.build?.commit === s.target;
	const failed =
		(ours && s.build?.status === "errored") ||
		s.deployment === "failure" ||
		s.deployment === "error";
	// Nothing for our commit after a while: a build of an older commit may be
	// the one that went live (or the push never triggered a build).
	const stalled = !ours && s.sinceRequest >= LIMITS.stall;

	if (failed || stalled) {
		if (s.requests >= LIMITS.maxRequests) {
			return {
				kind: "fail",
				reason: `Pages falhou após ${s.requests} novas tentativas (${s.build?.error ?? s.deployment ?? "sem build do commit"})`,
			};
		}
		return {
			kind: "request-build",
			reason: failed
				? `build de ${s.target.slice(0, 7)} falhou (${s.build?.error ?? s.deployment})`
				: `nenhum build de ${s.target.slice(0, 7)} em ${Math.round(s.sinceRequest / 60)} min`,
		};
	}
	return {
		kind: "wait",
		reason: `build ${s.build?.status ?? "?"} de ${s.build?.commit?.slice(0, 7) ?? "?"}, deploy ${s.deployment ?? "ainda não criado"}`,
	};
}

// ---------------------------------------------------------------------------
// Runner (GitHub REST API)
// ---------------------------------------------------------------------------

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...init.headers,
		},
	});
	if (!res.ok) {
		throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
	}
	return (res.status === 204 ? null : await res.json()) as T;
}

async function headOfGhPages(): Promise<string> {
	const branch = await api<{ commit: { sha: string } }>("/branches/gh-pages");
	return branch.commit.sha;
}

async function latestBuild(): Promise<PagesBuild | null> {
	try {
		const b = await api<{ status: string; commit: string | null; error?: { message: string | null } }>(
			"/pages/builds/latest",
		);
		return { status: b.status, commit: b.commit, error: b.error?.message ?? null };
	} catch (err) {
		console.warn(`[pages] builds/latest indisponível: ${err}`);
		return null;
	}
}

async function deploymentState(sha: string): Promise<CheckState["deployment"]> {
	const deployments = await api<Array<{ id: number }>>(
		`/deployments?environment=github-pages&sha=${sha}&per_page=5`,
	);
	for (const d of deployments) {
		const statuses = await api<Array<{ state: CheckState["deployment"] }>>(
			`/deployments/${d.id}/statuses?per_page=1`,
		);
		if (statuses[0]?.state) return statuses[0].state;
	}
	return null;
}

async function main(): Promise<void> {
	const target = process.argv[2];
	if (!target || !process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
		console.error("Uso: GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo bun run scripts/pages-deploy.ts <sha>");
		process.exit(2);
	}
	const started = Date.now();
	let lastRequest = started;
	let requests = 0;
	for (;;) {
		const now = Date.now();
		const state: CheckState = {
			target,
			head: await headOfGhPages(),
			build: await latestBuild(),
			deployment: await deploymentState(target),
			elapsed: (now - started) / 1000,
			sinceRequest: (now - lastRequest) / 1000,
			requests,
		};
		const step = nextStep(state);
		console.log(`[pages] ${step.kind}: ${step.reason}`);
		switch (step.kind) {
			case "done":
			case "superseded":
				return;
			case "fail":
				process.exit(1);
				break;
			case "request-build":
				await api("/pages/builds", { method: "POST" });
				requests++;
				lastRequest = Date.now();
				break;
			case "wait":
				break;
		}
		await Bun.sleep(15_000);
	}
}

if (import.meta.main) {
	await main();
}
