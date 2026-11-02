import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { AgentKind } from "../../shared/agent-protocol";
import type { McpSnapshot } from "../../shared/mcp";
import { McpGateway } from "./gateway";
import { type McpOAuthService, mcpOAuthService } from "./oauth";
import { type McpRegistry, mcpRegistry } from "./registry";

export interface CodexMcpServer {
	enabled: true;
	url: string;
	bearer_token_env_var: string;
}
export interface PreparedSessionMcp {
	servers: Record<string, McpServerConfig>;
	codexConfig: Record<string, CodexMcpServer>;
	/** Local gateway auth only. External credential bytes never enter this object. */
	env: Record<string, string>;
	/** False only for old sessions without a selection snapshot. */
	explicit?: boolean;
	dispose(): Promise<void>;
}
const live = new Set<PreparedSessionMcp>();
export async function prepareSessionMcp(
	sessionId: string,
	cwd: string,
	snapshot: McpSnapshot,
	_agent: AgentKind,
	deps: { registry?: McpRegistry; oauth?: McpOAuthService } = {},
): Promise<PreparedSessionMcp> {
	const registry = deps.registry ?? mcpRegistry;
	const servers: PreparedSessionMcp["servers"] = {};
	const codexConfig: PreparedSessionMcp["codexConfig"] = {};
	if (snapshot.version !== 1 || !Array.isArray(snapshot.servers))
		throw Error("Seleção MCP inválida.");
	// Resolve validates snapshots; even explicit none must keep its distinct frozen meaning.
	const resolved = await registry.resolve(snapshot);
	if (resolved.length === 0)
		return { servers, codexConfig, env: {}, dispose: async () => {} };
	const gateway = await McpGateway.create();
	const oauth = deps.oauth ?? mcpOAuthService;
	const routes = gateway.addSession(sessionId, resolved, cwd, {
		getAccessToken: (id, expected, rejected) =>
			oauth.getAccessToken(id, expected, rejected),
		definitions: new Map(
			snapshot.servers.flatMap((server) =>
				server.transport === "http" ? [[server.id, server] as const] : [],
			),
		),
	});
	const variable = `PTOLEMY_MCP_${randomBytes(12).toString("hex").toUpperCase()}`;
	for (const route of routes.routes) {
		// Stable registry names preserve tool identity across cold resume. Registry enforces uniqueness.
		servers[route.name] = {
			type: "http",
			url: route.url,
			headers: { Authorization: `Bearer \${${variable}}` },
		};
		codexConfig[mcpRuntimeName(route.id, route.name)] = {
			enabled: true,
			url: route.url,
			bearer_token_env_var: variable,
		};
	}
	let disposed = false;
	const context: PreparedSessionMcp = {
		servers,
		codexConfig,
		env: { [variable]: routes.token },
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			live.delete(context);
			await gateway.dispose();
		},
	};
	live.add(context);
	return context;
}
/** Codex tables merge inherited fields; use a separate stable namespace per logical server. */
export function mcpRuntimeName(id: string, name: string): string {
	return `ptolemy_${createHash("sha256").update(id).digest("hex").slice(0, 16)}_${
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "")
			.slice(0, 32) || "server"
	}`;
}
export async function disposeSessionMcp() {
	await Promise.allSettled([...live].map((context) => context.dispose()));
}

export interface InheritedCodexMcpServer {
	name: string;
	transport: "stdio" | "streamable_http";
}
/** Exact raw top-level TOML table; quoted names (including dots) must not be SDK flattened.
 * Inventory includes derived servers absent from TOML. A disabled entry still
 * needs a valid transport; preserve its kind to avoid merging command and URL. */
export function buildCodexMcpOverrides(
	selected: PreparedSessionMcp["codexConfig"],
	inheritedServers: InheritedCodexMcpServer[],
): string[] {
	const entries = new Map<string, string>(
		inheritedServers.map((server) => [
			server.name,
			server.transport === "stdio"
				? '{enabled=false,command="/usr/bin/false"}'
				: '{enabled=false,url="http://127.0.0.1:0/disabled"}',
		]),
	);
	for (const [name, server] of Object.entries(selected)) {
		if (entries.has(name))
			throw Error("Conflito com o nome de um servidor MCP herdado.");
		entries.set(
			name,
			`{enabled=true,url=${JSON.stringify(server.url)},bearer_token_env_var=${JSON.stringify(server.bearer_token_env_var)},default_tools_approval_mode="approve"}`,
		);
	}
	return [
		`mcp_servers={${[...entries].map(([name, config]) => `${JSON.stringify(name)}=${config}`).join(",")}}`,
	];
}
export function localMcpEnv<T extends Record<string, string | undefined>>(
	env: T,
): T & { NO_PROXY: string; no_proxy: string } {
	const add = (value: string | undefined) =>
		[
			...new Set([
				...(value?.split(",").filter(Boolean) ?? []),
				"127.0.0.1",
				"localhost",
				"::1",
			]),
		].join(",");
	return { ...env, NO_PROXY: add(env.NO_PROXY), no_proxy: add(env.no_proxy) };
}
/** Backend-only inventory: never print CLI JSON, stderr or config values. Fresh per execution. */
export async function inheritedCodexMcpServers(
	cli: string,
	cwd: string,
	env: Record<string, string>,
): Promise<InheritedCodexMcpServer[]> {
	try {
		const { stdout } = await promisify(execFile)(
			"/usr/bin/sandbox-exec",
			[
				"-p",
				"(version 1)(allow default)(deny network*)(deny file-write*)",
				cli,
				"mcp",
				"list",
				"--json",
			],
			{ cwd, env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
		);
		const entries: unknown = JSON.parse(stdout);
		if (
			!Array.isArray(entries) ||
			entries.some(
				(e) =>
					!e ||
					typeof e.name !== "string" ||
					!["stdio", "streamable_http"].includes(e.transport?.type),
			)
		)
			throw Error();
		return entries.map((e) => ({
			name: e.name as string,
			transport: e.transport.type as InheritedCodexMcpServer["transport"],
		}));
	} catch {
		throw Error(
			"Não foi possível verificar os servidores MCP herdados do Codex.",
		);
	}
}

/** Metadata-only convenience for callers that need names, not configuration. */
export async function inheritedCodexMcpNames(
	cli: string,
	cwd: string,
	env: Record<string, string>,
): Promise<string[]> {
	return (await inheritedCodexMcpServers(cli, cwd, env)).map(
		(server) => server.name,
	);
}
