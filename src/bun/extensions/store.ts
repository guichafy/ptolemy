import { createHash } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionPackage,
	ExtensionSelection,
	ExtensionSource,
	ExtensionSummary,
} from "@/shared/extensions";
import type { SkillFile } from "@/shared/skills";
import { writeJsonAtomic } from "../atomic-json";
import { fetchWithProxy } from "../net/proxy";
import { ptolemyDataDir } from "../paths";
import type { GithubFetcher } from "../skills/github";
import {
	catalogSummary,
	inspectCatalogItem,
	loadCatalog,
	packageRevision,
	packageSummary,
} from "./catalog";
import {
	canonicalGithubUrl,
	relativePath,
	validatePackageFiles,
} from "./github";
import { normalizePackage } from "./manifests";
import type { NativePlugin } from "./native";

interface ExtensionIndex {
	version: 1;
	sources: ExtensionSource[];
	packages: ExtensionPackage[];
	installed: Record<string, string>;
	defaults?: Partial<
		Record<
			AgentKind,
			{ selections: ExtensionSelection[]; builtinCommandNames?: string[] }
		>
	>;
}
interface StoreOptions {
	root?: string;
	fetcher?: GithubFetcher;
}
const MAX_INDEX_BYTES = 256 * 1024 * 1024;
const sourceId = (url: string) =>
	`source:${createHash("sha256").update(url).digest("hex")}`;
export const DEFAULT_EXTENSION_SOURCES: ExtensionSource[] = [
	"anthropics/skills",
	"anthropics/claude-plugins-official",
	"openai/plugins",
].map((name) => {
	const url = `https://github.com/${name}`;
	return { id: sourceId(url), name, url, builtin: true };
});
const fatalDiagnostics = new Set([
	"unsafe-reference",
	"nested-reference",
	"embedded-secret",
	"manifest-too-large",
	"invalid-manifest",
]);
function assertInstallable(pkg: ExtensionPackage): void {
	const failure = pkg.diagnostics.find((d) => fatalDiagnostics.has(d.code));
	if (failure)
		throw new Error(
			`Pacote não foi instalado por segurança: ${failure.message}`,
		);
}

