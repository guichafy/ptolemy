import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	discoverOAuthServerInfo,
	exchangeAuthorization,
	refreshAuthorization,
	registerClient,
	startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	McpConnectionStatus,
	McpServerDefinition,
} from "../../shared/mcp";
import { fetchWithProxy } from "../net/proxy";
import {
	type McpRegistry,
	mcpRegistry,
	mcpUrl,
	validateMcpDefinition,
} from "./registry";
import type { SecretVault } from "./secrets";

type HttpDefinition = Extract<McpServerDefinition, { transport: "http" }>;
type OAuthDefinition = HttpDefinition & {
	auth: NonNullable<HttpDefinition["auth"]>;
};
interface CredentialRecord {
	version: 1;
	definitionKey: string;
	identity: string;
	resource: string;
	issuer: string;
	scopes: string[];
	client: OAuthClientInformationMixed;
	metadata: AuthorizationServerMetadata;
	tokens: OAuthTokens;
	expiresAt?: number;
}
interface ExpiredRecord {
	version: 1;
	definitionKey: string;
	expired: true;
}
interface Flow {
	definition: OAuthDefinition;
	key: string;
	controller: AbortController;
	state: string;
	status: McpConnectionStatus;
	server?: Server;
	timer?: ReturnType<typeof setTimeout>;
	task?: Promise<void>;
	claimed: boolean;
}
export interface McpOAuthServiceOptions {
	registry?: McpRegistry;
	vault?: SecretVault;
	fetcher?: FetchLike;
	openBrowser?: (url: string) => void | Promise<void>;
	timeoutMs?: number;
	requestTimeoutMs?: number;
	now?: () => number;
}
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const authenticationError = () =>
	Error("Não foi possível concluir a autenticação MCP.");
function definitionKey(definition: McpServerDefinition): string {
	const d = validateMcpDefinition(definition);
	if (d.transport !== "http" || !d.auth) throw authenticationError();
	return hash(
		JSON.stringify({
			id: d.id,
			url: d.url,
			issuer: d.auth.issuer ?? null,
			resource: d.auth.resource ?? null,
			clientId: d.auth.clientId ?? null,
			clientSecret: d.auth.clientSecret?.secretRef ?? null,
			scopes: d.auth.scopes ?? [],
		}),
	);
}
const storageKey = (id: string) => `oauth.${hash(id)}`;
function identity(
	r: Pick<
		CredentialRecord,
		"definitionKey" | "resource" | "issuer" | "scopes" | "client"
	>,
): string {
	return hash(
		JSON.stringify([
			r.definitionKey,
			r.resource,
			r.issuer,
			r.client.client_id,
			r.scopes,
		]),
	);
}
function grantedScopes(tokens: OAuthTokens, requested: string[]): string[] {
	if (
		tokens.token_type.toLowerCase() !== "bearer" ||
		/[\r\n\0]/.test(tokens.access_token) ||
		(tokens.expires_in !== undefined &&
			(!Number.isFinite(tokens.expires_in) || tokens.expires_in < 0))
	)
		throw authenticationError();
	const scopes =
		tokens.scope === undefined
			? requested
			: [...new Set(tokens.scope.split(" ").filter(Boolean))].sort();
	if (requested.some((scope) => !scopes.includes(scope)))
		throw authenticationError();
	return scopes;
}

