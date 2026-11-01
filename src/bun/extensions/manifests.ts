import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { parseDocument } from "yaml";
import type {
	ExtensionComponent,
	ExtensionComponentSource,
	ExtensionDiagnostic,
} from "@/shared/extensions";
import type { SkillFile } from "@/shared/skills";
import {
	MAX_DOCUMENT_BYTES,
	MAX_FILE_BYTES,
	MAX_FILES,
	MAX_SKILL_BYTES,
	validateSkill,
} from "../skills/validation";
import {
	MAX_MANIFEST_BYTES,
	relativePath,
	validatePackageFiles,
} from "./github";

export const PLUGIN_MANIFESTS = [
	".claude-plugin/plugin.json",
	".codex-plugin/plugin.json",
	"plugin.json",
];
export interface NormalizedPackage {
	name: string;
	description: string;
	components: ExtensionComponent[];
	diagnostics: ExtensionDiagnostic[];
	manifests: Record<string, Record<string, unknown>>;
}
function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function frontmatter(text: string): {
	metadata: Record<string, unknown>;
	prompt: string;
} {
	const match = text
		.replace(/^\uFEFF/, "")
		.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return { metadata: {}, prompt: text };
	const doc = parseDocument(match[1], { uniqueKeys: true });
	if (doc.errors.length || doc.warnings.length)
		throw new Error("Frontmatter YAML inválido.");
	const metadata: unknown = doc.toJS({ maxAliasCount: 0 });
	if (!object(metadata))
		throw new Error("Frontmatter precisa ser um mapa YAML.");
	return { metadata, prompt: text.slice(match[0].length) };
}
/** Literal credential-bearing MCP fields must never enter durable package artifacts. */
export function containsLiteralCredential(value: unknown, key = ""): boolean {
	const credential =
		/authorization|api[-_]?key|token|password|secret|credential/i;
	if (typeof value === "string") {
		if (
			credential.test(key) &&
			value.trim() &&
			!/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) &&
			!/^Bearer \$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)
		)
			return true;
		if (key === "url") {
			try {
				const url = new URL(value);
				if (
					url.username ||
					url.password ||
					[...url.searchParams.keys()].some((k) => credential.test(k))
				)
					return true;
			} catch {
				/* Definition validation reports malformed URLs. */
			}
		}
		return false;
	}
	if (Array.isArray(value))
		return value.some((v) => containsLiteralCredential(v, key));
	return (
		object(value) &&
		Object.entries(value).some(([k, v]) => containsLiteralCredential(v, k))
	);
}

