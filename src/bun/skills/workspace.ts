import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseDocument, stringify } from "yaml";
import type { AgentKind } from "@/shared/agent-protocol";
import type { SessionSkill, SkillBundle } from "@/shared/skills";
import { writeJsonAtomic } from "../atomic-json";
import { validateBundle } from "./validation";

export function claudeSkillsPlugin(cwd: string): string {
	return join(cwd, ".ptolemy", "claude-harness");
}

function snapshotPath(root: string, sessionId: string): string {
	if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error("Sessão inválida.");
	return join(root, sessionId, "skills.json");
}

export async function snapshotSkills(
	root: string,
	sessionId: string,
	skills: Array<SkillBundle & { id: string }>,
): Promise<SessionSkill[]> {
	for (const skill of skills) validateBundle(skill);
	await writeJsonAtomic(snapshotPath(root, sessionId), skills);
	return skills.map(({ id, name, source }) => ({ id, name, source }));
}

async function readSnapshot(
	root: string,
	sessionId: string,
): Promise<SkillBundle[]> {
	let text: string;
	try {
		text = await readFile(snapshotPath(root, sessionId), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const bundles: SkillBundle[] = JSON.parse(text);
	if (!Array.isArray(bundles) || bundles.length > 128)
		throw new Error("Snapshot de Skills inválido.");
	const names = new Set<string>();
	for (const bundle of bundles) {
		validateBundle(bundle);
		if (names.has(bundle.name))
			throw new Error("Snapshot contém Skills duplicadas.");
		names.add(bundle.name);
	}
	return bundles;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** Check all existing ancestors; never follow a workspace-controlled symlink. */
async function checkPath(cwd: string, path: string): Promise<void> {
	const rel = relative(resolve(cwd), resolve(path));
	if (rel.startsWith("..") || rel.startsWith("/"))
		throw new Error("Skills devem permanecer no workspace.");
	let current = cwd;
	for (const part of rel.split("/").filter(Boolean)) {
		current = join(current, part);
		if (await exists(current)) {
			const stat = await lstat(current);
			if (stat.isSymbolicLink())
				throw new Error("Link simbólico no destino das Skills.");
		}
	}
}

/** Skill metadata cannot grant tool permissions independently of the gate. */
function withoutToolGrants(content: Buffer): Buffer {
	const text = content.toString("utf8");
	const match = text
		.replace(/^\uFEFF/, "")
		.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return content;
	const data = parseDocument(match[1]).toJS({ maxAliasCount: 0 });
	if (!("allowed-tools" in data) && !("hooks" in data)) return content;
	delete data["allowed-tools"];
	delete data.hooks;
	return Buffer.from(
		`---\n${stringify(data)}---\n${text.replace(/^\uFEFF/, "").slice(match[0].length)}`,
	);
}

async function writeBundles(
	stage: string,
	bundles: SkillBundle[],
): Promise<void> {
	await mkdir(stage, { recursive: true });
	for (const bundle of bundles) {
		for (const file of bundle.files) {
			const path = join(stage, bundle.name, file.path);
			await mkdir(dirname(path), { recursive: true });
			const bytes = Buffer.from(file.content, "base64");
			await writeFile(
				path,
				file.path === "SKILL.md" ? withoutToolGrants(bytes) : bytes,
				{ mode: file.executable ? 0o700 : 0o600 },
			);
		}
	}
}

async function activateClaude(
	cwd: string,
	bundles: SkillBundle[],
): Promise<void> {
	const managedRoot = join(cwd, ".ptolemy");
	const plugin = claudeSkillsPlugin(cwd);
	const ownership = join(managedRoot, "claude-managed-skills.json");
	await checkPath(cwd, plugin);
	await checkPath(cwd, ownership);
	if ((await exists(plugin)) && !(await exists(ownership)))
		throw new Error("Plugin de Skills existente não pertence ao Ptolemy.");
	await mkdir(managedRoot, { recursive: true });
	const stage = await mkdtemp(join(managedRoot, "skills-stage-"));
	let backedUp = false;
	let installed = false;
	try {
		await writeBundles(join(stage, "new", "skills"), bundles);
		await writeJsonAtomic(join(stage, "new", ".claude-plugin", "plugin.json"), {
			name: "ptolemy",
			version: "1.0.0",
			description: "Skills selecionadas para esta conversa",
		});
		// Replace the entire generated plugin: no commands, hooks, MCP config
		// or settings introduced by a previous turn survive a CLI restart.
		if (await exists(plugin)) {
			await rename(plugin, join(stage, "old"));
			backedUp = true;
		}
		await rename(join(stage, "new"), plugin);
		installed = true;
		await writeJsonAtomic(
			ownership,
			bundles.map((bundle) => bundle.name),
		);
	} catch (error) {
		if (installed) await rm(plugin, { recursive: true, force: true });
		if (backedUp) await rename(join(stage, "old"), plugin);
		throw error;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}

/** Called only after the previous agent has stopped, before starting the SDK. */
export async function activateSkills(
	root: string,
	sessionId: string,
	cwd: string,
	agent: AgentKind,
): Promise<void> {
	const bundles = await readSnapshot(root, sessionId);
	if (agent === "claude") return activateClaude(cwd, bundles);
	const managedRoot = join(cwd, ".ptolemy");
	const targetRoot = join(cwd, ".agents");
	const target = join(targetRoot, "skills");
	const manifestPath = join(managedRoot, `${agent}-managed-skills.json`);
	await checkPath(cwd, manifestPath);
	await checkPath(cwd, target);
	let previous: string[] = [];
	if (await exists(manifestPath))
		previous = JSON.parse(await readFile(manifestPath, "utf8"));
	if (
		!Array.isArray(previous) ||
		previous.some(
			(name) =>
				typeof name !== "string" ||
				!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
				name.length > 64,
		)
	)
		throw new Error("Registro de Skills do workspace inválido.");
	previous = [...new Set(previous)];
	for (const name of new Set([
		...previous,
		...bundles.map((bundle) => bundle.name),
	])) {
		await checkPath(cwd, join(target, name));
		if (!previous.includes(name) && (await exists(join(target, name))))
			throw new Error(
				`A Skill ${name} já existe no workspace; escolha outro projeto para preservar a Skill existente.`,
			);
	}
	await mkdir(managedRoot, { recursive: true });
	await mkdir(target, { recursive: true });
	const stage = await mkdtemp(join(managedRoot, "skills-stage-"));
	const backedUp: string[] = [];
	const installed: string[] = [];
	try {
		await writeBundles(join(stage, "new"), bundles);
		await mkdir(join(stage, "old"));
		for (const name of previous) {
			if (await exists(join(target, name))) {
				await rename(join(target, name), join(stage, "old", name));
				backedUp.push(name);
			}
		}
		for (const bundle of bundles) {
			await rename(join(stage, "new", bundle.name), join(target, bundle.name));
			installed.push(bundle.name);
		}
		await writeJsonAtomic(
			manifestPath,
			bundles.map((bundle) => bundle.name),
		);
	} catch (error) {
		for (const name of installed)
			await rm(join(target, name), { recursive: true, force: true });
		for (const name of backedUp)
			await rename(join(stage, "old", name), join(target, name));
		throw error;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
