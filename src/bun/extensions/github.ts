import { createHash } from "node:crypto";
import type { SkillFile } from "@/shared/skills";
import { fetchWithProxy } from "../net/proxy";
import { type GithubFetcher, parseGithubUrl } from "../skills/github";
import { safeSkillPath } from "../skills/validation";

export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_CATALOG_BYTES = 8 * MAX_MANIFEST_BYTES;
export const MAX_PACKAGE_BYTES = 32 * MAX_MANIFEST_BYTES;
export const MAX_PACKAGE_FILES = 2048;
export const MAX_PACKAGE_FILE_BYTES = 8 * MAX_MANIFEST_BYTES;
const shaPattern = /^[a-f0-9]{40}$/;
interface TreeEntry {
	path: string;
	mode: string;
	type: string;
	sha: string;
	size?: number;
}

export function relativePath(value: string, allowRoot = false): string {
	const path = value.replace(/^\.\//, "").replace(/\/$/, "");
	if (allowRoot && (path === "" || path === ".")) return "";
	if (!safeSkillPath(path))
		throw new Error("Referência contém caminho inseguro.");
	return path;
}
export function canonicalGithubUrl(input: string): string {
	const parsed = parseGithubUrl(input);
	return `https://github.com/${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}${parsed.parts.length ? `/tree/${parsed.parts.map(encodeURIComponent).join("/")}` : ""}`;
}
export function validatePackageFiles(files: SkillFile[]): void {
	if (
		!Array.isArray(files) ||
		!files.length ||
		files.length > MAX_PACKAGE_FILES
	)
		throw new Error("Pacote deve conter de 1 a 2048 arquivos.");
	let total = 0;
	const paths = new Set<string>();
	for (const file of files) {
		if (typeof file.path !== "string" || !safeSkillPath(file.path))
			throw new Error("Pacote contém caminho inseguro.");
		const path = file.path.normalize("NFC").toLowerCase();
		if (paths.has(path)) throw new Error("Pacote contém caminhos duplicados.");
		paths.add(path);
		if (
			typeof file.executable !== "boolean" ||
			typeof file.content !== "string" ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
				file.content,
			)
		)
			throw new Error("Conteúdo de arquivo inválido.");
		const size = Buffer.byteLength(file.content, "base64");
		if (size > MAX_PACKAGE_FILE_BYTES)
			throw new Error("Arquivo do pacote excede 8 MiB.");
		total += size;
	}
	for (const path of paths) {
		const parts = path.split("/");
		for (let i = 1; i < parts.length; i++)
			if (paths.has(parts.slice(0, i).join("/")))
				throw new Error("Conflito entre arquivo e diretório no pacote.");
	}
	if (total > MAX_PACKAGE_BYTES) throw new Error("Pacote excede 32 MiB.");
}
async function boundedBytes(
	response: Response,
	limit: number,
): Promise<Buffer> {
	if (!response.body) {
		if (limit === 0) return Buffer.alloc(0);
		throw new Error("Resposta vazia do GitHub.");
	}
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
		return Buffer.concat(chunks);
	} finally {
		await reader.cancel();
	}
}
function parseJson(bytes: Buffer): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("Resposta JSON inválida do GitHub.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Manifest precisa ser um objeto JSON.");
	return value as Record<string, unknown>;
}
async function boundedJson(
	response: Response,
	limit: number,
): Promise<Record<string, unknown>> {
	return parseJson(await boundedBytes(response, limit));
}

