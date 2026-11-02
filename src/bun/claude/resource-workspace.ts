import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { AgentKind } from "../../shared/agent-protocol";
import type {
	ExtensionPackage,
	ExtensionSelection,
} from "../../shared/extensions";
import {
	effectiveComponents,
	extensionNamespace,
} from "../extensions/activation";
import { withoutToolGrants } from "../skills/workspace";
import type { FrozenSkill } from "./session-resources";
export type ResourceFiles = Map<string, Map<string, Buffer>>;
async function safe(cwd: string, rel: string) {
	const path = resolve(cwd, rel);
	if (
		!relative(resolve(cwd), path) ||
		relative(resolve(cwd), path).startsWith("..")
	)
		throw Error("Destino de recurso inválido.");
	let current = cwd;
	for (const part of relative(cwd, path).split("/")) {
		current = join(current, part);
		const stat = await lstat(current).catch((e) => {
			if (e.code === "ENOENT") return null;
			throw e;
		});
		if (stat?.isSymbolicLink())
			throw Error("Link simbólico no destino dos recursos.");
	}
	return path;
}
async function tree(root: string, prefix = ""): Promise<Map<string, Buffer>> {
	const stat = await lstat(join(root, prefix));
	if (stat.isSymbolicLink())
		throw Error("Link simbólico nos recursos da conversa.");
	if (stat.isFile())
		return new Map([[prefix, await readFile(join(root, prefix))]]);
	if (!stat.isDirectory())
		throw Error("Arquivo inesperado nos recursos da conversa.");
	const result = new Map<string, Buffer>();
	for (const name of await readdir(join(root, prefix)))
		for (const [path, bytes] of await tree(
			root,
			prefix ? `${prefix}/${name}` : name,
		))
			result.set(path, bytes);
	return result;
}
/** Expected bytes come from immutable archives, not a workspace-owned manifest. */
export async function expectedResourceWorkspace(
	cwd: string,
	agent: AgentKind,
	skills: FrozenSkill[],
	packages: ExtensionPackage[],
	selections: ExtensionSelection[],
	checkOwned = true,
): Promise<ResourceFiles> {
	const roots: ResourceFiles = new Map();
	const harness = new Map<string, Buffer>();
	for (const skill of skills) {
		const files = new Map(
			skill.files.map((f) => [
				f.path,
				f.path === "SKILL.md"
					? withoutToolGrants(Buffer.from(f.content, "base64"))
					: Buffer.from(f.content, "base64"),
			]),
		);
		if (agent === "codex") roots.set(`.agents/skills/${skill.name}`, files);
		else
			for (const [path, bytes] of files)
				harness.set(`skills/${skill.name}/${path}`, bytes);
	}
	if (agent === "claude") {
		harness.set(
			".claude-plugin/plugin.json",
			Buffer.from(
				JSON.stringify(
					{
						name: "ptolemy",
						version: "1.0.0",
						description: "Skills selecionadas para esta conversa",
					},
					null,
					2,
				),
			),
		);
		roots.set(".ptolemy/claude-harness", harness);
	}
	for (const pkg of packages) {
		const selection = selections.find(
			(s) => s.packageId === pkg.id && s.revision === pkg.revision,
		);
		if (!selection?.componentIds.length) continue;
		const components = effectiveComponents(pkg, selection.componentIds, agent);
		const name = extensionNamespace(pkg.id);
		const root = `.ptolemy/extensions/${name}-${pkg.revision}`;
		const files = new Map(
			pkg.files.map((f) => [
				f.path,
				f.path.endsWith("SKILL.md")
					? withoutToolGrants(Buffer.from(f.content, "base64"))
					: Buffer.from(f.content, "base64"),
			]),
		);
		roots.set(root, files);
		const selected = components
			.filter((c) => c.kind === "skill" && c.path)
			.map((c) => c.path!);
		if (!selected.length) continue;
		const replace = (bytes: Buffer) =>
			Buffer.from(
				bytes
					.toString()
					.replace(/\$\{(?:CLAUDE_)?PLUGIN_(ROOT|DATA)\}/g, (_token, kind) =>
						join(
							cwd,
							kind === "ROOT" ? root : `.ptolemy/extensions/${name}-data`,
						),
					),
			);
		if (agent === "codex")
			roots.set(
				`.agents/skills/${name}`,
				new Map(
					[...files]
						.filter(
							([path]) => !path.endsWith("SKILL.md") || selected.includes(path),
						)
						.map(([path, bytes]) => [
							path,
							selected.includes(path) ? replace(bytes) : bytes,
						]),
				),
			);
		else {
			const plugin = new Map(
				[...files]
					.filter(
						([path]) =>
							!(path in pkg.manifests) &&
							![
								".claude-plugin/",
								".codex-plugin/",
								"hooks/",
								"commands/",
								"agents/",
							].some((p) => path.startsWith(p)) &&
							!["settings.json", ".mcp.json", "mcp.json"].includes(path) &&
							(!path.endsWith("SKILL.md") || selected.includes(path)),
					)
					.map(([path, bytes]) => [
						path,
						path.endsWith("SKILL.md")
							? withoutToolGrants(
									replace(
										Buffer.from(
											pkg.files.find((f) => f.path === path)!.content,
											"base64",
										),
									),
								)
							: bytes,
					]),
			);
			plugin.set(
				".claude-plugin/plugin.json",
				Buffer.from(
					JSON.stringify({
						name,
						version: "1.0.0",
						skills: selected.map((p) => `./${dirname(p)}`),
					}),
				),
			);
			roots.set(`.ptolemy/extensions/${name}-claude`, plugin);
		}
	}
	for (const name of [
		agent === "claude"
			? "claude-managed-skills.json"
			: "codex-managed-skills.json",
	]) {
		const rel = `.ptolemy/${name}`;
		const file = await safe(cwd, rel);
		const bytes = await readFile(file).catch((e) => {
			if (e.code === "ENOENT") return null;
			throw e;
		});
		if (!bytes) continue;
		const owned = JSON.parse(bytes.toString());
		if (
			!Array.isArray(owned) ||
			owned.some((n) => typeof n !== "string" || !/^[a-z0-9-]+$/.test(n))
		)
			throw Error("Registro de recursos inválido.");
		if (agent === "codex" && checkOwned)
			for (const n of owned)
				if (
					!roots.has(`.agents/skills/${n}`) &&
					(await lstat(await safe(cwd, `.agents/skills/${n}`)).catch(
						() => null,
					))
				)
					throw Error(
						"Recurso gerenciado inesperado. Revise os arquivos do projeto.",
					);
		roots.set(rel, new Map([["", bytes]]));
	}
	return roots;
}
/** Move only verified generated files out of discovery, keeping DATA and all
 * user-owned paths. The backup lives outside the writable conversation. */
