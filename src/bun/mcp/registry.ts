import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
	McpConfigValue,
	McpConnectionStatus,
	McpCredentialEdit,
	McpEditableServer,
	McpServerDefinition,
	McpServerSummary,
	McpSnapshot,
	ResolvedMcpServer,
} from "../../shared/mcp";
import { writeJsonAtomic } from "../atomic-json";
import { ptolemyDataDir } from "../paths";
import { mcpSecretVault, type SecretVault } from "./secrets";

interface RegistryFile {
	version: 2;
	servers: McpServerDefinition[];
	legacyDigest?: string;
	legacyIds?: string[];
	legacySnapshot?: McpSnapshot;
}
export interface McpRegistryOptions {
	path?: string;
	legacyPath?: string;
	vault?: SecretVault;
}
const hasOwn = (value: object, key: string) =>
	Object.getOwnPropertyDescriptor(value, key) !== undefined;
const invalid = () => Error("Configuração MCP inválida.");
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
	typeof value === "string" &&
	!!value.trim() &&
	value.length <= 8192 &&
	!value.includes("\0");
const secret = (value: unknown): value is { secretRef: string } =>
	object(value) &&
	typeof value.secretRef === "string" &&
	/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
		value.secretRef,
	);
export function mcpUrl(value: unknown): string {
	if (!text(value)) throw invalid();
	const url = new URL(value);
	if (
		url.username ||
		url.password ||
		url.hash ||
		url.search ||
		!(
			url.protocol === "https:" ||
			(url.protocol === "http:" &&
				["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
		)
	)
		throw invalid();
	return url.href;
}
function values(
	value: unknown,
	header = false,
): Record<string, McpConfigValue> | undefined {
	if (value === undefined) return undefined;
	if (!object(value) || Object.keys(value).length > 256) throw invalid();
	const result: Record<string, McpConfigValue> = Object.create(null);
	for (const [key, v] of Object.entries(value)) {
		if (
			!(header ? /^[!#$%&'*+.^_`|~0-9a-z-]+$/i : /^[^=\0]{1,8192}$/).test(
				key,
			) ||
			!(
				(typeof v === "string" &&
					v.length <= 65536 &&
					!v.includes("\0") &&
					(!header || !/[\r\n]/.test(v))) ||
				secret(v)
			)
		)
			throw invalid();
		result[key] = typeof v === "string" ? v : { secretRef: v.secretRef };
	}
	return result;
}
export function validateMcpDefinition(value: unknown): McpServerDefinition {
	try {
		if (
			!object(value) ||
			!text(value.id) ||
			!/^[a-zA-Z0-9_.:-]{1,256}$/.test(value.id) ||
			!text(value.name) ||
			!object(value.defaults) ||
			typeof value.defaults.claude !== "boolean" ||
			typeof value.defaults.codex !== "boolean"
		)
			throw invalid();
		if (value.packageId !== undefined && !text(value.packageId))
			throw invalid();
		const base = {
			id: value.id,
			name: value.name,
			defaults: { claude: value.defaults.claude, codex: value.defaults.codex },
			...(value.packageId ? { packageId: value.packageId as string } : {}),
		};
		if (value.transport === "stdio") {
			if (
				!text(value.command) ||
				(value.args !== undefined &&
					(!Array.isArray(value.args) ||
						value.args.length > 1024 ||
						!value.args.every(
							(a) =>
								typeof a === "string" && a.length <= 65536 && !a.includes("\0"),
						)))
			)
				throw invalid();
			return {
				...base,
				transport: "stdio",
				command: value.command,
				...(value.args ? { args: [...(value.args as string[])] } : {}),
				...(value.env !== undefined ? { env: values(value.env) } : {}),
			};
		}
		if (value.transport !== "http") throw invalid();
		const url = mcpUrl(value.url);
		let auth: Extract<McpServerDefinition, { transport: "http" }>["auth"];
		if (value.auth !== undefined) {
			const a = value.auth;
			if (
				!object(a) ||
				a.type !== "oauth" ||
				(a.clientId !== undefined && !text(a.clientId)) ||
				(a.issuer !== undefined && !text(a.issuer)) ||
				(a.resource !== undefined && !text(a.resource)) ||
				(a.clientSecret !== undefined && !secret(a.clientSecret)) ||
				(a.scopes !== undefined &&
					(!Array.isArray(a.scopes) ||
						!a.scopes.every((s) => text(s) && !/\s/.test(s))))
			)
				throw invalid();
			auth = {
				type: "oauth",
				...(a.issuer ? { issuer: mcpUrl(a.issuer) } : {}),
				...(a.resource ? { resource: mcpUrl(a.resource) } : {}),
				...(a.clientId ? { clientId: a.clientId as string } : {}),
				...(a.clientSecret
					? {
							clientSecret: {
								secretRef: (a.clientSecret as { secretRef: string }).secretRef,
							},
						}
					: {}),
				...(a.scopes
					? { scopes: [...new Set(a.scopes as string[])].sort() }
					: {}),
			};
			if (
				auth.resource &&
				new URL(auth.resource).origin !== new URL(url).origin
			)
				throw invalid();
		}
		return {
			...base,
			transport: "http",
			url,
			...(value.headers !== undefined
				? { headers: values(value.headers, true) }
				: {}),
			...(auth ? { auth } : {}),
		};
	} catch {
		throw invalid();
	}
}
function refs(server: McpServerDefinition): string[] {
	const vals = server.transport === "stdio" ? server.env : server.headers;
	return [
		...Object.values(vals ?? {}).flatMap((v) =>
			typeof v === "string" ? [] : [v.secretRef],
		),
		...(server.transport === "http" && server.auth?.clientSecret
			? [server.auth.clientSecret.secretRef]
			: []),
	];
}
/** Single-process mutation queue; all credential/index writes complete before publication. */
export class McpRegistry {
	private readonly path: string;
	private readonly legacyPath: string;
	readonly vault: SecretVault;
	private queue: Promise<unknown> = Promise.resolve();
	private statusProvider:
		| ((id: string) => Promise<McpConnectionStatus>)
		| undefined;
	constructor(options: McpRegistryOptions = {}) {
		this.path = options.path ?? join(ptolemyDataDir(), "mcp-registry.json");
		this.legacyPath =
			options.legacyPath ?? join(ptolemyDataDir(), "mcp-servers.json");
		this.vault = options.vault ?? mcpSecretVault;
	}
	setStatusProvider(
		provider: (id: string) => Promise<McpConnectionStatus>,
	): void {
		this.statusProvider = provider;
	}
	private serial<T>(work: () => Promise<T>): Promise<T> {
		const run = this.queue.then(work);
		this.queue = run.catch(() => {});
		return run.catch(() => {
			throw Error("Não foi possível acessar o registro MCP.");
		});
	}
	private async readOptional(path: string): Promise<string | undefined> {
		try {
			return await readFile(path, "utf8");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw e;
		}
	}

	/** One schema for disk reads, preflight candidates and final publications. */
	private validateFile(value: unknown, allowPlaintext = false): RegistryFile {
		if (
			!object(value) ||
			value.version !== 2 ||
			!Array.isArray(value.servers) ||
			value.servers.length > 512
		)
			throw invalid();
		if (
			value.legacyDigest !== undefined &&
			(typeof value.legacyDigest !== "string" ||
				!/^[a-f0-9]{64}$/.test(value.legacyDigest))
		)
			throw invalid();
		if (
			value.legacyIds !== undefined &&
			(!Array.isArray(value.legacyIds) ||
				value.legacyIds.length > 512 ||
				!value.legacyIds.every(
					(id) => typeof id === "string" && /^[a-zA-Z0-9_.:-]{1,256}$/.test(id),
				) ||
				new Set(value.legacyIds).size !== value.legacyIds.length)
		)
			throw invalid();
		let legacySnapshot: McpSnapshot | undefined;
		if (value.legacySnapshot !== undefined) {
			if (
				!object(value.legacySnapshot) ||
				value.legacySnapshot.version !== 1 ||
				!Array.isArray(value.legacySnapshot.servers) ||
				value.legacySnapshot.servers.length > 512
			)
				throw invalid();
			const legacyServers = value.legacySnapshot.servers.map(
				validateMcpDefinition,
			);
			this.unique(legacyServers);
			if (
				legacyServers.some(
					(s) =>
						s.transport !== "stdio" ||
						Object.values(s.env ?? {}).some((v) => typeof v === "string"),
				)
			)
				throw invalid();
			legacySnapshot = { version: 1, servers: legacyServers };
		}
		const servers = value.servers.map(validateMcpDefinition);
		this.unique(servers);
		if (
			!allowPlaintext &&
			servers.some((s) =>
				Object.values(
					s.transport === "stdio" ? (s.env ?? {}) : (s.headers ?? {}),
				).some((v) => typeof v === "string"),
			)
		)
			throw invalid();
		return {
			version: 2,
			servers,
			...(legacySnapshot ? { legacySnapshot } : {}),
			...(value.legacyDigest !== undefined
				? { legacyDigest: value.legacyDigest as string }
				: {}),
			...(value.legacyIds !== undefined
				? { legacyIds: [...(value.legacyIds as string[])] }
				: {}),
		};
	}
	private publish(file: RegistryFile): Promise<void> {
		return writeJsonAtomic(this.path, this.validateFile(file));
	}
	private async load(
		preflight?: (file: RegistryFile) => void,
	): Promise<RegistryFile> {
		const raw = await this.readOptional(this.path);
		if (raw !== undefined) {
			const file = this.validateFile(JSON.parse(raw));
			if (file.legacyDigest && !file.legacySnapshot) {
				const source = await this.readOptional(this.legacyPath);
				if (source === undefined || digest(source) !== file.legacyDigest)
					throw invalid();
				const originals = await Promise.all(
					this.parseLegacy(source).map((server) => this.protect(server)),
				);
				file.legacySnapshot = {
					version: 1,
					servers: originals.filter((server) => server.defaults.claude),
				};
				await this.publish(file);
			}
			preflight?.(file);
			return file;
		}
		const legacy = await this.readOptional(this.legacyPath);
		const file: RegistryFile = {
			version: 2,
			servers: [],
			...(legacy !== undefined ? { legacyDigest: digest(legacy) } : {}),
		};
		if (legacy !== undefined) {
			const servers = this.parseLegacy(legacy);
			file.servers = servers;
			file.legacyIds = servers.map((server) => server.id);
			this.validateFile(file, true);
			preflight?.(file);
			file.servers = await Promise.all(
				servers.map((server) => this.protect(server)),
			);
			file.legacySnapshot = {
				version: 1,
				servers: structuredClone(
					file.servers.filter((server) => server.defaults.claude),
				),
			};
			await this.publish(file);
		} else preflight?.(file);
		return file;
	}

	private parseLegacy(legacy: string): McpServerDefinition[] {
		const servers: McpServerDefinition[] = [];
		const parsed = JSON.parse(legacy);
		if (
			!object(parsed) ||
			parsed.version !== 1 ||
			!Array.isArray(parsed.servers)
		)
			throw invalid();
		const names = new Set<string>();
		for (const entry of parsed.servers) {
			if (
				!object(entry) ||
				typeof entry.name !== "string" ||
				!entry.name.trim() ||
				names.has(entry.name) ||
				(entry.enabled !== undefined && typeof entry.enabled !== "boolean")
			)
				continue;
			// Match v1 validation first. Valid v1 data that exceeds new bounds must
			// fail the entire migration rather than silently lose a conversation tool.
			if (
				typeof entry.command !== "string" ||
				!entry.command.trim() ||
				(entry.args !== undefined &&
					(!Array.isArray(entry.args) ||
						!entry.args.every((a) => typeof a === "string"))) ||
				(entry.env !== undefined &&
					(!object(entry.env) ||
						!Object.values(entry.env).every((v) => typeof v === "string")))
			)
				continue;
			const server = validateMcpDefinition({
				...entry,
				id: `legacy-${digest(entry.name).slice(0, 24)}`,
				transport: "stdio",
				defaults: { claude: entry.enabled !== false, codex: false },
			});
			names.add(server.name);
			servers.push(server);
		}
		return servers;
	}

	private unique(servers: McpServerDefinition[]) {
		if (
			new Set(servers.map((s) => s.id)).size !== servers.length ||
			new Set(servers.map((s) => s.name)).size !== servers.length
		)
			throw invalid();
	}
	private validateSupplied(
		server: McpServerDefinition,
		secrets: Record<string, string>,
	): void {
		const map = server.transport === "stdio" ? server.env : server.headers;
		const prefix = server.transport === "stdio" ? "env." : "headers.";
		const accepted = new Set(Object.keys(map ?? {}).map((key) => prefix + key));
		if (server.transport === "http" && server.auth)
			accepted.add("oauth.clientSecret");
		for (const [slot, value] of Object.entries(secrets)) {
			if (
				!accepted.has(slot) ||
				typeof value !== "string" ||
				value.length > 65536 ||
				(slot !== "oauth.clientSecret" &&
					(value.includes("\0") ||
						(prefix === "headers." && /[\r\n]/.test(value))))
			)
				throw invalid();
		}
	}

	private async protect(
		server: McpServerDefinition,
		secrets: Record<string, string> = {},
	): Promise<McpServerDefinition> {
		const result = structuredClone(server);
		const put = async (value: string) => {
			const secretRef = randomUUID();
			await this.vault.set(secretRef, value);
			return { secretRef };
		};
		const map = result.transport === "stdio" ? result.env : result.headers;
		const prefix = result.transport === "stdio" ? "env." : "headers.";

		this.validateSupplied(result, secrets);
		const retained = Object.entries(map ?? {}).flatMap(([key, value]) =>
			!hasOwn(secrets, prefix + key) && typeof value !== "string"
				? [value.secretRef]
				: [],
		);
		if (
			result.transport === "http" &&
			result.auth?.clientSecret &&
			!hasOwn(secrets, "oauth.clientSecret")
		)
			retained.push(result.auth.clientSecret.secretRef);
		for (const key of retained)
			if ((await this.vault.get(key)) === undefined) throw invalid();
		for (const [key, value] of Object.entries(map ?? {})) {
			const slot = prefix + key;
			if (hasOwn(secrets, slot)) map![key] = await put(secrets[slot]);
			else if (typeof value === "string") map![key] = await put(value);
		}
		if (
			result.transport === "http" &&
			result.auth &&
			hasOwn(secrets, "oauth.clientSecret")
		)
			result.auth.clientSecret = await put(secrets["oauth.clientSecret"]);
		for (const key of refs(result))
			if ((await this.vault.get(key)) === undefined)
				throw Error("Credencial MCP indisponível.");
		return result;
	}
	async list(): Promise<McpServerSummary[]> {
		const definitions = await this.serial(async () =>
			structuredClone((await this.load()).servers),
		);
		return Promise.all(
			definitions.map(async (s) => ({
				id: s.id,
				name: s.name,
				transport: s.transport,
				defaults: s.defaults,
				...(s.packageId ? { packageId: s.packageId } : {}),
				credentials: {
					env: s.transport === "stdio" ? Object.keys(s.env ?? {}) : [],
					headers: s.transport === "http" ? Object.keys(s.headers ?? {}) : [],
					oauthClientSecret: s.transport === "http" && !!s.auth?.clientSecret,
				},
				connection: (await this.statusProvider?.(s.id)) ?? {
					state: "disconnected" as const,
				},
			})),
		);
	}
	/** Backend only. Use list() for renderer responses. */
	async get(id: string): Promise<McpServerDefinition> {
		return this.serial(async () => {
			const s = (await this.load()).servers.find((s) => s.id === id);
			if (!s) throw invalid();
			return structuredClone(s);
		});
	}
	/** RPC-safe draft. All env/header values use preserve markers, including non-secret values. */
	async getEditable(id: string): Promise<McpEditableServer> {
		const server = await this.get(id);
		const editable = (map: Record<string, McpConfigValue> | undefined) =>
			map
				? Object.fromEntries(
						Object.keys(map).map((key) => [key, { preserve: true as const }]),
					)
				: undefined;
		if (server.transport === "stdio")
			return { ...server, env: editable(server.env) };
		const { auth, ...rest } = server;
		if (!auth) return { ...rest, headers: editable(server.headers) };
		const { clientSecret, ...config } = auth;
		return {
			...rest,
			headers: editable(server.headers),
			auth: {
				...config,
				...(clientSecret ? { clientSecret: { preserve: true as const } } : {}),
			},
		};
	}

	private prepareEditable(
		copy: McpEditableServer,
		existing: McpServerDefinition | undefined,
	): { clean: McpServerDefinition; supplied: Record<string, string> } {
		const supplied: Record<string, string> = {};
		const field = (
			edit: McpCredentialEdit,
			prior: McpConfigValue | undefined,
		): McpConfigValue => {
			if (!object(edit)) throw invalid();
			if (
				"preserve" in edit &&
				edit.preserve === true &&
				!hasOwn(edit, "value")
			) {
				if (prior === undefined) throw invalid();
				return prior;
			}
			if (
				"value" in edit &&
				typeof edit.value === "string" &&
				!hasOwn(edit, "preserve")
			)
				return edit.value;
			throw invalid();
		};
		const map = (
			input: Record<string, McpCredentialEdit> | undefined,
			prior: Record<string, McpConfigValue> | undefined,
		) => {
			if (input === undefined) return undefined;
			if (!object(input)) throw invalid();
			return Object.fromEntries(
				Object.entries(input).map(([key, edit]) => [
					key,
					field(edit, prior?.[key]),
				]),
			);
		};
		let definition: McpServerDefinition;
		if (copy.transport === "stdio")
			definition = {
				...copy,
				env: map(
					copy.env,
					existing?.transport === "stdio" ? existing.env : undefined,
				),
			};
		else {
			const { auth, ...rest } = copy;
			let safeAuth: Extract<McpServerDefinition, { transport: "http" }>["auth"];
			if (auth) {
				const { clientSecret, ...config } = auth;
				safeAuth = { ...config };
				if (clientSecret) {
					const prior =
						existing?.transport === "http"
							? existing.auth?.clientSecret
							: undefined;
					const value = field(clientSecret, prior);
					if (typeof value === "string") supplied["oauth.clientSecret"] = value;
					else safeAuth.clientSecret = value;
				}
			}
			definition = {
				...rest,
				headers: map(
					copy.headers,
					existing?.transport === "http" ? existing.headers : undefined,
				),
				...(safeAuth ? { auth: safeAuth } : {}),
			};
		}
		const clean = validateMcpDefinition(definition);
		this.validateSupplied(clean, supplied);
		return { clean, supplied };
	}

	/** Whole edit is queued. Preserve is resolved against current same-field backend data. */
	async saveEditable(draft: McpEditableServer): Promise<void> {
		const copy = structuredClone(draft);
		return this.serial(async () => {
			const prepare = (file: RegistryFile) =>
				this.prepareEditable(
					copy,
					file.servers.find((server) => server.id === copy.id),
				);
			const file = await this.load((candidate) => {
				const { clean } = prepare(candidate);
				this.validateFile(
					{
						...candidate,
						servers: [
							...candidate.servers.filter((server) => server.id !== clean.id),
							clean,
						],
					},
					true,
				);
			});
			const { clean, supplied } = prepare(file);
			const protectedServer = await this.protect(clean, supplied);
			const index = file.servers.findIndex((server) => server.id === clean.id);
			if (index < 0) file.servers.push(protectedServer);
			else file.servers[index] = protectedServer;
			await this.publish(file);
		});
	}

	async save(
		server: McpServerDefinition,
		secrets: Record<string, string> = {},
	): Promise<void> {
		const clean = validateMcpDefinition(server); // Fail before touching either durable store.
		const supplied = structuredClone(secrets);
		this.validateSupplied(clean, supplied);
		return this.serial(async () => {
			const f = await this.load((candidate) =>
				this.validateFile(
					{
						...candidate,
						servers: [
							...candidate.servers.filter((server) => server.id !== clean.id),
							clean,
						],
					},
					true,
				),
			);
			const next = f.servers.filter((s) => s.id !== clean.id);
			next.push(clean);
			this.validateFile({ ...f, servers: next }, true);
			const protectedServer = await this.protect(clean, supplied);
			const i = f.servers.findIndex((s) => s.id === clean.id);
			if (i < 0) f.servers.push(protectedServer);
			else f.servers[i] = protectedServer;
			await this.publish(f);
		});
	}
	async remove(id: string): Promise<void> {
		return this.serial(async () => {
			const f = await this.load();
			f.servers = f.servers.filter((s) => s.id !== id);
			await this.publish(f);
		});
	}
	async setDefaults(agent: "claude" | "codex", ids: string[]): Promise<void> {
		return this.serial(async () => {
			if (!["claude", "codex"].includes(agent)) throw invalid();
			const f = await this.load();
			if (ids.some((id) => !f.servers.some((s) => s.id === id)))
				throw invalid();
			for (const s of f.servers) s.defaults[agent] = ids.includes(s.id);
			await this.publish(f);
		});
	}
	async snapshot(ids: string[]): Promise<McpSnapshot> {
		return this.serial(async () => {
			const f = await this.load();
			const servers = ids.map((id) => {
				const s = f.servers.find((s) => s.id === id);
				if (!s) throw invalid();
				return s;
			});
			this.unique(servers);
			return { version: 1, servers: structuredClone(servers) };
		});
	}
	/** Resolves only vault references. Runtime obtains OAuth tokens separately with expectedDefinition. Never persist or serialize this return value into CLI argv. */
	async resolve(snapshot: McpSnapshot): Promise<ResolvedMcpServer[]> {
		try {
			if (snapshot.version !== 1 || !Array.isArray(snapshot.servers))
				throw invalid();
			return await Promise.all(
				snapshot.servers.map(async (raw) => {
					const s = validateMcpDefinition(raw);
					const map = s.transport === "stdio" ? s.env : s.headers;
					const resolved: Record<string, string> = Object.create(null);
					for (const [k, v] of Object.entries(map ?? {})) {
						if (typeof v === "string") throw invalid();
						const value = await this.vault.get(v.secretRef);
						if (value === undefined) throw invalid();
						resolved[k] = value;
					}
					return {
						...s,
						...(map
							? s.transport === "stdio"
								? { env: resolved }
								: { headers: resolved }
							: {}),
					} as ResolvedMcpServer;
				}),
			);
		} catch {
			throw Error("Credencial ou snapshot MCP indisponível.");
		}
	}
	/** Explicit cutover recovery after v1 writers are stopped. Late legacy edits win
	 * only for migrated entries; collisions with independent shared entries abort. */
	async reconcileLegacyMigration(): Promise<void> {
		return this.serial(async () => {
			const file = await this.load();
			const legacy = await this.readOptional(this.legacyPath);
			if (legacy === undefined || digest(legacy) === file.legacyDigest) return;
			if (!file.legacyIds && file.legacyDigest) throw invalid();
			const legacyIds = file.legacyIds ?? [];
			const imported = this.parseLegacy(legacy);
			const shared = file.servers.filter(
				(server) => !legacyIds.includes(server.id),
			);
			const candidate: RegistryFile = {
				...file,
				servers: [...shared, ...imported],
				legacyDigest: digest(legacy),
				legacyIds: imported.map((server) => server.id),
			};
			this.validateFile(candidate, true);
			candidate.servers = [
				...shared,
				...(await Promise.all(imported.map((server) => this.protect(server)))),
			];
			candidate.legacySnapshot = {
				version: 1,
				servers: structuredClone(
					candidate.servers.filter(
						(server) =>
							candidate.legacyIds!.includes(server.id) &&
							server.defaults.claude,
					),
				),
			};
			await this.publish(candidate);
		});
	}

	/** Backend-only provenance, independent of all new shared defaults and edits. */
	async legacySnapshot(): Promise<McpSnapshot> {
		return this.serial(async () =>
			structuredClone(
				(await this.load()).legacySnapshot ?? { version: 1, servers: [] },
			),
		);
	}

	/** Call only after all v1 consumers are retired. Refuses to erase edits made since migration. */
	async finalizeLegacyMigration(): Promise<void> {
		return this.serial(async () => {
			const f = await this.load();
			const legacy = await this.readOptional(this.legacyPath);
			if (legacy === undefined) return;
			if (f.legacyDigest !== digest(legacy)) throw invalid();
			for (const s of [...f.servers, ...(f.legacySnapshot?.servers ?? [])])
				for (const key of refs(s))
					if ((await this.vault.get(key)) === undefined) throw invalid();
			await rm(this.legacyPath);
		});
	}
}
export const mcpRegistry = new McpRegistry();
