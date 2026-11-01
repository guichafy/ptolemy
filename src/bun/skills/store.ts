import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AgentKind } from "@/shared/agent-protocol";
import type { SkillBundle, SkillSummary } from "@/shared/skills";
import { writeJsonAtomic } from "../atomic-json";
import { ptolemyDataDir } from "../paths";
import { downloadGithubSkill } from "./github";
import { readNativeDocument, readNativeFiles } from "./native";
import { validateBundle, validateSkill } from "./validation";

interface RegisteredSkill extends SkillBundle {
	id: string;
	defaultFor: AgentKind[];
}
interface SkillIndex {
	version: 1;
	skills: RegisteredSkill[];
	defaults?: Partial<Record<AgentKind, string[]>>;
}
interface StoreOptions {
	root?: string;
	download?: typeof downloadGithubSkill;
	harnessRoots?: Record<AgentKind, string[]>;
}

function summary(skill: RegisteredSkill): SkillSummary {
	return {
		id: skill.id,
		name: skill.name,
		description: skill.description,
		source: skill.source,
		defaultFor: skill.defaultFor,
	};
}

export class SkillsStore {
	private readonly root: string;
	private readonly download: typeof downloadGithubSkill;
	private readonly harnessRoots: Record<AgentKind, string[]>;
	private queue: Promise<void> = Promise.resolve();
	constructor(options: StoreOptions = {}) {
		this.root = options.root ?? join(ptolemyDataDir(), "skills");
		this.download = options.download ?? downloadGithubSkill;
		const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
		this.harnessRoots = options.harnessRoots ?? {
			claude: [
				join(
					process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
					"skills",
				),
			],
			codex: [
				join(homedir(), ".agents", "skills"),
				join(codexHome, "skills"),
				join(codexHome, "skills", ".system"),
				"/etc/codex/skills",
			],
		};
	}

	async list(agent: AgentKind): Promise<SkillSummary[]> {
		if (agent !== "claude" && agent !== "codex")
			throw new Error("Agente inválido.");
		const index = await this.read();
		const native: SkillSummary[] = [];
		const seen = new Set<string>();
		for (const root of this.harnessRoots[agent]) {
			for (const path of await this.discover(root)) {
				if (seen.has(path)) continue;
				seen.add(path);
				try {
					const metadata = validateSkill(
						await readNativeDocument(path),
						basename(dirname(path)),
						true,
					);
					let unavailableReason: string | undefined;
					try {
						validateBundle({
							...metadata,
							files: await readNativeFiles(dirname(path)),
							source: { kind: "harness", agent },
						});
					} catch (error) {
						unavailableReason =
							error instanceof Error
								? error.message
								: "Skill local indisponível.";
					}
					native.push({
						...metadata,
						id: `harness:${createHash("sha256").update(path).digest("hex")}`,
						source: { kind: "harness", agent },
						defaultFor: unavailableReason ? [] : [agent],
						origin:
							root.endsWith("/.system") || root === "/etc/codex/skills"
								? "system"
								: "local",
						localPath: path,
						...(unavailableReason ? { unavailableReason } : {}),
					});
				} catch (error) {
					native.push({
						id: `harness:${createHash("sha256").update(path).digest("hex")}`,
						name: basename(dirname(path)),
						description: "Skill local indisponível.",
						source: { kind: "harness", agent },
						defaultFor: [],
						origin:
							root.endsWith("/.system") || root === "/etc/codex/skills"
								? "system"
								: "local",
						localPath: path,
						unavailableReason:
							error instanceof Error
								? error.message
								: "Metadados locais inválidos.",
					});
				}
			}
		}
		const result = [...native, ...index.skills.map(summary)];
		if (index.defaults) {
			for (const skill of result) {
				for (const kind of ["claude", "codex"] as const) {
					const defaults = index.defaults[kind];
					if (defaults !== undefined)
						skill.defaultFor = [
							...skill.defaultFor.filter((a) => a !== kind),
							...(defaults.includes(skill.id) && !skill.unavailableReason
								? [kind]
								: []),
						];
				}
			}
		}
		return result;
	}

	async importGithub(url: string): Promise<SkillSummary> {
		const bundle = await this.download(url);
		validateBundle(bundle);
		const skill: RegisteredSkill = {
			...bundle,
			id: crypto.randomUUID(),
			defaultFor: [],
		};
		await this.mutate((index) => {
			if (index.skills.some((item) => item.name === skill.name))
				throw new Error(`A Skill ${skill.name} já está cadastrada.`);
			if (index.skills.length >= 128)
				throw new Error("O catálogo já contém 128 Skills.");
			index.skills.push(skill);
		});
		return summary(skill);
	}

	async setDefaults(agent: AgentKind, ids: string[]): Promise<void> {
		if (agent !== "claude" && agent !== "codex")
			throw new Error("Agente inválido.");
		await this.resolveForSession(agent, ids);
		await this.mutate((index) => {
			index.defaults ??= {};
			index.defaults[agent] = [...new Set(ids)];
			for (const skill of index.skills)
				skill.defaultFor = [
					...skill.defaultFor.filter((value) => value !== agent),
					...(ids.includes(skill.id) ? [agent] : []),
				];
		});
	}

	async resolve(ids: string[]): Promise<RegisteredSkill[]> {
		return this.select(await this.read(), ids);
	}

