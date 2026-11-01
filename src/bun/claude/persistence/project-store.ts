/**
 * Per-conversation project storage.
 *
 * Each Claude conversation is isolated inside its own directory under
 * `~/.ptolomeu/projects/<projectId>/`. The directory is the agent's cwd —
 * every Write/Edit/Bash call is scoped to it. A single project can host
 * multiple sessions in the future (shared files/memory across sessions),
 * so sessions reference a project by id rather than by path.
 *
 * Layout:
 *   <root>/
 *     index.json           — { version: 1, projects: Project[] }
 *     <id>/                — per-project workspace (agent cwd)
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { backupCorruptJson, writeJsonAtomic } from "../../atomic-json";
import { ptolemyDataDir } from "../../paths";

const SLUG_MAX = 40;
const SHORTID_LEN = 6;

export interface Project {
	id: string;
	name: string;
	path: string;
	createdAt: string;
	updatedAt: string;
}

interface ProjectIndex {
	version: 1;
	projects: Project[];
}

export interface ProjectStoreOptions {
	/** Override the projects root (tests). Defaults to `~/.ptolomeu/projects`. */
	root?: string;
}

export function slugify(input: string): string {
	const cleaned = input
		.normalize("NFD")
		// Strip combining diacritical marks (U+0300–U+036F). Use explicit
		// Unicode escapes so the regex survives editor/encoding round-trips.
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!cleaned) return "projeto";
	return cleaned.slice(0, SLUG_MAX).replace(/-+$/g, "") || "projeto";
}

function shortId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, SHORTID_LEN);
}

export class ProjectStore {
	private readonly root: string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(options: ProjectStoreOptions = {}) {
		this.root = options.root ?? join(ptolemyDataDir(), "projects");
	}

	get rootPath(): string {
		return this.root;
	}

	async create(opts: { title: string }): Promise<Project> {
		const id = `${slugify(opts.title)}-${shortId()}`;
		const path = this.pathFor(id);
		await mkdir(path, { recursive: true });
		const now = new Date().toISOString();
		const project: Project = {
			id,
			name: opts.title.trim() || "Projeto",
			path,
			createdAt: now,
			updatedAt: now,
		};
		await this.mutate((index) => {
			index.projects.push(project);
		});
		return project;
	}

	async get(id: string): Promise<Project | null> {
		if (!this.isSafeId(id)) return null;
		const index = await this.readIndex();
		return index.projects.find((p) => p.id === id) ?? null;
	}

	async list(): Promise<Project[]> {
		const index = await this.readIndex();
		return [...index.projects];
	}

	async delete(id: string): Promise<boolean> {
		if (!this.isSafeId(id)) return false;
		let removed = false;
		await this.mutate((index) => {
			const idx = index.projects.findIndex((p) => p.id === id);
			if (idx === -1) return;
			index.projects.splice(idx, 1);
			removed = true;
		});
		if (removed) {
			await rm(this.pathFor(id), { recursive: true, force: true });
		}
		return removed;
	}

	private pathFor(id: string): string {
		return join(this.root, id);
	}

	private isSafeId(id: string): boolean {
		if (!id) return false;
		const resolved = resolve(this.root, id);
		const rel = relative(this.root, resolved);
		return rel.length > 0 && !rel.startsWith("..") && !rel.includes(sep);
	}

	private indexPath(): string {
		return join(this.root, "index.json");
	}

	private async readIndex(): Promise<ProjectIndex> {
		const path = this.indexPath();
		if (!existsSync(path)) return { version: 1, projects: [] };
		try {
			const parsed = JSON.parse(await readFile(path, "utf8"));
			if (
				parsed &&
				typeof parsed === "object" &&
				parsed.version === 1 &&
				Array.isArray(parsed.projects)
			) {
				return parsed as ProjectIndex;
			}
			await backupCorruptJson(path);
			return { version: 1, projects: [] };
		} catch {
			await backupCorruptJson(path);
			return { version: 1, projects: [] };
		}
	}

	private async mutate(apply: (index: ProjectIndex) => void): Promise<void> {
		const next = this.writeQueue.then(async () => {
			await mkdir(this.root, { recursive: true });
			const index = await this.readIndex();
			apply(index);
			await writeJsonAtomic(this.indexPath(), index);
		});
		this.writeQueue = next.catch(() => {});
		return next;
	}
}
