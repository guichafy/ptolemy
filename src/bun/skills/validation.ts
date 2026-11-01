import { parseDocument } from "yaml";
import type { SkillBundle } from "@/shared/skills";

export const MAX_FILES = 128;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_SKILL_BYTES = 5 * MAX_FILE_BYTES;
export const MAX_DOCUMENT_BYTES = 256 * 1024;

export function safeSkillPath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 512 &&
		!path.includes("\\") &&
		![...path].some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		) &&
		path
			.split("/")
			.every(
				(part) =>
					part.length > 0 &&
					part !== "." &&
					part !== ".." &&
					part.toLowerCase() !== ".git",
			)
	);
}

export function validateSkill(
	text: string,
	directory: string,
	native = false,
): { name: string; description: string } {
	if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES)
		throw new Error("SKILL.md excede 256 KiB.");
	const match = text
		.replace(/^\uFEFF/, "")
		.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match)
		throw new Error("SKILL.md precisa de frontmatter YAML entre linhas ---.");
	const document = parseDocument(match[1], { uniqueKeys: true });
	if (document.errors.length)
		throw new Error(`YAML inválido: ${document.errors[0].message}`);
	if (document.warnings.length)
		throw new Error("YAML contém tags não suportadas.");
	let data: Record<string, unknown>;
	try {
		data = document.toJS({ maxAliasCount: 0 });
	} catch {
		throw new Error("Aliases YAML não são aceitos em Skills.");
	}
	if (!data || typeof data !== "object" || Array.isArray(data))
		throw new Error("Frontmatter precisa ser um mapa YAML.");
	const allowedKeys = [
		"name",
		"description",
		"license",
		"compatibility",
		"metadata",
		"allowed-tools",
	];
	if (!native && Object.keys(data).some((key) => !allowedKeys.includes(key)))
		throw new Error(
			"Frontmatter contém campos fora da especificação Agent Skills.",
		);
	const { name, description } = data;
	if (
		typeof name !== "string" ||
		name.length > 64 ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
	)
		throw new Error(
			"Nome da Skill inválido: use até 64 letras minúsculas, números e hífens simples.",
		);
	if (name !== directory)
		throw new Error("O nome da Skill deve coincidir com o nome da pasta.");
	if (
		typeof description !== "string" ||
		!description.trim() ||
		description.length > 1024
	)
		throw new Error("Descrição deve conter de 1 a 1024 caracteres.");
	if (native) return { name, description };
	for (const key of ["license", "compatibility", "allowed-tools"]) {
		if (
			key in data &&
			(typeof data[key] !== "string" || !(data[key] as string).trim())
		)
			throw new Error(`${key} deve ser texto não vazio.`);
	}
	if (typeof data.compatibility === "string" && data.compatibility.length > 500)
		throw new Error("compatibility deve ter até 500 caracteres.");
	if (
		"metadata" in data &&
		(!data.metadata ||
			typeof data.metadata !== "object" ||
			Array.isArray(data.metadata) ||
			Object.values(data.metadata).some((value) => typeof value !== "string"))
	)
		throw new Error("metadata deve mapear chaves para textos.");
	return { name, description };
}

/** Revalidate persisted data before any path reaches filesystem writes. */
export function validateBundle(bundle: SkillBundle): void {
	if (
		!bundle ||
		!Array.isArray(bundle.files) ||
		!bundle.files.length ||
		bundle.files.length > MAX_FILES
	)
		throw new Error("Quantidade de arquivos da Skill inválida.");
	const paths = new Set<string>();
	let total = 0;
	for (const file of bundle.files) {
		if (typeof file.path !== "string" || !safeSkillPath(file.path))
			throw new Error("Caminho inseguro na Skill.");
		const normalized = file.path.normalize("NFC").toLowerCase();
		if (paths.has(normalized))
			throw new Error("Arquivos com caminhos duplicados na Skill.");
		paths.add(normalized);
		if (
			typeof file.content !== "string" ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
				file.content,
			)
		)
			throw new Error("Conteúdo de arquivo inválido.");
		const size = Buffer.byteLength(file.content, "base64");
		if (size > MAX_FILE_BYTES)
			throw new Error("Arquivo da Skill excede 1 MiB.");
		total += size;
	}
	for (const path of paths) {
		const parts = path.split("/");
		for (let depth = 1; depth < parts.length; depth++) {
			if (paths.has(parts.slice(0, depth).join("/")))
				throw new Error("Conflito entre arquivo e diretório na Skill.");
		}
	}
	if (total > MAX_SKILL_BYTES) throw new Error("Skill excede 5 MiB.");
	const doc = bundle.files.find((file) => file.path === "SKILL.md");
	if (!doc) throw new Error("Pasta não contém SKILL.md.");
	const metadata = validateSkill(
		Buffer.from(doc.content, "base64").toString("utf8"),
		bundle.name,
		bundle.source?.kind === "harness",
	);
	if (metadata.description !== bundle.description)
		throw new Error("Metadados da Skill inconsistentes.");
	if (bundle.source?.kind === "github") {
		if (!/^[a-f0-9]{40}$/.test(bundle.source.commit))
			throw new Error("Revisão da Skill inválida.");
	} else if (
		bundle.source?.kind !== "harness" ||
		!["claude", "codex"].includes(bundle.source.agent)
	)
		throw new Error("Origem da Skill inválida.");
}