	async resolveForSession(
		agent: AgentKind,
		ids: string[],
	): Promise<Array<SkillBundle & { id: string }>> {
		if (
			!Array.isArray(ids) ||
			ids.length > 128 ||
			ids.some((id) => typeof id !== "string")
		)
			throw new Error("Seleção de Skills inválida.");
		const index = await this.read();
		const catalog = await this.list(agent);
		const selected: Array<SkillBundle & { id: string }> = [];
		const names = new Set<string>();
		for (const id of new Set(ids)) {
			const skill = catalog.find((item) => item.id === id);
			if (!skill) throw new Error("Skill não encontrada no catálogo.");
			if (skill.unavailableReason) throw new Error(skill.unavailableReason);
			if (names.has(skill.name))
				throw new Error(`Skills com mesmo nome na seleção: ${skill.name}.`);
			names.add(skill.name);
			const bundle =
				skill.source.kind === "harness"
					? {
							id,
							name: skill.name,
							description: skill.description,
							source: skill.source,
							files: await readNativeFiles(dirname(skill.localPath!)),
						}
					: index.skills.find((item) => item.id === id)!;
			validateBundle(bundle);
			selected.push(bundle);
		}
		return selected;
	}

	async defaults(agent: AgentKind): Promise<string[]> {
		return (await this.list(agent))
			.filter(
				(skill) => skill.defaultFor.includes(agent) && !skill.unavailableReason,
			)
			.map((skill) => skill.id);
	}

	/** Include even unreadable/incompatible entries so disabled paths cannot rediscover them. */
	async nativePaths(agent: AgentKind, cwd?: string): Promise<string[]> {
		const roots = new Set(this.harnessRoots[agent]);
		if (agent === "codex" && cwd) {
			let directory = cwd;
			while (true) {
				roots.add(join(directory, ".agents", "skills"));
				const parent = dirname(directory);
				if (parent === directory) break;
				directory = parent;
			}
		}
		const paths = new Set<string>();
		for (const root of roots)
			for (const path of await this.discover(root)) paths.add(path);
		return [...paths];
	}

	private async discover(root: string): Promise<string[]> {
		const paths: string[] = [];
		const visited = new Set<string>();
		let entriesSeen = 0;
		async function visit(directory: string, depth: number): Promise<void> {
			if (depth > 16)
				throw new Error(
					"Inventário de Skills excede o limite de profundidade.",
				);
			const canonical = await realpath(directory).catch(() => null);
			if (!canonical || visited.has(canonical)) return;
			visited.add(canonical);
			if (
				depth &&
				(await stat(join(directory, "SKILL.md")).then(
					(s) => s.isFile(),
					() => false,
				))
			) {
				paths.push(join(directory, "SKILL.md"));
				return;
			}
			for (const entry of await readdir(directory, {
				withFileTypes: true,
			}).catch(() => [])) {
				if (++entriesSeen > 16384)
					throw new Error("Inventário de Skills excede o limite de arquivos.");
				if (
					(entry.isDirectory() || entry.isSymbolicLink()) &&
					!entry.name.startsWith(".")
				)
					await visit(join(directory, entry.name), depth + 1);
			}
		}
		await visit(root, 0);
		return paths;
	}

	private select(index: SkillIndex, ids: string[]): RegisteredSkill[] {
		if (
			!Array.isArray(ids) ||
			ids.length > 128 ||
			ids.some((id) => typeof id !== "string")
		)
			throw new Error("Seleção de Skills inválida.");
		return [...new Set(ids)].map((id) => {
			const skill = index.skills.find((item) => item.id === id);
			if (!skill) throw new Error("Skill não encontrada no catálogo.");
			return skill;
		});
	}

	private async read(): Promise<SkillIndex> {
		let text: string;
		try {
			text = await readFile(join(this.root, "index.json"), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return { version: 1, skills: [] };
			throw error;
		}
		const data: SkillIndex = JSON.parse(text);
		if (
			data.version !== 1 ||
			!Array.isArray(data.skills) ||
			data.skills.length > 128
		)
			throw new Error("Catálogo de Skills inválido.");
		const ids = new Set<string>();
		const names = new Set<string>();
		for (const skill of data.skills) {
			validateBundle(skill);
			if (skill.source.kind !== "github")
				throw new Error("Origem inválida no catálogo importado.");
			if (
				typeof skill.id !== "string" ||
				!/^[a-f0-9-]{36}$/.test(skill.id) ||
				ids.has(skill.id) ||
				names.has(skill.name) ||
				!Array.isArray(skill.defaultFor) ||
				skill.defaultFor.some(
					(agent) => agent !== "claude" && agent !== "codex",
				)
			)
				throw new Error("Registro de Skill inválido.");
			ids.add(skill.id);
			names.add(skill.name);
		}
		if (
			data.defaults !== undefined &&
			(!data.defaults ||
				typeof data.defaults !== "object" ||
				Object.entries(data.defaults).some(
					([agent, ids]) =>
						!["claude", "codex"].includes(agent) ||
						!Array.isArray(ids) ||
						ids.length > 128 ||
						ids.some((id) => typeof id !== "string"),
				))
		)
			throw new Error("Padrões de Skills inválidos.");
		return data;
	}

	private async mutate(apply: (index: SkillIndex) => void): Promise<void> {
		const next = this.queue.then(async () => {
			const index = await this.read();
			apply(index);
			await writeJsonAtomic(join(this.root, "index.json"), index);
		});
		this.queue = next.catch(() => {});
		return next;
	}
}

export const skillsStore = new SkillsStore();
