import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SkillFile } from "@/shared/skills";
import {
	MAX_DOCUMENT_BYTES,
	MAX_FILE_BYTES,
	MAX_FILES,
	MAX_SKILL_BYTES,
	safeSkillPath,
} from "./validation";

export async function readNativeDocument(path: string): Promise<string> {
	const handle = await open(path, "r");
	try {
		if ((await handle.stat()).size > MAX_DOCUMENT_BYTES)
			throw new Error("SKILL.md excede 256 KiB.");
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

/** Copy only Skill files, never user settings or plugin hooks. */
export async function readNativeFiles(root: string): Promise<SkillFile[]> {
	const files: SkillFile[] = [];
	let total = 0;
	async function visit(dir: string, depth: number) {
		if (depth > 16)
			throw new Error("Skill local excede o limite de profundidade.");
		for (const entry of await readdir(join(root, dir), {
			withFileTypes: true,
		})) {
			const path = dir ? `${dir}/${entry.name}` : entry.name;
			if (!safeSkillPath(path) || entry.isSymbolicLink())
				throw new Error(
					"Skill local contém caminho inseguro ou link simbólico.",
				);
			if (entry.isDirectory()) {
				await visit(path, depth + 1);
				continue;
			}
			if (!entry.isFile() || files.length >= MAX_FILES)
				throw new Error("Skill local excede o limite de arquivos.");
			const handle = await open(join(root, path), "r");
			try {
				const stat = await handle.stat();
				total += stat.size;
				if (stat.size > MAX_FILE_BYTES || total > MAX_SKILL_BYTES)
					throw new Error("Skill local excede o limite de tamanho.");
				files.push({
					path,
					content: (await handle.readFile()).toString("base64"),
					executable: (stat.mode & 0o111) !== 0,
				});
			} finally {
				await handle.close();
			}
		}
	}
	await visit("", 0);
	return files;
}
