import { createHash } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionComponent,
	ExtensionDiagnostic,
	ExtensionPackage,
	ExtensionSelection,
} from "@/shared/extensions";
import { ptolemyHome } from "../paths";
import { withoutToolGrants } from "../skills/workspace";
import type { ExtensionAgent } from "./agents";
import { type ComponentCapability, componentCapability } from "./capabilities";
import type { ExtensionCommand } from "./commands";
import type { PreparedHook } from "./hooks";
import { type ExtensionsStore, extensionsStore } from "./store";

export interface ExtensionSkill {
	name: string;
	path: string;
	packageId: string;
	componentId: string;
}
export interface PreparedSessionExtensions {
	explicit: boolean;
	roots: string[];
	claudePlugins: string[];
	skills: ExtensionSkill[];
	hooks: PreparedHook[];
	commands: ExtensionCommand[];
	agents: ExtensionAgent[];
	capabilities: ComponentCapability[];
	diagnostics: ExtensionDiagnostic[];
	mcpComponents: Array<{
		packageId: string;
		revision: string;
		root: string;
		data: string;
		componentId: string;
		name: string;
		config: Record<string, unknown>;
	}>;
}
export const extensionNamespace = (id: string) =>
	`ptolemy-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
async function canonicalLocation(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		return join(await canonicalLocation(dirname(path)), basename(path));
	}
}
async function safeDirectory(cwd: string, path: string) {
	let current = cwd;
	for (const part of path.slice(cwd.length).split("/").filter(Boolean)) {
		current = join(current, part);
		const s = await lstat(current).catch((e) => {
			if (e.code === "ENOENT") return null;
			throw e;
		});
		if (s && (!s.isDirectory() || s.isSymbolicLink()))
			throw Error("Destino de extensão contém link ou arquivo inesperado.");
	}
	await mkdir(path, { recursive: true });
}
function effectiveComponents(
	pkg: ExtensionPackage,
	ids: string[],
	agent: AgentKind,
): ExtensionComponent[] {
	const selected = ids.map((id) => {
		const c = pkg.components.find((c) => c.id === id);
		if (!c) throw Error("Componente selecionado não existe nesta revisão.");
		return c;
	});
	const variants = selected.filter((c) => {
		if (!c.sources.some((s) => s.effective)) return false;
		if (c.sources.some((s) => s.effective && s.harness === agent)) return true;
		return !selected.some(
			(other) =>
				other.kind === c.kind &&
				other.name === c.name &&
				other.sources.some((s) => s.effective && s.harness === agent),
		);
	});
	const unique = new Set<string>();
	return variants.filter((c) => {
		if (c.kind === "hook") return true;
		const canonical = (v: unknown): unknown =>
			Array.isArray(v)
				? v.map(canonical)
				: v && typeof v === "object"
					? Object.fromEntries(
							Object.entries(v)
								.sort(([a], [b]) => a.localeCompare(b))
								.map(([k, v]) => [k, canonical(v)]),
						)
					: v;
		const prefix =
			c.kind === "skill" && c.path ? `${dirname(c.path)}/` : undefined;
		const fingerprint = JSON.stringify(
			canonical({
				kind: c.kind,
				name: c.name,
				definition: c.definition,
				files: prefix
					? pkg.files
							.filter((f) => f.path.startsWith(prefix))
							.map((f) => ({ ...f, path: f.path.slice(prefix.length) }))
					: undefined,
			}),
		);
		if (unique.has(fingerprint)) return false;
		unique.add(fingerprint);
		return true;
	});
}
export async function prepareSessionExtensions(
	sessionId: string,
	cwd: string,
	selection: ExtensionSelection[] | undefined,
	agent: AgentKind,
	deps: {
		store?: Pick<ExtensionsStore, "getPackage">;
		materialize?: boolean;
		executionDirectory?: string;
	} = {},
): Promise<PreparedSessionExtensions> {
	const result: PreparedSessionExtensions = {
		explicit: selection !== undefined,
		roots: [],
		claudePlugins: [],
		skills: [],
		hooks: [],
		commands: [],
		agents: [],
		capabilities: [],
		diagnostics: [],
		mcpComponents: [],
	};
	if (selection === undefined) return result;
	if (
		!/^[a-zA-Z0-9-]+$/.test(sessionId) ||
		!Array.isArray(selection) ||
		selection.length > 128
	)
		throw Error("Seleção de extensões inválida.");
	const names = new Map<string, string>();
	const seen = new Set<string>();
	const packages: Array<{
		entry: ExtensionSelection;
		pkg: ExtensionPackage;
		components: ExtensionComponent[];
	}> = [];
	for (const entry of selection) {
		if (
			!entry ||
			typeof entry.packageId !== "string" ||
			typeof entry.revision !== "string" ||
			!Array.isArray(entry.componentIds) ||
			entry.componentIds.some((id) => typeof id !== "string")
		)
			throw Error("Seleção de extensões inválida.");
		if (seen.has(entry.packageId)) throw Error("Pacote duplicado na seleção.");
		seen.add(entry.packageId);
		const pkg = await (deps.store ?? extensionsStore).getPackage(
			entry.packageId,
			entry.revision,
		);
		const components = effectiveComponents(
			pkg,
			[...new Set(entry.componentIds)],
			agent,
		);
		packages.push({ entry, pkg, components });
	}
	const capability = (
		component: ExtensionComponent,
		entry: ExtensionSelection,
		pkg: ExtensionPackage,
	) => {
		const cap = componentCapability(
			component,
			agent,
			entry.trustedHookDigest === pkg.revision,
		);
		if (
			component.kind === "hook" &&
			component.definition?.handler.type === "prompt" &&
			cap.status === "native" &&
			packages
				.flatMap((p) =>
					p.entry.trustedHookDigest === p.pkg.revision ? p.components : [],
				)
				.filter(
					(c) =>
						c.kind === "hook" &&
						c.definition?.event === component.definition?.event,
				).length > 1
		)
			return {
				...cap,
				status: "incompatible" as const,
				reason:
					"Prompt hook junto de outro handler no mesmo evento não preserva ordem: o runtime nativo agenda callbacks em paralelo.",
			};
		return cap;
	};
	for (const { entry, pkg, components } of packages) {
		for (const component of components) {
			const cap = capability(component, entry, pkg);
			result.capabilities.push({ ...cap, packageId: pkg.id });
			if (
				["incompatible", "requires-configuration"].includes(cap.status) ||
				component.kind === "hook"
			)
				continue;
			const key = `${component.kind}:${component.kind === "skill" ? component.name : component.kind === "agent" ? `${extensionNamespace(pkg.id)}-${component.name}` : `${pkg.name}:${component.name}`}`;
			const definition = JSON.stringify(component.definition);
			if (names.has(key))
				throw Error(`Conflito de componentes selecionados: ${component.name}.`);
			names.set(key, definition);
		}
	}
	if (!packages.some((p) => p.components.length)) return result;
	const managed = join(cwd, ".ptolemy", "extensions");
	if (deps.materialize !== false) await safeDirectory(cwd, managed);
	for (const { entry, pkg, components } of packages) {
		if (!components.length) continue;
		const root = join(managed, `${extensionNamespace(pkg.id)}-${pkg.revision}`);
		if (deps.materialize !== false) {
			const stage = await mkdtemp(join(managed, "stage-"));
			try {
				for (const file of pkg.files) {
					const target = join(stage, file.path);
					await mkdir(dirname(target), { recursive: true });
					const bytes = Buffer.from(file.content, "base64");
					await writeFile(
						target,
						file.path.endsWith("SKILL.md") ? withoutToolGrants(bytes) : bytes,
						{ mode: file.executable ? 0o700 : 0o600 },
					);
				}
				// A fresh snapshot replaces workspace modifications at every cold activation.
				const previous = await lstat(root).catch(() => null);
				if (previous?.isSymbolicLink())
					throw Error("Link simbólico no pacote da sessão.");
				await rm(root, { recursive: true, force: true });
				await rename(stage, root);
			} finally {
				await rm(stage, { recursive: true, force: true });
			}
		}
		// Executable package bytes are outside the writable conversation. The workspace
		// mirror remains available to Skills; hooks/commands use this revision snapshot.
		let executionRoot = root;
		if (
			components.some(
				(c) => c.kind === "hook" || c.kind === "command" || c.kind === "mcp",
			)
		) {
			const base = deps.executionDirectory
				? join(
						await realpath(dirname(deps.executionDirectory)),
						basename(deps.executionDirectory),
					)
				: join(
						await canonicalLocation(resolve(ptolemyHome())),
						".ptolomeu",
						"extensions",
						"execution",
						sessionId,
					);
			const inside = relative(
				await realpath(cwd).catch(() => resolve(cwd)),
				base,
			);
			if (!inside.startsWith("../") && inside !== "..")
				throw Error("Snapshot executável deve ficar fora do projeto.");
			executionRoot = join(
				base,
				`${extensionNamespace(pkg.id)}-${pkg.revision}`,
			);
			if (deps.materialize !== false) {
				await safeDirectory("/", base);
				const stage = await mkdtemp(join(base, "stage-"));
				try {
					for (const file of pkg.files) {
						const target = join(stage, file.path);
						await mkdir(dirname(target), { recursive: true });
						await writeFile(target, Buffer.from(file.content, "base64"), {
							mode: file.executable ? 0o500 : 0o400,
						});
					}
					if ((await lstat(executionRoot).catch(() => null))?.isSymbolicLink())
						throw Error("Link simbólico no snapshot executável.");
					await rm(executionRoot, { recursive: true, force: true });
					await rename(stage, executionRoot);
				} finally {
					await rm(stage, { recursive: true, force: true });
				}
			}
		}
		result.roots.push(root);
		result.diagnostics.push(...pkg.diagnostics);
		const data = join(managed, `${extensionNamespace(pkg.id)}-data`);
		if (deps.materialize !== false) await safeDirectory(cwd, data);
		const promptHooks: Record<string, unknown[]> = {};
		for (const c of components) {
			const cap = capability(c, entry, pkg);
			if (c.kind === "mcp" && c.definition && cap.status !== "incompatible")
				result.mcpComponents.push({
					packageId: pkg.id,
					revision: pkg.revision,
					root: executionRoot,
					data,
					componentId: c.id,
					name: c.name,
					config: c.definition.config,
				});
			if (
				cap.status === "incompatible" ||
				cap.status === "requires-configuration"
			)
				continue;
			if (c.kind === "skill" && c.path)
				result.skills.push({
					name: c.name,
					path: join(root, c.path),
					packageId: pkg.id,
					componentId: c.id,
				});
			if (c.kind === "hook" && c.definition?.handler.type === "prompt") {
				promptHooks[c.definition.event] ??= [];
				promptHooks[c.definition.event].push({
					...(c.definition.matcher ? { matcher: c.definition.matcher } : {}),
					hooks: [c.definition.handler],
				});
			}
			if (c.kind === "hook" && c.definition?.handler.type === "command")
				result.hooks.push({
					cwd,
					root: executionRoot,
					data,
					event: c.definition.event,
					matcher: c.definition.matcher,
					command: c.definition.handler.command as string,
					timeout: Number(
						c.definition.handler.timeout ??
							(agent === "codex" && c.definition.event === "SessionEnd"
								? 1
								: 60),
					),
				});
			if (c.kind === "command" && c.definition)
				result.commands.push({
					name: `${pkg.name}:${c.name}`,
					root: executionRoot,
					data,
					prompt: c.definition.prompt,
					metadata: c.definition.metadata,
				});
			if (c.kind === "agent" && c.definition)
				result.agents.push({
					name: `${extensionNamespace(pkg.id)}-${c.name}`,
					prompt: c.definition.prompt.replace(
						/\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/g,
						() => root,
					),
					metadata: c.definition.metadata,
				});
		}
		if (Object.keys(promptHooks).length && deps.materialize !== false) {
			const plugin = `${executionRoot}-prompt-hooks`;
			await safeDirectory(dirname(plugin), plugin);
			await rm(plugin, { recursive: true, force: true });
			await mkdir(join(plugin, ".claude-plugin"), { recursive: true });
			await mkdir(join(plugin, "hooks"));
			await writeFile(
				join(plugin, ".claude-plugin", "plugin.json"),
				JSON.stringify({
					name: `${extensionNamespace(pkg.id)}-hooks`,
					version: "1.0.0",
				}),
				{ mode: 0o400 },
			);
			await writeFile(
				join(plugin, "hooks", "hooks.json"),
				JSON.stringify({ hooks: promptHooks }),
				{ mode: 0o400 },
			);
			result.claudePlugins.push(plugin);
		}
		if (agent === "codex") {
			const selected = result.skills.filter((s) => s.packageId === pkg.id);
			if (selected.length) {
				const target = join(
					cwd,
					".agents",
					"skills",
					extensionNamespace(pkg.id),
				);
				if (deps.materialize !== false) {
					await safeDirectory(cwd, dirname(target));
					const ownership = join(cwd, ".ptolemy", "codex-managed-skills.json");
					const owned: string[] = JSON.parse(
						await readFile(ownership, "utf8").catch((e) => {
							if (e.code === "ENOENT") return "[]";
							throw e;
						}),
					);
					if (
						(await lstat(target).catch(() => null)) &&
						!owned.includes(extensionNamespace(pkg.id))
					)
						throw Error("Destino da extensão Codex não pertence ao Ptolemy.");
					await rm(target, { recursive: true, force: true });
					await cp(root, target, { recursive: true });
					const allowed = new Set(
						selected.map((s) => s.path.slice(root.length + 1)),
					);
					for (const file of pkg.files)
						if (file.path.endsWith("SKILL.md") && !allowed.has(file.path))
							await rm(join(target, file.path));
					for (const path of allowed) {
						const content = await readFile(join(target, path), "utf8");
						await writeFile(
							join(target, path),
							content.replace(
								/\$\{(?:CLAUDE_)?PLUGIN_(ROOT|DATA)\}/g,
								(_token, kind) => (kind === "ROOT" ? root : data),
							),
						);
					}
					if (!owned.includes(extensionNamespace(pkg.id)))
						owned.push(extensionNamespace(pkg.id));
					await writeFile(ownership, JSON.stringify(owned));
				}
				for (const s of selected)
					s.path = join(target, s.path.slice(root.length + 1));
			}
		}
		if (agent === "claude" && deps.materialize !== false) {
			const selected = result.skills
				.filter((s) => s.packageId === pkg.id)
				.map((s) => s.path.slice(root.length + 1));
			if (selected.length) {
				const plugin = join(managed, `${extensionNamespace(pkg.id)}-claude`);
				await safeDirectory(cwd, plugin);
				await rm(plugin, { recursive: true, force: true });
				await mkdir(plugin);
				for (const file of pkg.files) {
					if (
						file.path in pkg.manifests ||
						file.path.startsWith(".claude-plugin/") ||
						file.path.startsWith(".codex-plugin/") ||
						file.path.startsWith("hooks/") ||
						file.path.startsWith("commands/") ||
						file.path.startsWith("agents/") ||
						["settings.json", ".mcp.json", "mcp.json"].includes(file.path) ||
						(file.path.endsWith("SKILL.md") && !selected.includes(file.path))
					)
						continue;
					const target = join(plugin, file.path);
					await mkdir(dirname(target), { recursive: true });
					const bytes = Buffer.from(file.content, "base64");
					await writeFile(
						target,
						file.path.endsWith("SKILL.md")
							? withoutToolGrants(
									Buffer.from(
										bytes
											.toString()
											.replace(
												/\$\{(?:CLAUDE_)?PLUGIN_(ROOT|DATA)\}/g,
												(_token, kind) => (kind === "ROOT" ? root : data),
											),
									),
								)
							: bytes,
						{ mode: file.executable ? 0o700 : 0o600 },
					);
				}
				await mkdir(join(plugin, ".claude-plugin"), { recursive: true });
				await writeFile(
					join(plugin, ".claude-plugin", "plugin.json"),
					JSON.stringify({
						name: extensionNamespace(pkg.id),
						version: "1.0.0",
						skills: selected.map((p) => `./${dirname(p)}`),
					}),
				);
				result.claudePlugins.push(plugin);
			}
		}
	}
	return result;
}