/** Metadata is loaded once at an immutable commit; blobs are verified against Git object IDs. */
export class GithubRepository {
	readonly repository: string;
	readonly url: string;
	commit = "";
	folder = "";
	entries: TreeEntry[] = [];
	private readonly signal = AbortSignal.timeout(60_000);
	private readonly cache = new Map<string, SkillFile>();
	private constructor(
		owner: string,
		repo: string,
		private readonly fetcher: GithubFetcher,
	) {
		this.repository = `${owner}/${repo}`;
		this.url = `https://github.com/${this.repository}`;
	}
	static async open(
		input: string,
		fetcher: GithubFetcher = fetchWithProxy,
	): Promise<GithubRepository> {
		const source = parseGithubUrl(input);
		const repo = new GithubRepository(source.owner, source.repo, fetcher);
		for (let count = source.parts.length || 1; count >= 1; count--) {
			const ref = source.parts.length
				? source.parts.slice(0, count).join("/")
				: "HEAD";
			const data = await repo.request(
				`/commits/${encodeURIComponent(ref)}`,
				MAX_MANIFEST_BYTES,
				true,
			);
			if (!data) continue;
			if (typeof data.sha !== "string" || !shaPattern.test(data.sha))
				throw new Error("Revisão inválida do GitHub.");
			if (shaPattern.test(ref) && data.sha !== ref)
				throw new Error("GitHub não retornou a revisão fixada pela fonte.");
			repo.commit = data.sha;
			repo.folder = source.parts.slice(count).join("/");
			break;
		}
		if (!repo.commit)
			throw new Error(
				"Revisão ou repositório público não encontrado no GitHub.",
			);
		const tree = await repo.request(
			`/git/trees/${repo.commit}?recursive=1`,
			MAX_CATALOG_BYTES,
		);
		if (!tree || tree.truncated !== false || !Array.isArray(tree.tree))
			throw new Error(
				"Árvore do GitHub incompleta; escolha um repositório menor.",
			);
		repo.entries = tree.tree as TreeEntry[];
		if (
			repo.entries.some(
				(e) => !e || typeof e.path !== "string" || !safeSkillPath(e.path),
			)
		)
			throw new Error("Árvore contém caminho inseguro.");
		return repo;
	}
	private async request(
		path: string,
		limit: number,
		missing = false,
	): Promise<Record<string, unknown> | null> {
		const response = await this.fetcher(
			`https://api.github.com/repos/${this.repository}${path}`,
			{
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "Ptolemy",
				},
				redirect: "error",
				signal: this.signal,
			},
		);
		if (missing && response.status === 404) {
			await response.body?.cancel();
			return null;
		}
		if (missing && response.status === 422) {
			const result = await boundedJson(response, MAX_MANIFEST_BYTES);
			if (
				typeof result.message === "string" &&
				result.message.startsWith("No commit found for SHA:")
			)
				return null;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(
				`GitHub retornou HTTP ${response.status}. Confira o acesso público e o limite de requisições.`,
			);
		}
		return boundedJson(response, limit);
	}
	has(path: string): boolean {
		return this.entries.some((e) => e.path === path && e.type !== "tree");
	}
	async read(path: string, limit = MAX_MANIFEST_BYTES): Promise<SkillFile> {
		if (!safeSkillPath(path)) throw new Error("Caminho inseguro no pacote.");
		const entry = this.entries.find((e) => e.path === path);
		if (!entry) throw new Error("Arquivo declarado não encontrado no GitHub.");
		this.validateEntry(entry, limit);
		const cached = this.cache.get(path);
		if (cached) return { ...cached };
		const response = await this.fetcher(
			`https://raw.githubusercontent.com/${this.repository}/${this.commit}/${path.split("/").map(encodeURIComponent).join("/")}`,
			{
				headers: {
					Accept: "application/octet-stream",
					"User-Agent": "Ptolemy",
				},
				redirect: "error",
				signal: this.signal,
			},
		);
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(
				`GitHub retornou HTTP ${response.status} ao baixar arquivo público.`,
			);
		}
		const bytes = await boundedBytes(response, Math.min(limit, entry.size!));
		const content = bytes.toString("base64");
		if (
			bytes.length !== entry.size ||
			bytes.length > limit ||
			createHash("sha1")
				.update(`blob ${bytes.length}\0`)
				.update(bytes)
				.digest("hex") !== entry.sha
		)
			throw new Error("Download incompleto ou blob corrompido do GitHub.");
		const file = { path, content, executable: entry.mode === "100755" };
		this.cache.set(path, file);
		return { ...file };
	}
	async json(
		path: string,
		limit = MAX_MANIFEST_BYTES,
	): Promise<Record<string, unknown>> {
		return parseJson(
			Buffer.from((await this.read(path, limit)).content, "base64"),
		);
	}
	private validateEntry(entry: TreeEntry, limit: number) {
		if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
			throw new Error("Pacote contém links simbólicos ou submódulos.");
		if (
			!shaPattern.test(entry.sha) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size! < 0 ||
			entry.size! > limit
		)
			throw new Error(
				"Arquivo do pacote excede o limite permitido ou possui tamanho inválido.",
			);
	}
	async download(folder = this.folder): Promise<SkillFile[]> {
		relativePath(folder, true);
		const prefix = folder ? `${folder}/` : "";
		const entries = this.entries.filter(
			(e) => e.path.startsWith(prefix) && e.type !== "tree",
		);
		if (!entries.length || entries.length > MAX_PACKAGE_FILES)
			throw new Error("Pacote deve conter de 1 a 2048 arquivos.");
		let total = 0;
		for (const entry of entries) {
			this.validateEntry(entry, MAX_PACKAGE_FILE_BYTES);
			total += entry.size!;
		}
		if (total > MAX_PACKAGE_BYTES) throw new Error("Pacote excede 32 MiB.");
		const files: SkillFile[] = new Array(entries.length);
		let cursor = 0;
		let failure: unknown;
		const worker = async () => {
			while (!failure && cursor < entries.length) {
				const index = cursor++;
				const entry = entries[index];
				try {
					const file = await this.read(entry.path, MAX_PACKAGE_FILE_BYTES);
					files[index] = { ...file, path: entry.path.slice(prefix.length) };
				} catch (error) {
					failure = error;
				}
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(6, entries.length) }, worker),
		);
		if (failure) throw failure;
		validatePackageFiles(files);
		return files;
	}
}