/** One queued atomic index publishes complete validated packages and immutable history. */
export class ExtensionsStore {
	private readonly configuredRoot?: string;
	private get root(): string {
		return this.configuredRoot ?? join(ptolemyDataDir(), "extensions");
	}
	private readonly fetcher: GithubFetcher;
	private queue: Promise<void> = Promise.resolve();
	constructor(options: StoreOptions = {}) {
		this.configuredRoot = options.root;
		this.fetcher = options.fetcher ?? fetchWithProxy;
	}
	async sources(): Promise<ExtensionSource[]> {
		await this.queue;
		return structuredClone((await this.read()).sources);
	}
	async defaults(
		agent: AgentKind,
	): Promise<
		| { selections: ExtensionSelection[]; builtinCommandNames?: string[] }
		| undefined
	> {
		await this.queue;
		return structuredClone((await this.read()).defaults?.[agent]);
	}
	async setDefaults(
		agent: AgentKind,
		selections: ExtensionSelection[],
		builtinCommandNames?: string[],
	): Promise<void> {
		if (
			!["claude", "codex"].includes(agent) ||
			!Array.isArray(selections) ||
			selections.length > 128 ||
			(builtinCommandNames !== undefined &&
				(!Array.isArray(builtinCommandNames) ||
					builtinCommandNames.some(
						(n) => typeof n !== "string" || n.length > 256,
					)))
		)
			throw Error("Padrões de extensões inválidos.");
		for (const selection of selections) {
			const pkg = await this.getPackage(
				selection.packageId,
				selection.revision,
			);
			if (
				!Array.isArray(selection.componentIds) ||
				selection.componentIds.some(
					(id) => !pkg.components.some((c) => c.id === id),
				) ||
				(selection.trustedHookDigest !== undefined &&
					selection.trustedHookDigest !== pkg.revision)
			)
				throw Error("Seleção de componentes inválida.");
		}
		await this.mutate((index) => {
			index.defaults ??= {};
			index.defaults[agent] = {
				selections: structuredClone(selections),
				...(builtinCommandNames
					? { builtinCommandNames: [...new Set(builtinCommandNames)] }
					: {}),
			};
		});
	}
	async addSource(input: string): Promise<ExtensionSource> {
		const url = canonicalGithubUrl(input);
		return this.mutate(async (index) => {
			const existing = index.sources.find((s) => s.url === url);
			if (existing) return existing;
			if (index.sources.length >= 128)
				throw new Error("Limite de 128 fontes atingido.");
			const source = {
				id: sourceId(url),
				name: new URL(url).pathname.slice(1),
				url,
			};
			await loadCatalog(source, this.fetcher);
			index.sources.push(source);
			return source;
		});
	}
	async removeSource(id: string): Promise<void> {
		await this.mutate((index) => {
			index.sources = index.sources.filter((s) => s.id !== id);
		});
	}
	async browse(sourceId: string): Promise<ExtensionSummary[]> {
		await this.queue;
		const source = this.source(await this.read(), sourceId);
		return (await loadCatalog(source, this.fetcher)).map(catalogSummary);
	}
	async installed(): Promise<ExtensionSummary[]> {
		await this.queue;
		const index = await this.read();
		return Object.entries(index.installed).map(([id, revision]) =>
			packageSummary(
				index.packages.find((p) => p.id === id && p.revision === revision)!,
			),
		);
	}
	async inspect(sourceId: string, itemId: string): Promise<ExtensionSummary> {
		await this.queue;
		const pkg = await this.inspectItem(await this.read(), sourceId, itemId);
		return packageSummary(pkg);
	}
	async install(sourceId: string, itemId: string): Promise<ExtensionSummary> {
		return this.mutate(async (index) => {
			const pkg = await this.inspectItem(index, sourceId, itemId);
			assertInstallable(pkg);
			if (
				!index.packages.some(
					(p) => p.id === pkg.id && p.revision === pkg.revision,
				)
			) {
				if (index.packages.length >= 512)
					throw new Error("Limite de 512 revisões de pacotes atingido.");
				index.packages.push(pkg);
			}
			index.installed[pkg.id] = pkg.revision;
			return packageSummary(pkg);
		});
	}
	/** Removal hides the package; explicit immutable revisions remain available to existing sessions. */
	async remove(id: string): Promise<void> {
		await this.mutate((index) => {
			delete index.installed[id];
		});
	}
	async getPackage(id: string, revision?: string): Promise<ExtensionPackage> {
		await this.queue;
		const index = await this.read();
		const selected = revision ?? index.installed[id];
		const pkg = index.packages.find(
			(p) => p.id === id && p.revision === selected,
		);
		if (!pkg) throw new Error("Pacote não instalado ou revisão indisponível.");
		return structuredClone(pkg);
	}
	/** Explicit snapshot import from metadata-only CLI inventory, never from arbitrary RPC paths. */
	async importNative(
		agent: AgentKind,
		plugin: NativePlugin,
	): Promise<ExtensionSummary> {
		if (!plugin.path?.startsWith("/"))
			throw Error("Plugin local sem arquivos disponíveis.");
		const root = plugin.path;
		const files: SkillFile[] = [];
		let total = 0;
		async function visit(path: string, depth: number): Promise<void> {
			if (depth > 32 || (await lstat(join(root, path))).isSymbolicLink())
				throw Error("Pacote local contém link ou profundidade excessiva.");
			for (const entry of await readdir(join(root, path), {
				withFileTypes: true,
			})) {
				const name = path ? `${path}/${entry.name}` : entry.name;
				if (entry.isSymbolicLink())
					throw Error("Pacote local contém link simbólico.");
				if (entry.isDirectory()) {
					await visit(name, depth + 1);
					continue;
				}
				const info = await stat(join(root, name));
				total += info.size;
				if (
					!entry.isFile() ||
					files.length >= 2048 ||
					info.size > 8 * 1024 * 1024 ||
					total > 32 * 1024 * 1024
				)
					throw Error("Pacote local excede limites de arquivos.");
				files.push({
					path: name,
					content: (await readFile(join(root, name))).toString("base64"),
					executable: (info.mode & 0o111) !== 0,
				});
			}
		}
		await visit("", 0);
		validatePackageFiles(files);
		const id = `extension:${createHash("sha256").update(`native:${agent}:${plugin.id}`).digest("hex")}`;
		const revision = packageRevision("", "", {}, files);
		const normalized = normalizePackage(files, plugin.name, {});
		const pkg: ExtensionPackage = {
			id,
			sourceId: `native:${agent}`,
			url: root,
			revision,
			files,
			...normalized,
			origin: {
				native: { agent, id: plugin.id, path: root },
				repository: "",
				path: "",
				commit: "",
				catalogUrl: "",
				catalogRevision: "",
				itemId: id,
			},
		};
		assertInstallable(pkg);
		return this.mutate((index) => {
			if (!index.packages.some((p) => p.id === id && p.revision === revision)) {
				if (index.packages.length >= 512)
					throw Error("Limite de 512 revisões de pacotes atingido.");
				index.packages.push(pkg);
			}
			index.installed[id] = revision;
			return packageSummary(pkg);
		});
	}
	private source(index: ExtensionIndex, id: string): ExtensionSource {
		const source = index.sources.find((s) => s.id === id);
		if (!source) throw new Error("Fonte de extensões não encontrada.");
		return source;
	}
	private async inspectItem(
		index: ExtensionIndex,
		sourceId: string,
		itemId: string,
	): Promise<ExtensionPackage> {
		const source = this.source(index, sourceId);
		const catalog = await loadCatalog(source, this.fetcher);
		const item = catalog.find((i) => i.id === itemId);
		if (!item) throw new Error("Pacote não encontrado nesta fonte.");
		return inspectCatalogItem(item);
	}
	private async read(): Promise<ExtensionIndex> {
		const path = join(this.root, "index.json");
		let text: string;
		try {
			if ((await stat(path)).size > MAX_INDEX_BYTES)
				throw new Error("Biblioteca de extensões excede 256 MiB.");
			text = await readFile(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return {
					version: 1,
					sources: structuredClone(DEFAULT_EXTENSION_SOURCES),
					packages: [],
					installed: {},
				};
			throw error;
		}
		const data: ExtensionIndex = JSON.parse(text);
		if (
			data.version !== 1 ||
			!Array.isArray(data.sources) ||
			data.sources.length > 128 ||
			!Array.isArray(data.packages) ||
			data.packages.length > 512 ||
			!data.installed ||
			typeof data.installed !== "object" ||
			Array.isArray(data.installed)
		)
			throw new Error("Biblioteca de extensões inválida.");
		const sourceIds = new Set<string>();
		for (const source of data.sources) {
			if (
				canonicalGithubUrl(source.url) !== source.url ||
				source.id !== sourceId(source.url) ||
				sourceIds.has(source.id) ||
				typeof source.name !== "string"
			)
				throw new Error("Fonte persistida inválida.");
			sourceIds.add(source.id);
		}
		const versions = new Set<string>();
		for (const pkg of data.packages) {
			if (
				!/^extension:[a-f0-9]{64}$/.test(pkg.id) ||
				!/^[a-f0-9]{64}$/.test(pkg.revision) ||
				!pkg.origin ||
				(!pkg.origin.native && !/^[a-f0-9]{40}$/.test(pkg.origin.commit)) ||
				(!pkg.origin.native &&
					!/^[-\w.]+\/[-\w.]+$/.test(pkg.origin.repository)) ||
				typeof pkg.origin.path !== "string" ||
				relativePath(pkg.origin.path, true) !== pkg.origin.path ||
				(!pkg.origin.native &&
					canonicalGithubUrl(pkg.origin.catalogUrl) !==
						pkg.origin.catalogUrl) ||
				(pkg.origin.native &&
					(!["claude", "codex"].includes(pkg.origin.native.agent) ||
						!pkg.origin.native.path.startsWith("/") ||
						typeof pkg.origin.native.id !== "string")) ||
				pkg.origin.itemId !== pkg.id
			)
				throw new Error("Origem ou revisão persistida inválida.");
			validatePackageFiles(pkg.files);
			const inline = pkg.manifests?.["@catalog"] ?? {};
			if (
				packageRevision(
					pkg.origin.commit,
					pkg.origin.path,
					inline,
					pkg.files,
				) !== pkg.revision
			)
				throw new Error("Revisão persistida do pacote foi alterada.");
			const normalized = normalizePackage(pkg.files, pkg.name, inline);
			assertInstallable({ ...pkg, ...normalized });
			// Rebuild executable declarations from validated bytes; never trust serialized component objects.
			pkg.components = normalized.components;
			pkg.diagnostics = normalized.diagnostics;
			pkg.manifests = normalized.manifests;
			const key = `${pkg.id}:${pkg.revision}`;
			if (versions.has(key))
				throw new Error("Revisão duplicada na biblioteca.");
			versions.add(key);
		}
		for (const [id, revision] of Object.entries(data.installed)) {
			if (!data.packages.some((p) => p.id === id && p.revision === revision))
				throw new Error("Pacote instalado sem conteúdo completo.");
		}
		return data;
	}
	private async mutate<T>(
		apply: (index: ExtensionIndex) => T | Promise<T>,
	): Promise<T> {
		const next = this.queue.then(async () => {
			const index = await this.read();
			const result = await apply(index);
			if (Buffer.byteLength(JSON.stringify(index, null, 2)) > MAX_INDEX_BYTES)
				throw new Error("Biblioteca de extensões excede 256 MiB.");
			await writeJsonAtomic(join(this.root, "index.json"), index);
			return structuredClone(result);
		});
		this.queue = next.then(
			() => {},
			() => {},
		);
		return next;
	}
}
export const extensionsStore = new ExtensionsStore();
