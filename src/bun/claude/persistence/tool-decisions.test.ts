import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../permission-gate";
import { ToolDecisionStore } from "./tool-decisions";

function makeRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
	return {
		sessionId: "s1",
		permissionId: "perm_1",
		toolCallId: "t1",
		toolName: "Bash",
		args: { command: "ls" },
		decision: { behavior: "allow" },
		source: "user-approved",
		decidedAt: Date.parse("2026-04-23T12:00:00Z"),
		risk: { level: "safe", bypassWhitelist: false },
		...overrides,
	};
}

describe("ToolDecisionStore", () => {
	let root: string;
	let store: ToolDecisionStore;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "ptolemy-tool-decisions-"));
		store = new ToolDecisionStore({ sessionsRoot: root });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("creates the session dir lazily and appends a single decision", async () => {
		await store.append("s1", makeRecord());
		const stored = await store.read("s1");
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			version: 1,
			sessionId: "s1",
			permissionId: "perm_1",
			toolName: "Bash",
			source: "user-approved",
			decision: { behavior: "allow" },
			risk: { level: "safe" },
		});
		expect(stored[0].decidedAt).toBe("2026-04-23T12:00:00.000Z");
	});

	it("serialises concurrent appends so no entry is dropped", async () => {
		const writes = Array.from({ length: 10 }, (_, i) =>
			store.append(
				"s1",
				makeRecord({ permissionId: `perm_${i}`, toolCallId: `t${i}` }),
			),
		);
		await Promise.all(writes);
		const stored = await store.read("s1");
		expect(stored).toHaveLength(10);
		const ids = stored.map((s) => s.permissionId).sort();
		expect(ids).toEqual(
			Array.from({ length: 10 }, (_, i) => `perm_${i}`).sort(),
		);
	});

	it("persists deny decisions with the message", async () => {
		await store.append(
			"s1",
			makeRecord({
				source: "user-rejected",
				decision: { behavior: "deny", message: "unsafe" },
			}),
		);
		const stored = await store.read("s1");
		expect(stored[0]).toMatchObject({
			source: "user-rejected",
			decision: { behavior: "deny", message: "unsafe" },
		});
	});

	it("returns [] for a session with no decisions yet", async () => {
		expect(await store.read("missing")).toEqual([]);
	});

	it("isolates decisions across sessions", async () => {
		await store.append("s1", makeRecord({ toolName: "Bash" }));
		await store.append("s2", makeRecord({ sessionId: "s2", toolName: "Read" }));
		expect((await store.read("s1"))[0].toolName).toBe("Bash");
		expect((await store.read("s2"))[0].toolName).toBe("Read");
		expect((await store.read("s2"))[0].sessionId).toBe("s2");
	});
});
