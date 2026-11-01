import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	EmptyResultSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
	ResourceListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, expect, test } from "vitest";
import { McpGateway } from "./gateway";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function upstream() {
	const sessions = new Map<string, StreamableHTTPServerTransport>();
	const tokens: string[] = [];
	const methods: string[] = [];
	let calls = 0;
	const http: HttpServer = createServer(async (req, res) => {
		tokens.push(req.headers.authorization ?? "");
		if (req.headers.authorization !== "Bearer external") {
			res
				.writeHead(401, {
					"WWW-Authenticate":
						'Bearer resource_metadata="https://private/token"',
				})
				.end("PRIVATE");
			return;
		}
		if (req.headers["mcp-session-id"] && !req.headers["mcp-protocol-version"]) {
			res.writeHead(400).end("Missing negotiated protocol version");
			return;
		}
		let transport = sessions.get(String(req.headers["mcp-session-id"]));
		if (!transport && req.method === "POST") {
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
			});
			const server = new Server(
				{ name: "fixture", version: "1" },
				{
					capabilities: {
						tools: {},
						resources: { listChanged: true },
						prompts: {},
					},
				},
			);
			server.setRequestHandler(ListToolsRequestSchema, async () => ({
				tools: [
					{
						name: "echo",
						description: "echo",
						inputSchema: { type: "object" },
					},
				],
			}));
			server.setRequestHandler(CallToolRequestSchema, async () => {
				calls++;
				await server.request({ method: "ping" }, EmptyResultSchema);
				await server.notification({
					method: "notifications/resources/list_changed",
				});
				return { content: [{ type: "text", text: "called" }] };
			});
			server.setRequestHandler(ListResourcesRequestSchema, async () => ({
				resources: [{ uri: "fixture://one", name: "one" }],
			}));
			server.setRequestHandler(ReadResourceRequestSchema, async () => ({
				contents: [{ uri: "fixture://one", text: "resource" }],
			}));
			server.setRequestHandler(ListPromptsRequestSchema, async () => ({
				prompts: [{ name: "one" }],
			}));
			server.setRequestHandler(GetPromptRequestSchema, async () => ({
				messages: [{ role: "user", content: { type: "text", text: "prompt" } }],
			}));
			await server.connect(transport);
			const original = transport.onmessage;
			transport.onmessage = (msg, extra) => {
				if ("method" in msg) methods.push(msg.method);
				original?.(msg, extra);
			};
		}
		if (!transport) {
			res.writeHead(404).end();
			return;
		}
		await transport.handleRequest(req, res);
		if (req.method === "DELETE" && transport.sessionId)
			sessions.delete(transport.sessionId);
		if (transport.sessionId && req.method !== "DELETE")
			sessions.set(transport.sessionId, transport);
	});
	http.listen(0, "127.0.0.1");
	await once(http, "listening");
	cleanup.push(async () => {
		for (const t of sessions.values()) await t.close();
		http.closeAllConnections();
		await new Promise<void>((r) => http.close(() => r()));
	});
	return {
		url: `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
		tokens,
		methods,
		get calls() {
			return calls;
		},
		sessions,
	};
}
async function connect(url: string, token: string) {
	const client = new Client(
		{ name: "test", version: "1" },
		{ capabilities: {} },
	);
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: { headers: { Authorization: `Bearer ${token}` } },
	});
	await client.connect(transport);
	cleanup.push(() => client.close());
	return { client, transport };
}
test("selected routes enforce per-session authorization and preserve all MCP surfaces and notification delivery", async () => {
	const remote = await upstream();
	const gateway = await McpGateway.create();
	cleanup.push(() => gateway.dispose());
	const one = gateway.addSession(
		"one",
		[
			{
				id: "selected",
				name: "Selected",
				transport: "http",
				url: remote.url,
				headers: { Authorization: "Bearer external" },
				defaults: { claude: false, codex: false },
			},
		],
		"/tmp",
	);
	const two = gateway.addSession("two", [], "/tmp");
	expect(
		(
			await fetch(one.routes[0].url, {
				headers: { Authorization: `Bearer ${two.token}` },
			})
		).status,
	).toBe(401);
	expect(
		(
			await fetch(`${gateway.url}/unknown`, {
				headers: { Authorization: `Bearer ${one.token}` },
			})
		).status,
	).toBe(404);
	expect(remote.tokens).toEqual([]);
	const { client, transport } = await connect(one.routes[0].url, one.token);
	const second = await connect(one.routes[0].url, one.token);
	expect(second.transport.sessionId).not.toBe(transport.sessionId);
	expect(remote.sessions.size).toBe(2);
	expect(remote.sessions.has(transport.sessionId!)).toBe(false);
	let notifications = 0;
	client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
		notifications++;
	});
	expect((await client.listTools()).tools[0].name).toBe("echo");
	expect((await client.listResources()).resources[0].uri).toBe("fixture://one");
	expect(
		(await client.readResource({ uri: "fixture://one" })).contents[0],
	).toMatchObject({ text: "resource" });
	expect((await client.listPrompts()).prompts[0].name).toBe("one");
	expect(
		(await client.getPrompt({ name: "one" })).messages[0].content,
	).toMatchObject({ text: "prompt" });
	expect(await client.callTool({ name: "echo", arguments: {} })).toMatchObject({
		content: [{ text: "called" }],
	});
	await new Promise((r) => setTimeout(r, 30));
	expect(notifications).toBe(1);
	expect(remote.calls).toBe(1);
	expect(remote.tokens.every((t) => t === "Bearer external")).toBe(true);
	const spoof = await fetch(one.routes[0].url, {
		headers: {
			Authorization: `Bearer ${one.token}`,
			"mcp-session-id": "other-session",
			Accept: "text/event-stream",
		},
	});
	expect(spoof.status).toBe(404);
	await one.dispose();
	expect(remote.sessions.size).toBe(0);
	expect(
		(
			await fetch(one.routes[0].url, {
				headers: { Authorization: `Bearer ${one.token}` },
			})
		).status,
	).toBe(404);
	expect(transport.sessionId).toBeDefined();
});
test("OAuth headers are fetched per request, rejected valid tokens refresh once, and upstream challenges stay private", async () => {
	const remote = await upstream();
	const gateway = await McpGateway.create();
	cleanup.push(() => gateway.dispose());
	let token = "old";
	let refreshes = 0;
	const snapshots: unknown[] = [];
	const definition = {
		id: "oauth",
		name: "OAuth",
		transport: "http" as const,
		url: remote.url,
		auth: { type: "oauth" as const },
		defaults: { claude: false, codex: false },
	};
	const one = gateway.addSession("one", [definition], "/tmp", {
		getAccessToken: async (_id, expected, rejected) => {
			snapshots.push(expected);
			if (rejected === token) {
				refreshes++;
				token = refreshes === 1 ? "external" : "rejected";
			}
			return token;
		},
	});
	const { client } = await connect(one.routes[0].url, one.token);
	expect((await client.listTools()).tools).toHaveLength(1);
	expect(refreshes).toBe(1);
	expect(snapshots.every((s) => s === definition)).toBe(true);
	token = "bad-again";
	await expect(client.listTools()).rejects.toThrow("Falha na conexão MCP");
	expect(refreshes).toBe(2);
});
