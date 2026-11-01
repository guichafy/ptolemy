import type { GithubSkillSource, SkillBundle } from "@/shared/skills";
import { fetchWithProxy } from "../net/proxy";
import {
	MAX_FILE_BYTES,
	MAX_FILES,
	MAX_SKILL_BYTES,
	safeSkillPath,
	validateBundle,
	validateSkill,
} from "./validation";

export type GithubFetcher = (
	url: string,
	init?: RequestInit,
) => Promise<Response>;

export function parseGithubUrl(input: string): {
	owner: string;
	repo: string;
	parts: string[];
	url: string;
} {
	if (
		typeof input !== "string" ||
		input.length > 2048 ||
		/%2e|%5c|\/(?:\.{1,2})(?:\/|$)/i.test(input)
	)
		throw new Error("URL do GitHub inválida.");
	const url = new URL(input.trim());
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.port ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"Use uma URL HTTPS de github.com, sem credenciais ou parâmetros.",
		);
	const parts = url.pathname
		.replace(/^\//, "")
		.replace(/\/$/, "")
		.split("/")
		.map(decodeURIComponent);
	if (
		parts.some((part) => !safeSkillPath(part) || part.includes("/")) ||
		parts.length > 32
	)
		throw new Error("Caminho do GitHub inválido.");
	const [owner, repo, kind, ...rest] = parts;
	if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
		throw new Error("Informe o repositório do GitHub.");
	if (kind && kind !== "tree" && kind !== "blob")
		throw new Error("Use a URL do repositório, de uma pasta ou de SKILL.md.");
	if (kind && !rest.length)
		throw new Error("Informe a revisão e a pasta da Skill.");
	if (kind === "blob" && rest.pop() !== "SKILL.md")
		throw new Error("A URL de arquivo precisa apontar para SKILL.md.");
	return {
		owner,
		repo: repo.replace(/\.git$/, ""),
		parts: rest,
		url: url.toString(),
	};
}

async function readJson(
	response: Response,
	limit: number,
): Promise<Record<string, unknown>> {
	if (!response.body) throw new Error("Resposta vazia do GitHub.");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit)
				throw new Error("Resposta do GitHub excede o limite permitido.");
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} finally {
		await reader.cancel();
	}
}

interface TreeEntry {
	path: string;
	mode: string;
	type: string;
	sha: string;
	size?: number;
}

export async function downloadGithubSkill(
	input: string,
	fetcher: GithubFetcher = fetchWithProxy,
): Promise<SkillBundle & { source: GithubSkillSource }> {
	const source = parseGithubUrl(input);
	const base = `https://api.github.com/repos/${source.owner}/${source.repo}`;
	const signal = AbortSignal.timeout(60_000);
	const request = async (path: string, allowMissing = false) => {
		const response = await fetcher(`${base}${path}`, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "Ptolemy",
			},
			redirect: "error",
			signal,
		});
		if (allowMissing && response.status === 404) {
			await response.body?.cancel();
			return null;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(
				`GitHub retornou HTTP ${response.status}. Confira a URL, o acesso público e o limite de requisições.`,
			);
		}
		return readJson(
			response,
			path.includes("/git/trees/") ? 8 * MAX_FILE_BYTES : 2 * MAX_FILE_BYTES,
		);
	};
	// GitHub tree URLs do not delimit refs containing '/'. Resolve the longest
	// existing revision, then treat only the remainder as the Skill path.
	let commit = "";
	let folder = "";
	for (let count = source.parts.length || 1; count >= 1; count--) {
		const ref = source.parts.length
			? source.parts.slice(0, count).join("/")
			: "HEAD";
		const result = await request(`/commits/${encodeURIComponent(ref)}`, true);
		if (result) {
			if (typeof result.sha !== "string" || !/^[a-f0-9]{40}$/.test(result.sha))
				throw new Error("Revisão inválida retornada pelo GitHub.");
			commit = result.sha;
			folder = source.parts.slice(count).join("/");
			break;
		}
	}
	if (!commit)
		throw new Error("Revisão ou repositório público não encontrado no GitHub.");
	const tree = await request(`/git/trees/${commit}?recursive=1`);
	if (!tree || tree.truncated || !Array.isArray(tree.tree))
		throw new Error(
			"Árvore do GitHub incompleta; escolha um repositório menor.",
		);
	const prefix = folder ? `${folder}/` : "";
	const entries = (tree.tree as TreeEntry[]).filter(
		(entry) => entry.path.startsWith(prefix) && entry.type !== "tree",
	);
	if (!entries.length || entries.length > MAX_FILES)
		throw new Error("A pasta da Skill deve conter de 1 a 128 arquivos.");
	let total = 0;
	for (const entry of entries) {
		if (
			!safeSkillPath(entry.path.slice(prefix.length)) ||
			!["100644", "100755"].includes(entry.mode) ||
			entry.type !== "blob" ||
			!/^[a-f0-9]{40}$/.test(entry.sha)
		)
			throw new Error(
				"Skill contém caminhos inseguros, links simbólicos ou submódulos.",
			);
		if (
			typeof entry.size !== "number" ||
			entry.size < 0 ||
			entry.size > MAX_FILE_BYTES
		)
			throw new Error("Arquivo da Skill excede 1 MiB.");
		total += entry.size;
	}
	if (total > MAX_SKILL_BYTES) throw new Error("Skill excede 5 MiB.");
	if (!entries.some((entry) => entry.path === `${prefix}SKILL.md`))
		throw new Error("Pasta não contém SKILL.md.");
	const files: SkillBundle["files"] = [];
	let downloaded = 0;
	for (const entry of entries) {
		const blob = await request(`/git/blobs/${entry.sha}`);
		if (blob?.encoding !== "base64" || typeof blob.content !== "string")
			throw new Error("Arquivo inválido retornado pelo GitHub.");
		const content = blob.content.replace(/\s/g, "");
		const bytes = Buffer.byteLength(content, "base64");
		downloaded += bytes;
		if (bytes > MAX_FILE_BYTES || downloaded > MAX_SKILL_BYTES)
			throw new Error("Arquivos baixados excedem os limites da Skill.");
		files.push({
			path: entry.path.slice(prefix.length),
			content,
			executable: entry.mode === "100755",
		});
	}
	const text = Buffer.from(
		files.find((file) => file.path === "SKILL.md")?.content ?? "",
		"base64",
	).toString("utf8");
	const metadata = validateSkill(text, folder.split("/").pop() || source.repo);
	const bundle: SkillBundle & { source: GithubSkillSource } = {
		...metadata,
		source: { kind: "github", url: source.url, commit },
		files,
	};
	validateBundle(bundle);
	return bundle;
}
