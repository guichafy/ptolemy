import { describe, expect, it, vi } from "vitest";
import {
	resolveSessionSkills,
	retainSelectedMcp,
	SessionResourceCoordinator,
} from "./session-resources";

const skill = {
	id: "archived",
	name: "original",
	description: "original bytes",
	source: { kind: "harness" as const, agent: "codex" as const },
	files: [{ path: "SKILL.md", content: "b3JpZ2luYWw=", executable: false }],
};
describe("session resource revisions", () => {
	it("keeps the frozen Skill when its source was removed or changed", async () => {
		const resolve = vi.fn(async () => [{ ...skill, id: "new", name: "new" }]);
		const selected = await resolveSessionSkills(
			["archived", "new"],
			[skill],
			resolve,
		);
		expect(selected[0]).toEqual(skill);
		expect(resolve).toHaveBeenCalledWith(["new"]);
		expect(selected.map((s) => s.id)).toEqual(["archived", "new"]);
	});
	it("explicit none removes all Skills without resolving current defaults", async () => {
		const resolve = vi.fn();
		expect(await resolveSessionSkills([], [skill], resolve)).toEqual([]);
		expect(resolve).not.toHaveBeenCalled();
	});
	it("preserves frozen MCP credentials/configuration and resolves only newly added IDs", async () => {
		const frozen = {
			id: "saved",
			name: "Original",
			transport: "stdio" as const,
			command: "old-command",
			defaults: { claude: false, codex: false },
			env: { TOKEN: { secretRef: "private-ref" } },
		};
		const load = vi.fn(async () => ({ version: 1 as const, servers: [] }));
		expect(
			await retainSelectedMcp(
				["saved"],
				{ version: 1, servers: [frozen] },
				load,
			),
		).toEqual({ version: 1, servers: [frozen] });
		expect(load).not.toHaveBeenCalled();
	});
	it("rejects duplicate server names when joining frozen and new MCP entries", async () => {
		const s = {
			id: "a",
			name: "same",
			transport: "stdio" as const,
			command: "test",
			defaults: { claude: false, codex: false },
		};
		await expect(
			retainSelectedMcp(["a", "b"], { version: 1, servers: [s] }, async () => ({
				version: 1,
				servers: [{ ...s, id: "b" }],
			})),
		).rejects.toThrow(/nome/i);
	});
	it("rejects edits during a turn and stale revisions, then allows editing after finish", () => {
		const c = new SessionResourceCoordinator();
		c.startTurn("s");
		expect(() => c.assertEditable("s", 2, 2)).toThrow(/resposta/i);
		c.finishTurn("s");
		expect(() => c.assertEditable("s", 1, 2)).toThrow(/alterada/i);
		expect(() => c.assertEditable("s", 2, 2)).not.toThrow();
	});
	it("serializes lifecycle changes and releases the queue after a failed preparation", async () => {
		const c = new SessionResourceCoordinator();
		const events: string[] = [];
		let release!: () => void;
		const pending = new Promise<void>((r) => {
			release = r;
		});
		const failed = c.run(async () => {
			events.push("prepare");
			await pending;
			throw Error("invalid hook");
		});
		const next = c.run(async () => {
			events.push("send");
		});
		await Promise.resolve();
		expect(events).toEqual(["prepare"]);
		release();
		await expect(failed).rejects.toThrow("invalid hook");
		await next;
		expect(events).toEqual(["prepare", "send"]);
	});
});
