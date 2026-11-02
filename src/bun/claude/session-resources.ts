import type { McpSnapshot } from "../../shared/mcp";
import type { SkillBundle } from "../../shared/skills";

export type FrozenSkill = SkillBundle & { id: string };
/** A single lifecycle queue matches the manager's single active harness. Turns
 * are tracked separately: an idle Claude async iterator remains alive. */
export class SessionResourceCoordinator {
	private queue: Promise<unknown> = Promise.resolve();
	private turns = new Map<string, number>();
	run<T>(action: () => Promise<T>): Promise<T> {
		const run = this.queue.then(action);
		this.queue = run.catch(() => {});
		return run;
	}
	startTurn(id: string) {
		this.turns.set(id, (this.turns.get(id) ?? 0) + 1);
	}
	finishTurn(id: string) {
		const remaining = (this.turns.get(id) ?? 1) - 1;
		if (remaining > 0) this.turns.set(id, remaining);
		else this.turns.delete(id);
	}
	clear(id: string) {
		this.turns.delete(id);
	}
	busy(id: string) {
		return this.turns.has(id);
	}
	assertEditable(id: string, expected: number, actual: number) {
		if (this.busy(id))
			throw Error("Aguarde a resposta terminar para aplicar a configuração.");
		if (!Number.isSafeInteger(expected) || expected < 0 || expected !== actual)
			throw Error(
				"A configuração foi alterada. Reabra para revisar a seleção atual.",
			);
	}
}
export async function resolveSessionSkills(
	ids: string[],
	previous: FrozenSkill[],
	resolve: (ids: string[]) => Promise<FrozenSkill[]>,
): Promise<FrozenSkill[]> {
	const frozen = new Map(previous.map((s) => [s.id, s]));
	const added = ids.filter((id) => !frozen.has(id));
	const fresh = added.length ? await resolve(added) : [];
	const available = new Map([...fresh, ...previous].map((s) => [s.id, s]));
	const selected = ids.map((id) => {
		const skill = available.get(id);
		if (!skill) throw Error("Skill selecionada indisponível.");
		return structuredClone(skill);
	});
	if (new Set(selected.map((s) => s.name)).size !== selected.length)
		throw Error("Skills com mesmo nome na seleção.");
	return selected;
}
export async function retainSelectedMcp(
	ids: string[],
	previous: McpSnapshot | undefined,
	load: (ids: string[]) => Promise<McpSnapshot>,
): Promise<McpSnapshot> {
	const retained = new Map((previous?.servers ?? []).map((s) => [s.id, s]));
	const added = ids.filter((id) => !retained.has(id));
	const fresh = added.length
		? await load(added)
		: { version: 1 as const, servers: [] };
	const available = new Map(
		[...fresh.servers, ...retained.values()].map((s) => [s.id, s]),
	);
	const servers = ids.map((id) => {
		const server = available.get(id);
		if (!server) throw Error("Servidor MCP indisponível.");
		return structuredClone(server);
	});
	if (new Set(servers.map((s) => s.name)).size !== servers.length)
		throw Error("Servidores MCP com mesmo nome na seleção.");
	return { version: 1, servers };
}
