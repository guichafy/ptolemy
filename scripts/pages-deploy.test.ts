import { describe, expect, it } from "vitest";
import { type CheckState, LIMITS, nextStep } from "./pages-deploy";

const T = "a".repeat(40);
const OLD = "b".repeat(40);

function state(patch: Partial<CheckState>): CheckState {
	return {
		target: T,
		head: T,
		build: { status: "building", commit: T },
		deployment: null,
		elapsed: 30,
		sinceRequest: 30,
		requests: 0,
		...patch,
	};
}

describe("nextStep", () => {
	it("is done once the deployment of our commit succeeded", () => {
		expect(nextStep(state({ deployment: "success" })).kind).toBe("done");
	});

	it("steps aside when a newer commit was published", () => {
		expect(nextStep(state({ head: OLD })).kind).toBe("superseded");
	});

	it("waits while our build runs", () => {
		expect(nextStep(state({})).kind).toBe("wait");
	});

	it("requests a new build when ours errored", () => {
		expect(
			nextStep(state({ build: { status: "errored", commit: T, error: "x" } }))
				.kind,
		).toBe("request-build");
		expect(nextStep(state({ deployment: "failure" })).kind).toBe(
			"request-build",
		);
	});

	// The 2026-11-01 incident: the retried build of an older commit finished
	// last and went live, while gh-pages head was the new site.
	it("requests a build when an older commit is what Pages built", () => {
		const live = { status: "built", commit: OLD };
		expect(nextStep(state({ build: live, sinceRequest: 60 })).kind).toBe(
			"wait",
		);
		expect(
			nextStep(state({ build: live, sinceRequest: LIMITS.stall })).kind,
		).toBe("request-build");
	});

	it("gives up after the retry budget or the timeout", () => {
		expect(
			nextStep(
				state({
					build: { status: "errored", commit: T },
					requests: LIMITS.maxRequests,
				}),
			).kind,
		).toBe("fail");
		expect(nextStep(state({ elapsed: LIMITS.timeout })).kind).toBe("fail");
	});
});
