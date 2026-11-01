import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerDefinition, ResolvedMcpServer } from "../../shared/mcp";
import { getLoginShellPath } from "../codex/codex-cli";
import { fetchWithProxy } from "../net/proxy";
import { mcpLauncherPaths } from "./launcher-path";

type HttpDefinition = Extract<McpServerDefinition, { transport: "http" }>;
export interface GatewayAuth {
	getAccessToken(
		id: string,
		expected: HttpDefinition,
		rejectedToken?: string,
	): Promise<string | undefined>;
	/** Resolved entries have lost static references; OAuth must bind the original snapshot. */
	definitions?: Map<string, HttpDefinition>;
}
interface Bridge {
	readonly closed: boolean;
	down: StreamableHTTPServerTransport;
	up: Transport;
	close(): Promise<void>;
}
interface Route {
	token: string;
	server: ResolvedMcpServer;
	cwd: string;
	auth?: GatewayAuth;
	bridges: Map<string, Bridge>;
	pending: Set<Bridge>;
	closed: boolean;
}
const failure = () =>
	Error(
		"Falha na conexão MCP. Verifique a configuração e autenticação do servidor.",
	);
const isLoopback = (url: URL) =>
	["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
function authorized(value: string | undefined, token: string) {
	const supplied = Buffer.from(value ?? "");
	const expected = Buffer.from(`Bearer ${token}`);
	return (
		supplied.length === expected.length && timingSafeEqual(supplied, expected)
	);
}

/** OAuth has its own bounded operations; cancellation must also stop waiting for it. */
async function abortable<T>(
	operation: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	let abort: () => void = () => {};
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				abort = () => reject(failure());
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			}),
		]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

/** A transport bridge, not an arbitrary URL proxy. Routes come only from trusted snapshots.
 * Each downstream HTTP session owns a separate upstream transport/session/process.
 * Raw MCP messages preserve advertised capabilities, requests and notifications in both directions.
 */