function revocationEndpoint(
	metadata: AuthorizationServerMetadata,
): string | undefined {
	const value =
		"revocation_endpoint" in metadata
			? metadata.revocation_endpoint
			: undefined;
	return typeof value === "string" ? value : undefined;
}
function safeEqual(a: string, b: string): boolean {
	const aa = Buffer.from(a);
	const bb = Buffer.from(b);
	return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function openBrowser(url: string): Promise<void> {
	const { Utils } = await import("electrobun/bun");
	if (!Utils.openExternal(url)) throw authenticationError();
}
/** Browser flow runs in the background. connect returns immediately after local config lookup;
 * status is safe to poll over RPC. No authorization URL, verifier or credential is public. */
export class McpOAuthService {
	private readonly registry: McpRegistry;
	private readonly vault: SecretVault;
	private readonly fetcher: FetchLike;
	private readonly browser: (url: string) => void | Promise<void>;
	private readonly timeoutMs: number;
	private readonly requestTimeoutMs: number;
	private readonly now: () => number;
	private readonly flows = new Map<string, Flow>();
	private readonly epochs = new Map<string, number>();
	private readonly callbacks = new Set<Promise<void>>();
	private readonly locks = new Map<string, Promise<unknown>>();
	private readonly refreshControllers = new Map<string, AbortController>();
	private disposed = false;
	constructor(options: McpOAuthServiceOptions = {}) {
		this.registry = options.registry ?? mcpRegistry;
		this.vault = options.vault ?? this.registry.vault;
		this.fetcher =
			options.fetcher ??
			((input, init) => {
				// Manual proxies may have no noProxy entries. Never route a loopback OAuth
				// code/token exchange through an external proxy.
				const hostname = new URL(String(input)).hostname;
				return ["127.0.0.1", "[::1]", "localhost"].includes(hostname)
					? globalThis.fetch(input, init)
					: fetchWithProxy(input, init);
			});
		this.browser = options.openBrowser ?? openBrowser;
		this.timeoutMs = options.timeoutMs ?? 120_000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
		this.now = options.now ?? Date.now;
		this.registry.setStatusProvider((id) => this.status(id));
	}
	private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
		const run = (this.locks.get(id) ?? Promise.resolve()).then(work);
		const tail = run.catch(() => {});
		this.locks.set(id, tail);
		void tail.then(() => {
			if (this.locks.get(id) === tail) this.locks.delete(id);
		});
		return run;
	}
	private async definition(
		id: string,
		expected?: McpServerDefinition,
	): Promise<OAuthDefinition> {
		const d = await this.registry.get(id);
		if (d.transport !== "http" || !d.auth) throw authenticationError();
		if (expected && definitionKey(expected) !== definitionKey(d))
			throw Error(
				"Configuração MCP alterada; selecione novamente o servidor nesta conversa.",
			);
		return d as OAuthDefinition;
	}
	private async unchanged(d: OAuthDefinition): Promise<void> {
		if (definitionKey(await this.definition(d.id)) !== definitionKey(d))
			throw authenticationError();
	}
	private endpoint(value: string, localAllowed: boolean): URL {
		const url = new URL(value);
		const clean = new URL(url);
		clean.search = "";
		mcpUrl(clean.href);
		if (url.protocol !== "https:" && !localAllowed) throw authenticationError();
		return url;
	}
	/** SDK fetch adapter bounds every response and forbids credential-bearing redirects. */
	private request(d: OAuthDefinition, controller: AbortController): FetchLike {
		return async (input, init) => {
			const url = this.endpoint(
				String(input),
				new URL(d.url).protocol === "http:",
			);
			const timer = AbortSignal.timeout(this.requestTimeoutMs);
			const response = await this.fetcher(url, {
				...init,
				redirect: "error",
				signal: AbortSignal.any([
					controller.signal,
					timer,
					...(init?.signal ? [init.signal] : []),
				]),
			});
			if (!response.body) return response;
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.length;
					if (size > 1024 * 1024) throw authenticationError();
					chunks.push(value);
				}
			} catch {
				await reader.cancel().catch(() => {});
				throw authenticationError();
			} finally {
				reader.releaseLock();
			}
			return new Response(Buffer.concat(chunks), {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
		};
	}
	private cleanup(flow: Flow): void {
		if (flow.timer) clearTimeout(flow.timer);
		flow.timer = undefined;
		flow.server?.close();
		flow.server?.closeAllConnections();
		flow.server = undefined;
	}
	private stop(flow: Flow, status: McpConnectionStatus): void {
		flow.status = status;
		flow.controller.abort();
		this.cleanup(flow);
	}
	private active(flow: Flow): void {
		if (
			flow.controller.signal.aborted ||
			this.flows.get(flow.definition.id) !== flow ||
			this.disposed
		)
			throw authenticationError();
	}
	async connect(serverId: string): Promise<McpConnectionStatus> {
		if (this.disposed) throw authenticationError();
		const epoch = this.epochs.get(serverId) ?? 0;
		const d = await this.definition(serverId);
		if (this.disposed || (this.epochs.get(serverId) ?? 0) !== epoch)
			return { state: "cancelled" };
		const key = definitionKey(d);
		const existing = this.flows.get(serverId);
		if (
			existing?.key === key &&
			["connecting", "waiting"].includes(existing.status.state)
		)
			return { ...existing.status };
		if (existing) this.stop(existing, { state: "cancelled" });
		const flow: Flow = {
			definition: d,
			key,
			controller: new AbortController(),
			state: randomBytes(32).toString("base64url"),
			status: { state: "connecting" },
			claimed: false,
		};
		this.flows.set(serverId, flow);
		flow.timer = setTimeout(
			() =>
				this.stop(flow, {
					state: "error",
					message: "Tempo de autenticação MCP esgotado.",
				}),
			this.timeoutMs,
		);
		flow.task = this.begin(flow).catch(() => {
			if (!flow.controller.signal.aborted)
				this.stop(flow, {
					state: "error",
					message: "Não foi possível concluir a autenticação MCP.",
				});
		});
		return { state: "connecting" };
	}
	private async begin(flow: Flow): Promise<void> {
		const d = flow.definition;
		const fetchFn = this.request(d, flow.controller);
		const info = await discoverOAuthServerInfo(d.url, { fetchFn });
		this.active(flow);
		const metadata = info.authorizationServerMetadata;
		if (!metadata) throw authenticationError();
		const issuer = mcpUrl(info.authorizationServerUrl);
		if (
			mcpUrl(metadata.issuer) !== issuer ||
			(d.auth.issuer && mcpUrl(d.auth.issuer) !== issuer)
		)
			throw authenticationError();
		for (const endpoint of [
			metadata.authorization_endpoint,
			metadata.token_endpoint,
			metadata.registration_endpoint,
			revocationEndpoint(metadata),
		])
			if (endpoint)
				this.endpoint(endpoint, new URL(d.url).protocol === "http:");
		const resource = mcpUrl(
			info.resourceMetadata?.resource ?? d.auth.resource ?? d.url,
		);
		if (
			!checkResourceAllowed({
				requestedResource: d.url,
				configuredResource: resource,
			}) ||
			(d.auth.resource && resource !== d.auth.resource)
		)
			throw authenticationError();
		const scopes =
			d.auth.scopes ??
			[...new Set(info.resourceMetadata?.scopes_supported ?? [])].sort();
		if (scopes.some((s) => !s || /\s/.test(s))) throw authenticationError();
		const callbackPath = `/oauth/callback/${randomBytes(24).toString("hex")}`;
		const server = createServer();
		flow.server = server;
		server.headersTimeout = 5000;
		server.requestTimeout = 5000;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		this.active(flow);
		const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}${callbackPath}`;
		const metadataClient = {
			client_name: "Ptolemy",
			redirect_uris: [redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: d.auth.clientSecret
				? "client_secret_post"
				: "none",
			...(scopes.length ? { scope: scopes.join(" ") } : {}),
		};
		let client: OAuthClientInformationMixed;
		if (d.auth.clientId) {
			client = { client_id: d.auth.clientId };
			if (d.auth.clientSecret) {
				const value = await this.vault.get(d.auth.clientSecret.secretRef);
				if (value === undefined) throw authenticationError();
				client.client_secret = value;
			}
		} else
			client = await registerClient(issuer, {
				metadata,
				clientMetadata: metadataClient,
				scope: scopes.join(" ") || undefined,
				fetchFn,
			});
		this.active(flow);
		const { authorizationUrl, codeVerifier } = await startAuthorization(
			issuer,
			{
				metadata,
				clientInformation: client,
				redirectUrl: redirectUri,
				state: flow.state,
				scope: scopes.join(" ") || undefined,
				resource: new URL(resource),
			},
		);
		this.active(flow);
		server.on("request", (req, res) => {
			const task = this.callback(flow, req, res, {
				callbackPath,
				redirectUri,
				issuer,
				resource,
				scopes,
				metadata,
				client,
				codeVerifier,
			}).catch(() => {
				if (!flow.controller.signal.aborted)
					this.stop(flow, {
						state: "error",
						message: "Não foi possível concluir a autenticação MCP.",
					});
			});
			this.callbacks.add(task);
			void task.finally(() => this.callbacks.delete(task));
		});
		await this.unchanged(d);
		this.active(flow);
		flow.status = { state: "waiting" };
		await this.browser(authorizationUrl.href);
		this.active(flow);
	}
	private async callback(
		flow: Flow,
		req: IncomingMessage,
		res: ServerResponse,
		context: {
			callbackPath: string;
			redirectUri: string;
			issuer: string;
			resource: string;
			scopes: string[];
			metadata: AuthorizationServerMetadata;
			client: OAuthClientInformationMixed;
			codeVerifier: string;
		},
	): Promise<void> {
		const reply = (status: number, message: string) => {
			res.writeHead(status, {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
				connection: "close",
				"content-security-policy": "default-src 'none'",
			});
			res.end(message);
		};
		const url = new URL(req.url ?? "/", context.redirectUri);
		if (req.method !== "GET" || url.pathname !== context.callbackPath) {
			reply(404, "Não encontrado.");
			return;
		}
		if (flow.claimed || flow.controller.signal.aborted) {
			reply(409, "Autenticação encerrada.");
			return;
		}
		flow.claimed = true;
		const states = url.searchParams.getAll("state");
		if (states.length !== 1 || !safeEqual(states[0], flow.state)) {
			reply(400, "Estado de autenticação inválido.");
			this.stop(flow, {
				state: "error",
				message: "Estado de autenticação MCP inválido.",
			});
			return;
		}
		if (url.searchParams.has("error")) {
			reply(200, "Autenticação cancelada. Você pode fechar esta janela.");
			this.stop(flow, { state: "cancelled" });
			return;
		}
		const codes = url.searchParams.getAll("code");
		const issuer = url.searchParams.get("iss");
		if (
			codes.length !== 1 ||
			!codes[0] ||
			codes[0].length > 8192 ||
			(issuer && mcpUrl(issuer) !== context.issuer)
		) {
			reply(400, "Resposta de autenticação inválida.");
			this.stop(flow, {
				state: "error",
				message: "Resposta de autenticação MCP inválida.",
			});
			return;
		}
		reply(200, "Autenticação recebida. Você pode fechar esta janela.");
		// Release the loopback socket immediately; the bounded token exchange remains cancellable.
		flow.server?.close();
		flow.server?.closeIdleConnections();
		const tokens = await exchangeAuthorization(context.issuer, {
			metadata: context.metadata,
			clientInformation: context.client,
			authorizationCode: codes[0],
			codeVerifier: context.codeVerifier,
			redirectUri: context.redirectUri,
			resource: new URL(context.resource),
			fetchFn: this.request(flow.definition, flow.controller),
		});
		await this.serial(flow.definition.id, async () => {
			this.active(flow);
			await this.unchanged(flow.definition);
			this.active(flow);
			const record: CredentialRecord = {
				version: 1,
				definitionKey: flow.key,
				identity: "",
				resource: context.resource,
				issuer: context.issuer,
				scopes: grantedScopes(tokens, context.scopes),
				client: context.client,
				metadata: context.metadata,
				tokens,
				...(tokens.expires_in !== undefined
					? { expiresAt: this.now() + tokens.expires_in * 1000 }
					: {}),
			};
			record.identity = identity(record);
			await this.vault.set(
				storageKey(flow.definition.id),
				JSON.stringify(record),
			);
			// A cancellation can occur while the native vault write is pending.
			if (flow.controller.signal.aborted) {
				await this.vault.delete(storageKey(flow.definition.id));
				return;
			}
			flow.status = { state: "connected" };
			this.cleanup(flow);
		});
	}
	private async readRecord(
		id: string,
	): Promise<CredentialRecord | ExpiredRecord | undefined> {
		const raw = await this.vault.get(storageKey(id));
		if (raw === undefined) return undefined;
		try {
			const r = JSON.parse(raw) as CredentialRecord & { expired?: boolean };
			if (
				r.version === 1 &&
				r.expired === true &&
				typeof r.definitionKey === "string" &&
				/^[a-f0-9]{64}$/.test(r.definitionKey)
			)
				return { version: 1, definitionKey: r.definitionKey, expired: true };
			if (
				r.version !== 1 ||
				typeof r.definitionKey !== "string" ||
				!r.client?.client_id ||
				!r.tokens?.access_token ||
				r.tokens.token_type.toLowerCase() !== "bearer" ||
				!Array.isArray(r.scopes) ||
				r.identity !== identity(r) ||
				mcpUrl(r.metadata.issuer) !== r.issuer ||
				(r.expiresAt !== undefined && !Number.isFinite(r.expiresAt))
			)
				throw authenticationError();
			return r;
		} catch {
			throw authenticationError();
		}
	}
	private async markExpired(id: string, key: string): Promise<void> {
		// Persist only the safe identity marker; expired/rejected credentials are erased.
		await this.vault.set(
			storageKey(id),
			JSON.stringify({
				version: 1,
				definitionKey: key,
				expired: true,
			} satisfies ExpiredRecord),
		);
	}

	async status(serverId: string): Promise<McpConnectionStatus> {
		try {
			const d = await this.registry.get(serverId);
			if (d.transport !== "http" || !d.auth) return { state: "disconnected" };
			const key = definitionKey(d);
			const flow = this.flows.get(serverId);
			if (flow?.key === key && flow.status.state !== "connected")
				return { ...flow.status };
			const r = await this.readRecord(serverId);
			if (!r || r.definitionKey !== key) return { state: "disconnected" };
			if ("expired" in r) return { state: "expired" };
			return {
				state:
					r.expiresAt !== undefined &&
					r.expiresAt <= this.now() &&
					!r.tokens.refresh_token
						? "expired"
						: "connected",
			};
		} catch {
			return {
				state: "error",
				message: "Não foi possível consultar a autenticação MCP.",
			};
		}
	}
	/** Backend only. Always pass the session snapshot's definition; stale identities fail closed. */
	async getAccessToken(
		serverId: string,
		expectedDefinition?: McpServerDefinition,
	): Promise<string | undefined> {
		const epoch = this.epochs.get(serverId) ?? 0;
		const cancelled = () =>
			this.disposed || (this.epochs.get(serverId) ?? 0) !== epoch;
		const d = await this.definition(serverId, expectedDefinition);
		if (cancelled()) return undefined;
		return this.serial(serverId, async () => {
			if (cancelled()) return undefined;
			await this.unchanged(d);
			const record = await this.readRecord(serverId);
			if (cancelled()) return undefined;
			if (
				!record ||
				"expired" in record ||
				record.definitionKey !== definitionKey(d)
			)
				return undefined;
			if (
				record.expiresAt === undefined ||
				record.expiresAt > this.now() + 30_000
			)
				return record.tokens.access_token;
			if (!record.tokens.refresh_token) {
				await this.markExpired(serverId, definitionKey(d));
				return undefined;
			}
			const controller = new AbortController();
			this.refreshControllers.set(serverId, controller);
			try {
				const tokens = await refreshAuthorization(record.issuer, {
					metadata: record.metadata,
					clientInformation: record.client,
					refreshToken: record.tokens.refresh_token,
					resource: new URL(record.resource),
					fetchFn: this.request(d, controller),
				});
				await this.unchanged(d);
				if (controller.signal.aborted) throw authenticationError();
				record.scopes = grantedScopes(tokens, d.auth.scopes ?? record.scopes);
				record.identity = identity(record);
				record.tokens = tokens;
				record.expiresAt =
					tokens.expires_in !== undefined
						? this.now() + tokens.expires_in * 1000
						: undefined;
				await this.vault.set(storageKey(serverId), JSON.stringify(record));
				if (controller.signal.aborted) {
					await this.vault.delete(storageKey(serverId));
					throw authenticationError();
				}
				return tokens.access_token;
			} catch {
				await this.markExpired(serverId, definitionKey(d));
				throw authenticationError();
			} finally {
				if (this.refreshControllers.get(serverId) === controller)
					this.refreshControllers.delete(serverId);
			}
		}).catch(() => {
			throw authenticationError();
		});
	}
	async cancel(serverId: string): Promise<void> {
		this.epochs.set(serverId, (this.epochs.get(serverId) ?? 0) + 1);
		const flow = this.flows.get(serverId);
		if (flow && ["connecting", "waiting"].includes(flow.status.state))
			this.stop(flow, { state: "cancelled" });
		this.refreshControllers.get(serverId)?.abort();
		// Drain an exchange/vault mutation already in progress before returning.
		await this.serial(serverId, async () => {});
	}
	async disconnect(serverId: string): Promise<void> {
		await this.cancel(serverId);
		await this.serial(serverId, async () => {
			const record = await this.readRecord(serverId);
			await this.vault.delete(storageKey(serverId));
			this.flows.delete(serverId);
			if (!record || "expired" in record) return;
			const revoke = revocationEndpoint(record.metadata);
			if (!revoke) return;
			// Local disconnect succeeds even when remote revocation is unavailable.
			try {
				const d = await this.definition(serverId);
				const controller = new AbortController();
				for (const token of [
					record.tokens.refresh_token,
					record.tokens.access_token,
				])
					if (token) {
						const params = new URLSearchParams({
							token,
							client_id: record.client.client_id,
						});
						if (record.client.client_secret)
							params.set("client_secret", record.client.client_secret);
						await this.request(d, controller)(revoke, {
							method: "POST",
							headers: { "content-type": "application/x-www-form-urlencoded" },
							body: params,
						});
					}
			} catch {}
		}).catch(() => {
			throw authenticationError();
		});
	}
	async dispose(): Promise<void> {
		this.disposed = true;
		for (const flow of this.flows.values())
			this.stop(flow, { state: "cancelled" });
		for (const controller of this.refreshControllers.values())
			controller.abort();
		await Promise.allSettled([
			...this.locks.values(),
			...this.callbacks,
			...Array.from(this.flows.values(), (f) => f.task),
		]);
		this.flows.clear();
	}
}
export const mcpOAuthService = new McpOAuthService();
