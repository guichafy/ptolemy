import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
			const entries = await readdir(root, { withFileTypes: true }).catch(
				() => [],
			);
			for (const entry of entries) {
				if (
					(!entry.isDirectory() && !entry.isSymbolicLink()) ||
					entry.name.startsWith(".")
				)
					continue;
				try {
					// Discovery reads metadata only. Claude's compatible user Skills
					// are copied later, when preparing the isolated session plugin.
					const path = join(root, entry.name, "SKILL.md");
					const text = await readNativeDocument(path);
					const metadata = validateSkill(text, entry.name, true);
					if (seen.has(metadata.name)) continue;
					seen.add(metadata.name);
					let unavailableReason: string | undefined;
					if (agent === "claude") {
						try {
							const files = await readNativeFiles(join(root, entry.name));
							validateBundle({
								...metadata,
								files,
								source: { kind: "harness", agent },
							});
						} catch (error) {
							unavailableReason =
								error instanceof Error
									? error.message
									: "Skill local indisponível.";
						}
					}
					native.push({
						...metadata,
						id: `harness:${createHash("sha256").update(path).digest("hex")}`,
						source: { kind: "harness", agent },
						defaultFor: unavailableReason ? [] : [agent],
						...(unavailableReason ? { unavailableReason } : {}),
					});
				} catch {
					/* CLI-owned extensions may use a different format. */
				}
			}
		}
		return [...native, ...index.skills.map(summary)];
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
		await this.mutate((index) => {
			this.select(index, ids);
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
		const selected = await this.resolve(ids);
		// Codex discovers its user/system Skills itself. Claude SDK isolation
		// excludes user settings, so mirror user Skills into our isolated plugin.
		if (agent !== "claude") return selected;
		const native = (await this.list(agent)).filter(
			(skill) => skill.source.kind === "harness" && !skill.unavailableReason,
		);
		const bundles: Array<SkillBundle & { id: string }> = [];
		for (const skill of native) {
			if (selected.some((item) => item.name === skill.name))
				throw new Error(`A Skill ${skill.name} já existe no harness.`);
			for (const root of this.harnessRoots.claude) {
				const id = `harness:${createHash("sha256")
					.update(join(root, skill.name, "SKILL.md"))
					.digest("hex")}`;
				if (id !== skill.id) continue;
				const bundle = {
					...skill,
					files: await readNativeFiles(join(root, skill.name)),
				};
				validateBundle(bundle);
				bundles.push(bundle);
			}
		}
		return [...bundles, ...selected];
	}

	async defaults(agent: AgentKind): Promise<string[]> {
		return (await this.read()).skills
			.filter((skill) => skill.defaultFor.includes(agent))
			.map((skill) => skill.id);
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