export class McpGateway {
	private readonly routes = new Map<string, Route>();
	private disposed = false;
	private readonly http = createServer((req, res) => {
		void this.handle(req, res);
	});
	private constructor() {}
	static async create(): Promise<McpGateway> {
		const gateway = new McpGateway();
		gateway.http.listen(0, "127.0.0.1");
		await once(gateway.http, "listening");
		return gateway;
	}
	get url() {
		return `http://127.0.0.1:${(this.http.address() as { port: number }).port}`;
	}
	addSession(
		_sessionId: string,
		servers: ResolvedMcpServer[],
		cwd: string,
		auth?: GatewayAuth,
	) {
		if (this.disposed) throw failure();
		const token = randomBytes(32).toString("base64url");
		const routes = servers.map((server) => {
			const path = `/mcp/${randomUUID()}`;
			this.routes.set(path, {
				token,
				server,
				cwd,
				auth,
				bridges: new Map(),
				pending: new Set(),
				closed: false,
			});
			return { name: server.name, id: server.id, url: `${this.url}${path}` };
		});
		return {
			token,
			routes,
			dispose: async () => {
				for (const entry of routes) {
					const path = new URL(entry.url).pathname;
					const route = this.routes.get(path);
					if (!route) continue;
					route.closed = true;
					this.routes.delete(path);
					await Promise.allSettled(
						[...new Set([...route.bridges.values(), ...route.pending])].map(
							(b) => b.close(),
						),
					);
				}
			},
		};
	}
	private async upstream(
		route: Route,
		lifecycle: AbortSignal,
	): Promise<Transport> {
		const server = route.server;
		if (server.transport === "stdio") {
			const base = getDefaultEnvironment();
			base.PATH = await getLoginShellPath();
			for (const key of [
				"HTTP_PROXY",
				"HTTPS_PROXY",
				"ALL_PROXY",
				"NO_PROXY",
				"http_proxy",
				"https_proxy",
				"all_proxy",
				"no_proxy",
				"LANG",
				"LC_ALL",
				"LC_CTYPE",
				"TMPDIR",
			]) {
				const value = process.env[key];
				if (value !== undefined) base[key] = value;
			}
			const config = {
				command: server.command,
				args: server.args ?? [],
				cwd: route.cwd,
				env: { ...base, ...server.env },
			};
			return new StdioClientTransport({
				...mcpLauncherPaths(),
				cwd: route.cwd,
				env: {
					...getDefaultEnvironment(),
					PTOLEMY_MCP_STDIO: JSON.stringify(config),
				},
				stderr: "ignore",
			});
		}
		const target = new URL(server.url);
		const expected =
			route.auth?.definitions?.get(server.id) ?? (server as HttpDefinition);
		return new StreamableHTTPClientTransport(target, {
			fetch: async (input, init) => {
				const terminating = init?.method === "DELETE";
				const connection = new AbortController();
				// Bound GET establishment and best-effort DELETE, never tool duration or SSE bodies.
				const timer =
					terminating || init?.method === "GET"
						? setTimeout(() => connection.abort(), terminating ? 1_000 : 15_000)
						: undefined;
				const signal = AbortSignal.any([
					connection.signal,
					...(!terminating
						? [lifecycle, ...(init?.signal ? [init.signal] : [])]
						: []),
				]);
				// SDK headers contain protocol/session fields only. Credentials are inserted here,
				// immediately before a fixed validated destination, and never follow redirects.
				const execute = async (token?: string) => {
					signal.throwIfAborted();
					const headers = new Headers(init?.headers);
					for (const [key, value] of Object.entries(server.headers ?? {}))
						headers.set(key, value);
					if (server.auth) {
						if (!token) throw failure();
						headers.set("Authorization", `Bearer ${token}`);
					}
					const options = {
						...init,
						headers,
						redirect: "manual" as const,
						signal,
					};
					return isLoopback(target)
						? fetch(input, { ...options, proxy: "" } as RequestInit)
						: fetchWithProxy(String(input), options);
				};
				try {
					return await abortable(
						(async () => {
							const token = server.auth
								? await route.auth?.getAccessToken(server.id, expected)
								: undefined;
							let response = await execute(token);
							if (
								response.status === 401 &&
								server.auth &&
								token &&
								!terminating
							) {
								await response.body?.cancel();
								const next = await route.auth?.getAccessToken(
									server.id,
									expected,
									token,
								);
								response = await execute(next);
							}
							if (
								response.status === 401 ||
								response.status === 403 ||
								(response.status >= 300 && response.status < 400)
							) {
								await response.body?.cancel();
								throw failure();
							}
							return response;
						})(),
						signal,
					);
				} catch {
					throw failure();
				} finally {
					if (timer !== undefined) clearTimeout(timer);
				}
			},
		});
	}
	private async bridge(route: Route): Promise<Bridge> {
		const lifecycle = new AbortController();
		const up = await this.upstream(route, lifecycle.signal);
		if (route.closed) {
			await up.close();
			throw failure();
		}
		const down = new StreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
		});
		let closed = false;
		let closing: Promise<void> | undefined;
		let initializeId: string | number | undefined;
		let initializationTimer: ReturnType<typeof setTimeout> | undefined;
		let failing = false;
		const pendingRequests = new Set<string | number>();
		const rejectPending = async () => {
			const ids = [...pendingRequests];
			pendingRequests.clear();
			await Promise.allSettled(
				ids.map((id) =>
					down.send({
						jsonrpc: "2.0",
						id,
						error: { code: -32603, message: failure().message },
					}),
				),
			);
		};
		const bridge: Bridge = {
			up,
			down,
			get closed() {
				return closed;
			},
			close: () => {
				if (closing) return closing;
				closed = true;
				clearTimeout(initializationTimer);
				lifecycle.abort();
				closing = (async () => {
					await rejectPending();
					if (up instanceof StreamableHTTPClientTransport)
						await up.terminateSession().catch(() => {});
					await Promise.allSettled([up.close(), down.close()]);
					route.pending.delete(bridge);
					if (down.sessionId) route.bridges.delete(down.sessionId);
				})();
				return closing;
			},
		};
		const transportFailed = () => {
			if (closed || failing) return;
			failing = true;
			void rejectPending().finally(() => bridge.close());
		};
		route.pending.add(bridge);
		up.onmessage = (msg) => {
			if ("id" in msg && msg.id !== undefined && !("method" in msg)) {
				pendingRequests.delete(msg.id);
				if (msg.id === initializeId) clearTimeout(initializationTimer);
			}

			if (
				up instanceof StreamableHTTPClientTransport &&
				"result" in msg &&
				msg.id === initializeId &&
				typeof msg.result.protocolVersion === "string"
			)
				up.setProtocolVersion(msg.result.protocolVersion);
			void down.send(msg).catch(() => bridge.close());
		};
		down.onmessage = (msg) => {
			if ("id" in msg && msg.id !== undefined && "method" in msg) {
				pendingRequests.add(msg.id);
				if (failing || closed) {
					void rejectPending();
					return;
				}
				if (msg.method === "initialize") {
					initializeId = msg.id;
					initializationTimer = setTimeout(transportFailed, 15_000);
				}
			}
			void up.send(msg).catch(transportFailed);
		};
		// SDK SSE processing is asynchronous after send() resolves. Settle callers on
		// transport errors too; never expose raw errors or leave them awaiting a timeout.
		up.onerror = transportFailed;
		down.onerror = () => {};
		up.onclose = transportFailed;
		down.onclose = () => {
			void bridge.close();
		};
		try {
			await up.start();
			await down.start();
			if (route.closed) throw failure();
		} catch {
			await bridge.close();
			throw failure();
		}
		return bridge;
	}
	private async handle(req: IncomingMessage, res: ServerResponse) {
		const route = this.routes.get(req.url ?? "");
		if (!route || this.disposed) {
			res.writeHead(404).end();
			return;
		}
		// Prevent ambient browser requests/DNS rebinding; only literal local origin is served.
		if (
			req.headers.host !== new URL(this.url).host ||
			req.headers.origin ||
			!authorized(req.headers.authorization, route.token)
		) {
			res.writeHead(401).end();
			return;
		}
		let bridge: Bridge | undefined;
		try {
			const id = req.headers["mcp-session-id"];
			if (id) {
				bridge = route.bridges.get(String(id));
				if (!bridge) {
					res.writeHead(404).end();
					return;
				}
			} else {
				if (req.method !== "POST") {
					res.writeHead(400).end();
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of req) {
					size += chunk.length;
					if (size > 4 * 1024 * 1024) {
						res.writeHead(413).end();
						return;
					}
					chunks.push(chunk);
				}
				const body = JSON.parse(
					Buffer.concat(chunks).toString(),
				) as JSONRPCMessage;
				if (!body || !("method" in body) || body.method !== "initialize") {
					res.writeHead(400).end();
					return;
				}
				bridge = await this.bridge(route);
				await bridge.down.handleRequest(req, res, body);
				if (bridge.down.sessionId && !route.closed && !bridge.closed) {
					route.pending.delete(bridge);
					route.bridges.set(bridge.down.sessionId, bridge);
				}
				return;
			}
			await bridge.down.handleRequest(req, res);
			if (req.method === "DELETE") await bridge.close();
		} catch {
			if (!res.headersSent)
				res
					.writeHead(502, { "content-type": "application/json" })
					.end(JSON.stringify({ error: failure().message }));
			else res.end();
			if (bridge && !bridge.down.sessionId) await bridge.close();
		}
	}
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const routes = [...this.routes.values()];
		this.routes.clear();
		await Promise.allSettled(
			routes.flatMap((r) => {
				r.closed = true;
				return [...new Set([...r.bridges.values(), ...r.pending])].map((b) =>
					b.close(),
				);
			}),
		);
		this.http.closeAllConnections();
		await new Promise<void>((resolve) => this.http.close(() => resolve()));
	}
}
