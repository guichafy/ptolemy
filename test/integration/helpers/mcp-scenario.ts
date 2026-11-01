import assert from "node:assert/strict";
import {
	appendFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildQueryOptions } from "../../../src/bun/claude/session-options";
import { buildCodexEnv } from "../../../src/bun/codex/codex-cli";
import { CodexSessionRuntime } from "../../../src/bun/codex/session-runtime";
import { McpOAuthService } from "../../../src/bun/mcp/oauth";
import { McpRegistry } from "../../../src/bun/mcp/registry";
import {
	disposeSessionMcp,
	inheritedCodexMcpNames,
	prepareSessionMcp,
} from "../../../src/bun/mcp/runtime";
import { MemorySecretVault } from "../../../src/bun/mcp/secrets";
import { configureLocalAgents } from "./local-agents";

const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-cli-"));
process.env.PTOLEMY_HOME = root;
delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
const mocks = await configureLocalAgents(
	root,
	join(import.meta.dir, "../../.."),
);
const vault = new MemorySecretVault();
const registry = new McpRegistry({
	path: join(root, "registry.json"),
	legacyPath: join(root, "old.json"),
	vault,
});
let calls = 0;
let inherited = 0;
let refreshes = 0;
let registrations = 0;
let rejects = 0;
let currentToken = "initial-private-token";
let revoked = false;
const received: string[] = [];
const bodies: unknown[] = [];
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	async fetch(req): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/inherited") {
			inherited++;
			return new Response(null, { status: 500 });
		}
		if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
			return Response.json({
				resource: `${origin}/mcp`,
				authorization_servers: [origin],
			});
		if (url.pathname === "/.well-known/oauth-authorization-server")
			return Response.json({
				issuer: origin,
				authorization_endpoint: `${origin}/authorize`,
				token_endpoint: `${origin}/token`,
				registration_endpoint: `${origin}/register`,
				response_types_supported: ["code"],
				grant_types_supported: ["authorization_code", "refresh_token"],
				code_challenge_methods_supported: ["S256"],
				token_endpoint_auth_methods_supported: ["none"],
			});
		if (url.pathname === "/register") {
			registrations++;
			return Response.json({
				...((await req.json()) as object),
				client_id: "fixture-client",
			});
		}
		if (url.pathname === "/token") {
			const body = new URLSearchParams(await req.text());
			if (body.get("grant_type") === "refresh_token") {
				refreshes++;
				currentToken = "refreshed-private-token";
				revoked = false;
			}
			return Response.json({
				access_token: currentToken,
				token_type: "Bearer",
				expires_in: 3600,
				refresh_token: "refresh-private-token",
			});
		}
		if (url.pathname !== "/mcp") return new Response(null, { status: 404 });
		received.push(req.headers.get("authorization") ?? "");
		if (
			req.headers.get("authorization") !== `Bearer ${currentToken}` ||
			revoked
		) {
			rejects++;
			return new Response("PRIVATE-AUTH-BODY", {
				status: 401,
				headers: {
					"WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
				},
			});
		}
		if (req.method === "GET" || req.method === "DELETE")
			return new Response(null, { status: 405 });
		const body = (await req.json()) as {
			id?: number;
			method: string;
			params?: Record<string, unknown>;
		};
		bodies.push(body);
		if (body.id === undefined) return new Response(null, { status: 202 });
		if (body.method === "tools/call") calls++;
		const result =
			body.method === "initialize"
				? {
						protocolVersion: body.params?.protocolVersion,
						capabilities: { tools: {} },
						serverInfo: { name: "fixture", version: "1" },
					}
				: body.method === "tools/list"
					? {
							tools: [
								{
									name: "echo",
									description: "Ptolemy offline MCP echo",
									inputSchema: { type: "object", properties: {} },
								},
							],
						}
					: body.method === "tools/call"
						? { content: [{ type: "text", text: "MCP_CALL_CONFIRMED" }] }
						: {};
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	},
});
const origin: string = `http://127.0.0.1:${server.port}`;
const oauth = new McpOAuthService({
	registry,
	vault,
	openBrowser: async (value) => {
		const url = new URL(value);
		const callback = new URL(url.searchParams.get("redirect_uri")!);
		callback.searchParams.set("code", "fixture-code");
		callback.searchParams.set("state", url.searchParams.get("state")!);
		await fetch(callback);
	},
});
try {
	const workspace = join(root, "workspace");
	await mkdir(workspace);
	const cwd = await realpath(workspace);
	const init = Bun.spawn(["/usr/bin/git", "init", "--quiet", cwd], {
		stdout: "ignore",
		stderr: "ignore",
	});
	assert.equal(await init.exited, 0);
	await mkdir(join(cwd, ".ptolemy/claude-harness"), { recursive: true });
	await writeFile(
		join(cwd, ".ptolemy/claude-harness/.claude-plugin.json"),
		JSON.stringify({ name: "fixture", version: "1.0.0" }),
	);
	await registry.save({
		id: "oauth",
		name: "selected",
		transport: "http",
		url: `${origin}/mcp`,
		auth: { type: "oauth" },
		defaults: { claude: false, codex: false },
	});
	await oauth.connect("oauth");
	for (let i = 0; (await oauth.status("oauth")).state !== "connected"; i++) {
		assert(i < 500, "OAuth setup timed out");
		await Bun.sleep(5);
	}
	await appendFile(
		join(root, ".codex/config.toml"),
		`\n[mcp_servers."inherited.with.dot"]\nurl=${JSON.stringify(`${origin}/inherited`)}\n`,
	);
	await writeFile(
		join(cwd, ".mcp.json"),
		JSON.stringify({
			mcpServers: {
				"inherited.with.dot": { type: "http", url: `${origin}/inherited` },
			},
		}),
	);
	await appendFile(
		join(root, ".codex/config.toml"),
		`
[projects.${JSON.stringify(cwd)}]
trust_level="trusted"
`,
	);
	await mkdir(join(cwd, ".codex"));
	await writeFile(
		join(cwd, ".codex/config.toml"),
		`[mcp_servers."project.with.dot"]
url=${JSON.stringify(`${origin}/inherited`)}
`,
	);
	const rootConfigBefore = await readFile(
		join(root, ".codex/config.toml"),
		"utf8",
	);
	const projectConfigBefore = await readFile(
		join(cwd, ".codex/config.toml"),
		"utf8",
	);
	const inheritedNames = await inheritedCodexMcpNames(
		process.env.PTOLEMY_CODEX_PATH!,
		cwd,
		await buildCodexEnv(),
	);
	assert(inheritedNames.includes("inherited.with.dot"));
	assert(inheritedNames.includes("project.with.dot"));
	assert.equal(inherited, 0);
	for (const agent of ["claude", "codex"] as const) {
		const context = await prepareSessionMcp(
			agent,
			cwd,
			await registry.snapshot(["oauth"]),
			agent,
			{ registry, oauth },
		);
		const configText = JSON.stringify([context.servers, context.codexConfig]);
		assert(!configText.includes(currentToken));
		assert(!configText.includes(Object.values(context.env)[0]));
		const before = calls;
		if (agent === "claude") {
			const q = query({
				prompt: "PTOLEMY_MCP_CALL selected echo",
				options: {
					...buildQueryOptions({
						model: "haiku",
						claudePath: process.env.PTOLEMY_CLAUDE_PATH!,
						cwd,
						mcpServers: context.servers,
						explicitMcpSelection: true,
						mcpEnv: context.env,
						canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
					}),
					allowedTools: ["mcp__selected__echo"],
				},
			});
			for await (const message of q) {
				if (message.type === "result") assert.equal(message.subtype, "success");
			}
			q.close();
			await context.dispose();
		} else {
			const events: unknown[] = [];
			const runtime = new CodexSessionRuntime({
				sessionId: "mcp",
				cwd,
				threadId: null,
				mcp: context,
				sender: { sendEvent: (_id, event) => events.push(event) },
				persister: { appendMessage: async () => {} },
				loadConfig: async () => ({
					model: "default",
					sandboxMode: "workspace-write",
					reasoningEffort: "",
				}),
				onThreadId: () => {},
				readSessionInfo: async () => null,
			});
			await runtime.enqueue(
				`PTOLEMY_MCP_CALL ${Object.keys(context.codexConfig)[0]} echo`,
			);
			assert(
				!events.some((e) => (e as { type: string }).type === "error"),
				JSON.stringify(events),
			);
			await runtime.close();
		}
		assert.equal(calls, before + 1, `${agent} actual tool call missing`);
		assert.equal(inherited, 0);
	}
	for (const agent of ["claude", "codex"] as const) {
		const context = await prepareSessionMcp(
			`none-${agent}`,
			cwd,
			{ version: 1, servers: [] },
			agent,
			{ registry, oauth },
		);
		const before = bodies.length;
		if (agent === "claude") {
			const q = query({
				prompt: "Responda apenas oi",
				options: buildQueryOptions({
					model: "haiku",
					claudePath: process.env.PTOLEMY_CLAUDE_PATH!,
					cwd,
					mcpServers: {},
					explicitMcpSelection: true,
					mcpEnv: context.env,
					canUseTool: async () => ({ behavior: "deny", message: "none" }),
				}),
			});
			for await (const message of q) {
				if (message.type === "result") assert.equal(message.subtype, "success");
			}
			q.close();
		} else {
			const runtime = new CodexSessionRuntime({
				sessionId: "none",
				cwd,
				threadId: null,
				mcp: context,
				sender: { sendEvent: () => {} },
				persister: { appendMessage: async () => {} },
				loadConfig: async () => ({
					model: "default",
					sandboxMode: "workspace-write",
					reasoningEffort: "",
				}),
				onThreadId: () => {},
				readSessionInfo: async () => null,
			});
			await runtime.enqueue("Responda apenas oi");
			await runtime.close();
		}
		await context.dispose();
		assert.equal(bodies.length, before);
		assert.equal(inherited, 0);
	}
	// Native stdio maps are scoped per server and never inherit model auth from app.
	process.env.PTOLEMY_APP_PRIVATE = "APP_SECRET_SENTINEL";
	const fixture = join(root, "stdio.mjs");
	await writeFile(
		fixture,
		`import {createInterface} from 'node:readline'; if(process.env.STUBBORN){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);} const lines=createInterface({input:process.stdin}); lines.on('line',s=>{const m=JSON.parse(s);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'native',version:'1'}}:m.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:JSON.stringify({key:process.env.API_KEY,other:process.env.OTHER_PRIVATE,app:process.env.PTOLEMY_APP_PRIVATE,auth:process.env.ANTHROPIC_API_KEY,pid:process.pid})}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`,
	);
	for (const [id, key] of [
		["native_one", "one-secret"],
		["native_two", "two-secret"],
	])
		await registry.save({
			id,
			name: id,
			transport: "stdio",
			command: process.execPath,
			args: [fixture],
			env: {
				API_KEY: key,
				...(id === "native_one"
					? { OTHER_PRIVATE: "one-only" }
					: { STUBBORN: "1" }),
			},
			defaults: { claude: false, codex: false },
		});
	const native = await prepareSessionMcp(
		"native",
		cwd,
		await registry.snapshot(["native_one", "native_two"]),
		"codex",
		{ registry },
	);
	const pids: number[] = [];
	for (const [name, expected] of [
		["native_one", "one-secret"],
		["native_two", "two-secret"],
	]) {
		const config = native.servers[name] as { url: string };
		const client = new Client({ name: "test", version: "1" });
		await client.connect(
			new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: {
					headers: { Authorization: `Bearer ${Object.values(native.env)[0]}` },
				},
			}),
		);
		const result = (await client.callTool({ name: "echo", arguments: {} })) as {
			content: Array<{ text: string }>;
		};
		const data = JSON.parse(result.content[0].text);
		assert.equal(data.key, expected);
		assert.equal(data.app, undefined);
		assert.equal(data.auth, undefined);
		if (name === "native_two") assert.equal(data.other, undefined);
		pids.push(data.pid);
		await client.close();
	}
	await native.dispose();
	for (const pid of pids) assert.throws(() => process.kill(pid, 0));
	// A live OAuth token rejected mid-session is refreshed once without any CLI auth flow.
	const context = await prepareSessionMcp(
		"refresh",
		cwd,
		await registry.snapshot(["oauth"]),
		"claude",
		{ registry, oauth },
	);
	const client = new Client({ name: "refresh", version: "1" });
	await client.connect(
		new StreamableHTTPClientTransport(
			new URL((context.servers.selected as { url: string }).url),
			{
				requestInit: {
					headers: { Authorization: `Bearer ${Object.values(context.env)[0]}` },
				},
			},
		),
	);
	revoked = true;
	await client.callTool({ name: "echo", arguments: {} });
	assert.equal(refreshes, 1);
	assert.equal(registrations, 1);
	assert.equal(rejects, 1);
	await client.close();
	await context.dispose();
	assert(
		received.every(
			(value) =>
				value.startsWith("Bearer ") &&
				!Object.values(context.env).some((v) => value.includes(v)),
		),
	);
	assert.equal(
		await readFile(join(root, ".codex/config.toml"), "utf8"),
		rootConfigBefore,
	);
	assert.equal(
		await readFile(join(cwd, ".codex/config.toml"), "utf8"),
		projectConfigBefore,
	);
	// Undefined legacy selection keeps native inheritance and does not approve its tools.
	const legacy = await prepareSessionMcp(
		"legacy",
		cwd,
		{ version: 1, servers: [] },
		"codex",
		{ registry },
	);
	legacy.explicit = false;
	const legacyRuntime = new CodexSessionRuntime({
		sessionId: "legacy",
		cwd,
		threadId: null,
		mcp: legacy,
		sender: { sendEvent: () => {} },
		persister: { appendMessage: async () => {} },
		loadConfig: async () => ({
			model: "default",
			sandboxMode: "workspace-write",
			reasoningEffort: "",
		}),
		onThreadId: () => {},
		readSessionInfo: async () => null,
	});
	await legacyRuntime.enqueue("Responda apenas oi");
	await legacyRuntime.close();
	assert(inherited > 0, "Legacy inherited MCP was silently disabled");
	console.log(
		"MCP actual calls: claude,codex; none and inherited suppression; native isolation; OAuth refresh",
	);
} finally {
	await disposeSessionMcp();
	await oauth.dispose();
	server.stop(true);
	mocks.stop();
	await rm(root, { recursive: true, force: true });
}