export async function stageManagedResourceWorkspace(
	cwd: string,
	backupRoot: string,
	expected: ResourceFiles,
) {
	const existing = await verifyManagedResourceWorkspace(cwd, expected);
	await mkdir(backupRoot, { recursive: true });
	const backup = await mkdtemp(join(backupRoot, "resources-"));
	const moved: string[] = [];
	const restore = async (newRoots: string[]) => {
		for (const rel of new Set([...newRoots, ...moved]))
			await rm(await safe(cwd, rel), { recursive: true, force: true });
		for (let i = 0; i < moved.length; i++) {
			const target = await safe(cwd, moved[i]);
			await mkdir(dirname(target), { recursive: true });
			await rename(join(backup, String(i)), target);
		}
		await rm(backup, { recursive: true, force: true });
	};
	try {
		for (const rel of existing) {
			await rename(await safe(cwd, rel), join(backup, String(moved.length)));
			moved.push(rel);
		}
	} catch (error) {
		await restore([]);
		throw error;
	}
	return {
		rollback: restore,
		commit: () => rm(backup, { recursive: true, force: true }),
	};
}

export async function verifyManagedResourceWorkspace(
	cwd: string,
	expected: ResourceFiles,
) {
	const existing: string[] = [];
	for (const [rel, files] of expected) {
		const path = await safe(cwd, rel);
		const stat = await lstat(path).catch((e) => {
			if (e.code === "ENOENT") return null;
			throw e;
		});
		if (!stat) continue;
		const actual = await tree(path);
		if (
			actual.size !== files.size ||
			[...files].some(([p, b]) => !actual.get(p)?.equals(b))
		)
			throw Error(
				`Recurso alterado no projeto: ${rel}. Preserve ou restaure suas alterações antes de aplicar.`,
			);
		existing.push(rel);
	}
	return existing;
}
