import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import type {
	ExtensionDiagnostic,
	ExtensionPackage,
	ExtensionSource,
	ExtensionSummary,
} from "@/shared/extensions";
import type { SkillFile } from "@/shared/skills";
import { fetchWithProxy } from "../net/proxy";
import type { GithubFetcher } from "../skills/github";
import {
	canonicalGithubUrl,
	GithubRepository,
	MAX_CATALOG_BYTES,
	relativePath,
} from "./github";
import { normalizePackage, PLUGIN_MANIFESTS } from "./manifests";

const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export interface CatalogItem {
	id: string;
	name: string;
	description: string;
	source: ExtensionSource;
	repository: GithubRepository;
	folder: string;
	externalUrl?: string;
	inline: Record<string, unknown>;
	diagnostics: ExtensionDiagnostic[];
	fetcher: GithubFetcher;
}
export function packageRevision(
	commit: string,
	folder: string,
	inline: Record<string, unknown>,
	files: SkillFile[],
): string {
	return digest(
		`${commit}\0${folder}\0${JSON.stringify(inline)}\0${JSON.stringify(files)}`,
	);
}
export function packageSummary(pkg: ExtensionSummary): ExtensionSummary {
	return {
		id: pkg.id,
		name: pkg.name,
		description: pkg.description,
		sourceId: pkg.sourceId,
		url: pkg.url,
		revision: pkg.revision,
		components: pkg.components.map((c) => {
			const { definition: _definition, ...summary } = c;
			return structuredClone(summary);
		}),
		diagnostics: structuredClone(pkg.diagnostics),
	};
}
export function catalogSummary(item: CatalogItem): ExtensionSummary {
	return {
		id: item.id,
		name: item.name,
		description: item.description,
		sourceId: item.source.id,
		url:
			item.externalUrl ??
			`${item.repository.url}/tree/${item.repository.commit}${item.folder ? `/${item.folder}` : ""}`,
		revision: item.repository.commit,
		components: [],
		diagnostics: structuredClone(item.diagnostics),
	};
}
function sourceDiagnostic(code: string, message: string): ExtensionDiagnostic {
	return { code, message, severity: "error" };
}
function sourceTarget(
	value: unknown,
	repo: GithubRepository,
): {
	folder: string;
	externalUrl?: string;
	identity?: string;
	diagnostics: ExtensionDiagnostic[];
} {
	try {
		if (typeof value === "string") {
			if (value.startsWith("https://"))
				return {
					folder: "",
					externalUrl: canonicalGithubUrl(value),
					identity: canonicalGithubUrl(value),
					diagnostics: [],
				};
			const path = relativePath(value, true);
			return {
				folder: [repo.folder, path].filter(Boolean).join("/"),
				diagnostics: [],
			};
		}
		if (!value || typeof value !== "object" || Array.isArray(value))
			return {
				folder: "",
				diagnostics: [
					sourceDiagnostic(
						"unsupported-source",
						"Formato da fonte não suportado; informe um repositório público GitHub ou caminho local.",
					),
				],
			};
		const entry = value as Record<string, unknown>;
		if (entry.source === "local" && typeof entry.path === "string")
			return {
				folder: [repo.folder, relativePath(entry.path, true)]
					.filter(Boolean)
					.join("/"),
				diagnostics: [],
			};
		if (!["github", "url", "git", "git-subdir"].includes(String(entry.source)))
			return {
				folder: "",
				diagnostics: [
					sourceDiagnostic(
						"unsupported-source",
						"Tipo da fonte não suportado; somente GitHub público e caminhos locais são aceitos.",
					),
				],
			};
		const url =
			typeof entry.url === "string"
				? entry.url
				: typeof entry.repo === "string"
					? `https://github.com/${entry.repo}`
					: "";
		const base = canonicalGithubUrl(url);
		// Explicit SHA pins the external source even when the branch later advances.
		const revision = entry.sha ?? entry.ref;
		if (
			revision !== undefined &&
			(typeof revision !== "string" ||
				!revision ||
				relativePath(revision) !== revision)
		)
			throw new Error();
		if (entry.sha !== undefined && !/^[a-f0-9]{40}$/.test(String(entry.sha)))
			throw new Error();
		const path =
			entry.path === undefined ? "" : relativePath(String(entry.path), true);
		const parsedUrl = new URL(base);
		if (parsedUrl.pathname.split("/").length > 3 && (revision || path))
			throw new Error();
		return {
			folder: "",
			identity: `${base}\0${path}`,
			externalUrl:
				revision || path
					? `${base}/tree/${String(revision ?? "HEAD")
							.split("/")
							.map(encodeURIComponent)
							.join("/")}${path ? `/${path}` : ""}`
					: base,
			diagnostics: [],
		};
	} catch {
		return {
			folder: "",
			diagnostics: [
				sourceDiagnostic(
					"unsafe-source",
					"Fonte contém URL, revisão ou caminho inseguro; nenhuma credencial é aceita.",
				),
			],
		};
	}
}
export async function loadCatalog(
	source: ExtensionSource,
	fetcher: GithubFetcher = fetchWithProxy,
): Promise<CatalogItem[]> {
	const repo = await GithubRepository.open(source.url, fetcher);
	const prefix = repo.folder ? `${repo.folder}/` : "";
	const marketplace = [
		".claude-plugin/marketplace.json",
		".agents/plugins/marketplace.json",
	]
		.map((p) => `${prefix}${p}`)
		.find((p) => repo.has(p));
	const make = (
		name: string,
		description: string,
		target: ReturnType<typeof sourceTarget>,
		inline: Record<string, unknown>,
		entryKey = name,
	): CatalogItem => {
		// Source URLs have no registration UUID: removing/re-adding preserves origin identity.
		const origin = target.identity ?? `${repo.url}/${target.folder}`;
		const id = `extension:${digest(`${canonicalGithubUrl(source.url)}\0${entryKey}\0${origin}`)}`;
		return {
			id,
			name,
			description,
			source,
			repository: repo,
			folder: target.folder,
			...(target.externalUrl ? { externalUrl: target.externalUrl } : {}),
			inline,
			diagnostics: target.diagnostics,
			fetcher,
		};
	};
	if (marketplace) {
		const manifest = await repo.json(marketplace, MAX_CATALOG_BYTES);
		if (!Array.isArray(manifest.plugins) || manifest.plugins.length > 2048)
			throw new Error(
				"Marketplace precisa conter uma lista de até 2048 plugins.",
			);
		const items: CatalogItem[] = [];
		const ids = new Set<string>();
		for (const entry of manifest.plugins) {
			if (
				!entry ||
				typeof entry !== "object" ||
				Array.isArray(entry) ||
				typeof entry.name !== "string" ||
				!entry.name.trim()
			)
				throw new Error("Entrada inválida no marketplace.");
			const item = make(
				entry.name.slice(0, 256),
				typeof entry.description === "string"
					? entry.description.slice(0, 8192)
					: "",
				sourceTarget(entry.source, repo),
				entry,
			);
			if (ids.has(item.id))
				throw new Error(
					"Marketplace contém identidades de plugins duplicadas.",
				);
			ids.add(item.id);
			items.push(item);
		}
		return items;
	}
	const rootManifest = PLUGIN_MANIFESTS.map((p) => `${prefix}${p}`).find((p) =>
		repo.has(p),
	);
	if (rootManifest) {
		const manifest = await repo.json(rootManifest);
		return [
			make(
				typeof manifest.name === "string"
					? manifest.name
					: basename(repo.folder) || repo.repository.split("/")[1],
				typeof manifest.description === "string" ? manifest.description : "",
				{ folder: repo.folder, diagnostics: [] },
				{},
				"@root",
			),
		];
	}
	const docs = repo.entries.filter(
		(e) =>
			e.path.startsWith(prefix) &&
			(e.path === `${prefix}SKILL.md` || e.path.endsWith("/SKILL.md")),
	);
	if (docs.length > 2048) throw new Error("Catálogo excede 2048 Skills.");
	const items: CatalogItem[] = [];
	for (const doc of docs) {
		const folder = dirname(doc.path) === "." ? "" : dirname(doc.path);
		const name = basename(folder) || repo.repository.split("/")[1];
		const file = await repo.read(doc.path);
		const normalized = normalizePackage([{ ...file, path: "SKILL.md" }], name);
		items.push(
			make(
				normalized.name,
				normalized.components[0]?.description ?? "",
				{ folder, diagnostics: normalized.diagnostics },
				{},
				folder,
			),
		);
	}
	if (!items.length)
		throw new Error(
			"Fonte não contém marketplace, plugin.json ou Skills com SKILL.md.",
		);
	return items;
}
export async function inspectCatalogItem(
	item: CatalogItem,
): Promise<ExtensionPackage> {
	if (item.diagnostics.some((d) => d.severity === "error"))
		throw new Error("A fonte deste pacote é incompatível ou insegura.");
	const repo = item.externalUrl
		? await GithubRepository.open(item.externalUrl, item.fetcher)
		: item.repository;
	const folder = item.externalUrl ? repo.folder : item.folder;
	const files = await repo.download(folder);
	const normalized = normalizePackage(files, item.name, item.inline);
	const revision = packageRevision(repo.commit, folder, item.inline, files);
	return {
		id: item.id,
		name: normalized.name,
		description: normalized.description || item.description,
		sourceId: item.source.id,
		url: `${repo.url}/tree/${repo.commit}${folder ? `/${folder}` : ""}`,
		revision,
		components: normalized.components,
		diagnostics: normalized.diagnostics,
		files,
		manifests: normalized.manifests,
		origin: {
			repository: repo.repository,
			path: folder,
			commit: repo.commit,
			catalogUrl: canonicalGithubUrl(item.source.url),
			catalogRevision: item.repository.commit,
			itemId: item.id,
		},
	};
}