/** Preserve source declarations; capability/execution decisions belong to session adapters. */
function normalizeManifest(
	files: SkillFile[],
	fallbackName: string,
	inline: Record<string, unknown> = {},
	selectedManifest?: string,
): NormalizedPackage {
	validatePackageFiles(files);
	const components: ExtensionComponent[] = [];
	const diagnostics: ExtensionDiagnostic[] = [];
	const manifests: NormalizedPackage["manifests"] = {};
	const byPath = new Map(files.map((f) => [f.path, f]));
	const report = (
		code: string,
		message: string,
		path?: string,
		severity: ExtensionDiagnostic["severity"] = "warning",
	): ExtensionDiagnostic => {
		const diagnostic = { code, message, severity, ...(path ? { path } : {}) };
		diagnostics.push(diagnostic);
		return diagnostic;
	};
	const json = (path: string): Record<string, unknown> | undefined => {
		const file = byPath.get(path);
		if (!file) {
			report(
				"missing-reference",
				"Arquivo declarado não existe no pacote.",
				path,
			);
			return;
		}
		if (Buffer.byteLength(file.content, "base64") > MAX_MANIFEST_BYTES) {
			report("manifest-too-large", "Manifest excede 1 MiB.", path, "error");
			return;
		}
		try {
			const value: unknown = JSON.parse(
				Buffer.from(file.content, "base64").toString("utf8"),
			);
			if (!object(value)) throw new Error();
			manifests[path] = value;
			return value;
		} catch {
			report(
				"invalid-manifest",
				"Manifest precisa conter um objeto JSON válido.",
				path,
				"error",
			);
			return;
		}
	};
	let manifest: Record<string, unknown> = {};
	for (const path of selectedManifest ? [selectedManifest] : []) {
		if (byPath.has(path)) {
			const value = json(path);
			if (value && !Object.keys(manifest).length) manifest = value;
		}
	}
	manifest = { ...manifest, ...inline };
	for (const [field, path] of [
		["apps", ".app.json"],
		["lspServers", ".lsp.json"],
		["outputStyles", "output-styles"],
	]) {
		if (
			manifest[field] === undefined &&
			(byPath.has(path) || files.some((f) => f.path.startsWith(`${path}/`)))
		)
			manifest[field] = `./${path}`;
	}
	if (Object.keys(inline).length) manifests["@catalog"] = inline;
	const name =
		typeof manifest.name === "string" && manifest.name.trim()
			? manifest.name.slice(0, 256)
			: fallbackName;
	const description =
		typeof manifest.description === "string"
			? manifest.description.slice(0, 8192)
			: "";
	type LocalComponent<T> = T extends unknown ? Omit<T, "sources"> : never;
	const add = (component: LocalComponent<ExtensionComponent>) => {
		if (!components.some((c) => c.id === component.id))
			components.push({ ...component, sources: [] });
	};
	const resolve = (value: unknown, field: string): string | undefined => {
		if (typeof value !== "string") {
			report(
				"invalid-declaration",
				`${field}: a referência deve ser um caminho relativo.`,
				field,
			);
			return;
		}
		try {
			return relativePath(value, true);
		} catch {
			report(
				"unsafe-reference",
				`${field}: caminho fora da raiz do pacote não é permitido.`,
				field,
				"error",
			);
			return;
		}
	};
	const references = (value: unknown, field: string): string[] => {
		const values = Array.isArray(value) ? value : [value];
		return values.flatMap((v) => {
			const path = resolve(v, field);
			return path === undefined ? [] : [path];
		});
	};
	const skillDocs = files.filter(
		(f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"),
	);
	const selectedSkills =
		manifest.skills === undefined
			? skillDocs
			: references(manifest.skills, "skills").flatMap((path) => {
					const matches = skillDocs.filter(
						(f) =>
							f.path === path ||
							f.path === (path ? `${path}/SKILL.md` : "SKILL.md") ||
							f.path.startsWith(path ? `${path}/` : ""),
					);
					if (!matches.length)
						report(
							"missing-reference",
							"Caminho declarado não contém SKILL.md.",
							path || "skills",
						);
					return matches;
				});
	for (const file of selectedSkills) {
		const root = dirname(file.path) === "." ? "" : dirname(file.path);
		const prefix = root ? `${root}/` : "";
		const id = `skill:${file.path}`;
		try {
			const text = Buffer.from(file.content, "base64").toString("utf8");
			const metadata = validateSkill(
				text,
				root ? basename(root) : fallbackName,
				true,
			);
			const skillFiles = files.filter((f) => f.path.startsWith(prefix));
			if (
				skillFiles.length > MAX_FILES ||
				skillFiles.some(
					(f) => Buffer.byteLength(f.content, "base64") > MAX_FILE_BYTES,
				) ||
				skillFiles.reduce(
					(n, f) => n + Buffer.byteLength(f.content, "base64"),
					0,
				) > MAX_SKILL_BYTES
			)
				throw new Error(
					"Skill excede os limites de 128 arquivos, 1 MiB por arquivo ou 5 MiB por Skill.",
				);
			add({
				id,
				kind: "skill",
				name: metadata.name,
				description: metadata.description,
				path: file.path,
				definition: { metadata: frontmatter(text).metadata },
				diagnostics: [],
			});
		} catch {
			const diagnostic = report(
				"invalid-skill",
				"Skill inválida: verifique o frontmatter, nome, descrição e limites de arquivos (128 arquivos, 1 MiB por arquivo, 5 MiB por Skill, 256 KiB por documento).",
				file.path,
			);
			add({
				id,
				kind: "skill",
				name: root ? basename(root) : fallbackName,
				path: file.path,
				diagnostics: [diagnostic],
			});
		}
	}
	for (const [field, kind] of [
		["commands", "command"],
		["agents", "agent"],
	] as const) {
		const paths =
			manifest[field] === undefined
				? [field]
				: references(manifest[field], field);
		for (const path of paths) {
			const docs = files.filter(
				(f) =>
					f.path.endsWith(".md") &&
					(f.path === path || f.path.startsWith(path ? `${path}/` : "")),
			);
			if (!docs.length && manifest[field] !== undefined)
				report(
					"missing-reference",
					`${field}: nenhum arquivo Markdown encontrado.`,
					path,
				);
			for (const file of docs) {
				const id = `${kind}:${file.path}`;
				try {
					if (Buffer.byteLength(file.content, "base64") > MAX_DOCUMENT_BYTES)
						throw new Error();
					const definition = frontmatter(
						Buffer.from(file.content, "base64").toString("utf8"),
					);
					add({
						id,
						kind,
						name: basename(file.path, ".md"),
						path: file.path,
						definition,
						diagnostics: [],
					});
				} catch {
					const diagnostic = report(
						"invalid-frontmatter",
						`${field}: Markdown/frontmatter inválido ou acima de 256 KiB.`,
						file.path,
					);
					add({
						id,
						kind,
						name: basename(file.path, ".md"),
						path: file.path,
						diagnostics: [diagnostic],
					});
				}
			}
		}
	}
	const loadDeclaration = (
		value: unknown,
		field: string,
	): { value: unknown; path?: string } | undefined => {
		if (typeof value !== "string") return { value };
		const path = resolve(value, field);
		if (path === undefined) return;
		const data = json(path);
		return data ? { value: data, path } : undefined;
	};
	const mcpValues =
		manifest.mcpServers !== undefined
			? [manifest.mcpServers]
			: [...[".mcp.json", "mcp.json"].filter((p) => byPath.has(p))];
	let mcpDeclarationIndex = 0;
	for (const input of mcpValues) {
		for (const value of Array.isArray(input) ? input : [input]) {
			const declarationIndex = mcpDeclarationIndex++;
			const loaded = loadDeclaration(value, "mcpServers");
			if (!loaded) continue;
			const data = loaded.value;
			const servers =
				object(data) && "mcpServers" in data ? data.mcpServers : data;
			if (typeof servers === "string") {
				report(
					"nested-reference",
					"MCP: referências encadeadas não são suportadas.",
					loaded.path,
					"error",
				);
				continue;
			}
			if (!object(servers)) {
				report(
					"invalid-declaration",
					"MCP precisa mapear nomes para definições de servidores.",
					loaded.path,
				);
				continue;
			}
			for (const [server, config] of Object.entries(servers)) {
				const id = `mcp:${encodeURIComponent(server)}@${encodeURIComponent(loaded.path ?? `inline:${declarationIndex}`)}`;
				const ds: ExtensionDiagnostic[] = [];
				if (!object(config)) {
					ds.push(
						report(
							"invalid-declaration",
							"MCP: definição do servidor deve ser um objeto.",
							loaded.path,
						),
					);
				} else {
					if (
						typeof config.command !== "string" &&
						typeof config.url !== "string"
					)
						ds.push(
							report(
								"invalid-mcp-transport",
								"MCP: falta command de stdio ou url de HTTP.",
								loaded.path,
							),
						);
					if (containsLiteralCredential(config))
						ds.push(
							report(
								"embedded-secret",
								"MCP contém credencial literal; use uma referência de ambiente e configure a credencial no Ptolemy.",
								loaded.path,
								"error",
							),
						);
				}
				add({
					id,
					kind: "mcp",
					name: server,
					...(loaded.path ? { path: loaded.path } : {}),
					...(object(config) ? { definition: { config } } : {}),
					diagnostics: ds,
				});
			}
		}
	}
	const hookInputs =
		manifest.hooks !== undefined
			? Array.isArray(manifest.hooks)
				? manifest.hooks
				: [manifest.hooks]
			: byPath.has("hooks/hooks.json")
				? ["hooks/hooks.json"]
				: [];
	let order = 0;
	for (const input of hookInputs) {
		const loaded = loadDeclaration(input, "hooks");
		if (!loaded) continue;
		const data = loaded.value;
		const events = object(data) && "hooks" in data ? data.hooks : data;
		if (typeof events === "string") {
			report(
				"nested-reference",
				"Hooks: referências encadeadas não são suportadas.",
				loaded.path,
				"error",
			);
			continue;
		}
		if (!object(events)) {
			report(
				"invalid-declaration",
				"Hooks precisam mapear eventos para grupos de handlers.",
				loaded.path,
			);
			continue;
		}
		for (const [event, groups] of Object.entries(events)) {
			if (!Array.isArray(groups)) {
				report(
					"invalid-declaration",
					`Hook ${event}: grupos precisam ser uma lista.`,
					loaded.path,
				);
				continue;
			}
			for (const group of groups) {
				if (!object(group) || !Array.isArray(group.hooks)) {
					report(
						"invalid-declaration",
						`Hook ${event}: grupo sem lista hooks.`,
						loaded.path,
					);
					continue;
				}
				for (const handler of group.hooks) {
					const id = `hook:${event}:${order++}`;
					const ds: ExtensionDiagnostic[] = [];
					if (!object(handler)) {
						report(
							"invalid-declaration",
							`Hook ${event}: handler precisa ser um objeto.`,
							loaded.path,
						);
						continue;
					}
					if (
						!["command", "prompt", "agent", "http"].includes(
							String(handler.type),
						)
					)
						ds.push(
							report(
								"unsupported-hook-handler",
								`Hook ${event}: tipo de handler não reconhecido.`,
								loaded.path,
							),
						);
					add({
						id,
						kind: "hook",
						name: event,
						...(loaded.path ? { path: loaded.path } : {}),
						definition: {
							event,
							...(typeof group.matcher === "string"
								? { matcher: group.matcher }
								: {}),
							handler,
							group,
							order: order - 1,
						},
						diagnostics: ds,
					});
				}
			}
		}
	}
	const metadataKeys = new Set([
		"name",
		"description",
		"version",
		"author",
		"homepage",
		"repository",
		"license",
		"keywords",
		"interface",
		"source",
		"strict",
		"category",
		"policy",
		"displayName",
		"owner",
		"tags",
		"dependencies",
		"engines",
		"$schema",
		"skills",
		"commands",
		"agents",
		"hooks",
		"mcpServers",
	]);
	for (const [field, value] of Object.entries(manifest)) {
		if (metadataKeys.has(field)) continue;
		const known = ["apps", "lspServers", "outputStyles"].includes(field);
		let loaded: { value: unknown; path?: string } | undefined = { value };
		if (known && typeof value === "string") {
			const path = resolve(value, field);
			if (path !== undefined) {
				if (byPath.has(path) && path.endsWith(".json"))
					loaded = loadDeclaration(value, field);
				else if (
					byPath.has(path) ||
					files.some((f) => f.path.startsWith(`${path}/`))
				)
					loaded = { value, path };
				else {
					report(
						"missing-reference",
						`${field}: caminho declarado não existe no pacote.`,
						path,
					);
					loaded = { value, path };
				}
			}
		}
		const diagnostic = report(
			known ? "requires-capability" : "unknown-component",
			known
				? `${field}: declaração preservada; ativação exige suporte do runtime ou configuração.`
				: `Campo ${field} preservado; não há adaptador de componente registrado.`,
			field,
		);
		add({
			id: `other:${field}`,
			kind: "other",
			name: field,
			...(loaded?.path ? { path: loaded.path } : {}),
			definition: { type: field, value: loaded?.value ?? value },
			diagnostics: [diagnostic],
		});
	}
	for (const [field, kind] of [
		["skills", "skill"],
		["commands", "command"],
		["agents", "agent"],
		["hooks", "hook"],
		["mcpServers", "mcp"],
	] as const) {
		if (
			manifest[field] !== undefined &&
			!(
				Array.isArray(manifest[field]) &&
				(manifest[field] as unknown[]).length === 0
			) &&
			!components.some((c) => c.kind === kind)
		) {
			const ds = diagnostics.filter((d) => d.path === field);
			if (!ds.length)
				ds.push(
					report(
						"invalid-declaration",
						`${field}: declaração preservada sem componentes utilizáveis.`,
						field,
					),
				);
			add({ id: `${kind}:@declaration`, kind, name: field, diagnostics: ds });
		}
	}
	// Inspect even unselected/default MCP JSON: whole-root artifacts cannot retain literal credentials.
	for (const file of files.filter((f) =>
		/(?:^|\/)(?:\.mcp|mcp)\.json$/.test(f.path),
	)) {
		if (!manifests[file.path]) json(file.path);
	}
	for (const field of [
		"mcpServers",
		"hooks",
		"apps",
		"lspServers",
		"outputStyles",
	]) {
		const declaration = manifest[field];
		for (const value of Array.isArray(declaration)
			? declaration
			: [declaration]) {
			if (typeof value !== "string" || !value.endsWith(".json")) continue;
			const path = resolve(value, field);
			if (path !== undefined && !manifests[path]) json(path);
		}
	}
	// Scan recognized credential fields in all loaded declarations, including inline metadata.
	if (
		Object.values(manifests).some((value) =>
			containsLiteralCredential(value),
		) &&
		!diagnostics.some((d) => d.code === "embedded-secret")
	)
		report(
			"embedded-secret",
			"Manifest contém credencial literal; substitua por referência de ambiente antes de instalar.",
			undefined,
			"error",
		);
	return { name, description, components, diagnostics, manifests };
}

const declarationFor = (component: ExtensionComponent): string =>
	({
		skill: "skills",
		mcp: "mcpServers",
		hook: "hooks",
		command: "commands",
		agent: "agents",
		other: component.name,
	})[component.kind];
function selectors(value: unknown): string[] | undefined {
	if (value === undefined) return;
	return (Array.isArray(value) ? value : [value]).flatMap((item) => {
		if (typeof item !== "string") return [];
		try {
			return [relativePath(item, true)];
		} catch {
			return [];
		}
	});
}
function canonicalDefinition(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map(canonicalDefinition).join(",")}]`;
	if (object(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalDefinition(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "undefined";
}
/** Inventory every harness variant; explicit catalog selectors override all native selectors. */
export function normalizePackage(
	files: SkillFile[],
	fallbackName: string,
	inline: Record<string, unknown> = {},
): NormalizedPackage {
	validatePackageFiles(files);
	const roots = PLUGIN_MANIFESTS.filter((path) =>
		files.some((f) => f.path === path),
	);
	const scopes = roots.length
		? roots
		: [Object.keys(inline).length ? "@catalog" : "@directory"];
	const result: NormalizedPackage = {
		name: fallbackName,
		description: "",
		components: [],
		diagnostics: [],
		manifests: {},
	};
	for (const manifest of scopes) {
		const nativePath = manifest.startsWith("@") ? undefined : manifest;
		const effective = normalizeManifest(
			files,
			fallbackName,
			inline,
			nativePath,
		);
		const original = nativePath ? (effective.manifests[nativePath] ?? {}) : {};
		const harness: ExtensionComponentSource["harness"] = manifest.startsWith(
			".claude-plugin/",
		)
			? "claude"
			: manifest.startsWith(".codex-plugin/")
				? "codex"
				: manifest === "@catalog"
					? "catalog"
					: manifest === "@directory"
						? "directory"
						: "portable";
		const sourceFor = (
			component: ExtensionComponent,
			active: boolean,
		): ExtensionComponentSource => {
			const declaration = declarationFor(component);
			return {
				manifest,
				harness,
				declaration,
				...(component.path ? { configPath: component.path } : {}),
				...(selectors(original.skills) !== undefined
					? { skillPaths: selectors(original.skills) }
					: {}),
				...(selectors(inline.skills) !== undefined
					? { catalogSkillPaths: selectors(inline.skills) }
					: {}),
				...(typeof inline.strict === "boolean"
					? { catalogStrict: inline.strict }
					: {}),
				...(declaration in inline ? { overriddenBy: "@catalog" as const } : {}),
				effective: active,
			};
		};
		const append = (component: ExtensionComponent, active: boolean) => {
			const source = sourceFor(component, active);
			result.components.push({
				...component,
				id: `${harness}:${manifest}:${active ? "effective" : "superseded"}:${component.id}`,
				sources: [source],
			});
		};
		for (const component of effective.components) append(component, true);
		result.diagnostics.push(...effective.diagnostics);
		Object.assign(result.manifests, effective.manifests);
		if (result.name === fallbackName) result.name = effective.name;
		if (!result.description) result.description = effective.description;
		// Inspect every original declaration even when an inline override supersedes it.
		// Keep superseded non-Skill declarations reviewable; Skill siblings stay excluded.
		if (nativePath && Object.keys(inline).length) {
			const raw = normalizeManifest(files, fallbackName, {}, nativePath);
			Object.assign(result.manifests, raw.manifests);
			result.diagnostics.push(
				...raw.diagnostics.filter((d) => d.severity === "error"),
			);
			for (const component of raw.components) {
				const field = declarationFor(component);
				if (component.kind === "skill" || !(field in inline)) continue;
				if (
					effective.components.some(
						(c) =>
							c.kind === component.kind &&
							c.name === component.name &&
							canonicalDefinition(c.definition) ===
								canonicalDefinition(component.definition),
					)
				)
					continue;
				const diagnostic: ExtensionDiagnostic = {
					code: "superseded-declaration",
					message:
						"Declaração original preservada para revisão; o catálogo a substitui neste item.",
					severity: "info",
					path: component.path ?? field,
				};
				result.diagnostics.push(diagnostic);
				append(
					{ ...component, diagnostics: [...component.diagnostics, diagnostic] },
					false,
				);
			}
		}
	}
	const signatures = new Map(
		result.components.map((component) => {
			let definition: unknown = component.definition;
			if (component.kind === "skill" && component.path) {
				const root = dirname(component.path);
				const prefix = root === "." ? "" : `${root}/`;
				definition = [
					definition,
					files
						.filter((file) => file.path.startsWith(prefix))
						.map((file) => ({ ...file, path: file.path.slice(prefix.length) })),
				];
			}
			return [
				component.id,
				createHash("sha256")
					.update(canonicalDefinition(definition))
					.digest("hex"),
			];
		}),
	);
	// Conflicts are review warnings, not installation failures or cross-harness incompatibility.
	for (const component of result.components) {
		if (!component.sources[0].effective || component.kind === "hook") continue;
		const peers = result.components.filter(
			(other) =>
				other !== component &&
				other.sources[0].effective &&
				other.kind === component.kind &&
				other.name === component.name &&
				signatures.get(other.id) !== signatures.get(component.id),
		);
		if (!peers.length) continue;
		const diagnostic: ExtensionDiagnostic = {
			code: "component-conflict",
			message:
				"Há definições diferentes com o mesmo nome; selecione a variante pela origem e pelo agente.",
			severity: "warning",
			path: component.path,
			componentId: component.id,
		};
		component.diagnostics.push(diagnostic);
		result.diagnostics.push(diagnostic);
	}
	result.diagnostics = result.diagnostics.filter(
		(diagnostic, index, list) =>
			list.findIndex(
				(other) =>
					canonicalDefinition(other) === canonicalDefinition(diagnostic),
			) === index,
	);
	return result;
}
