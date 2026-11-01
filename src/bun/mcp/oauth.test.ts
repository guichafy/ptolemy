import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerDefinition } from "../../shared/mcp";
import * as proxy from "../net/proxy";
import { McpOAuthService } from "./oauth";
import { McpRegistry } from "./registry";
import { MemorySecretVault } from "./secrets";

// Real SDK HTTP requests, real PKCE verification and real loopback callbacks.
// Catches cross-resource token use, missing state validation and racing refresh/cancel.
describe("MCP browser OAuth", () => {
	let root: string;
	let server: Server;
	let origin: string;
	let registry: McpRegistry;
	let oauth: McpOAuthService;
	let opened: URL[];
	let exchanges: number;
	let refreshes: number;
	let revocations: number;
	let now: number;
	let wrongResource: boolean;
	let wrongIssuer: boolean;
	let tokenDelay: number;
	let deniedRefresh: boolean;
	let tokenType: string;
	let tokenScope: string | undefined;
	const registeredRedirects = new Map<string, string[]>();
	let authorizationRequests: number;
	let issuerPath: string;
	let metadataRequests: number;
	let metadataDelay: number;
	let tokenRequests: number;
	let registrations: number;
	let issueRefresh: boolean;
	let lastTokenParams: URLSearchParams;
	const codes = new Map<
		string,
		{ challenge: string; redirect: string; resource: string }
	>();
	async function waitFor(check: () => Promise<boolean> | boolean) {
		const deadline = Date.now() + 3000;
		while (!(await check())) {
			if (Date.now() > deadline) throw Error("timed out");
			await new Promise((r) => setTimeout(r, 5));
		}
	}
	async function finish(
		url: URL = opened[0],
		options: { wrongState?: boolean; deny?: boolean; issuer?: string } = {},
	) {
		const callback = new URL(url.searchParams.get("redirect_uri")!);
		callback.searchParams.set(
			"state",
			options.wrongState ? "wrong" : url.searchParams.get("state")!,
		);
		if (options.deny) callback.searchParams.set("error", "access_denied");
		else {
			const code = `code-${codes.size}`;
			codes.set(code, {
				challenge: url.searchParams.get("code_challenge")!,
				redirect: callback.origin + callback.pathname,
				resource: url.searchParams.get("resource")!,
			});
			callback.searchParams.set("code", code);
		}
		if (options.issuer) callback.searchParams.set("iss", options.issuer);
		return fetch(callback);
	}
	async function start() {
		expect((await oauth.connect("one")).state).toBe("connecting");
		await waitFor(() => opened.length > 0);
		expect((await oauth.status("one")).state).toBe("waiting");
	}
	async function authorize() {
		await start();
		await finish();
		await waitFor(
			async () => (await oauth.status("one")).state === "connected",
		);
	}
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-oauth-"));
		opened = [];
		exchanges = 0;
		refreshes = 0;
		revocations = 0;
		now = Date.now();
		wrongResource = false;
		wrongIssuer = false;
		tokenDelay = 0;
		deniedRefresh = false;
		tokenType = "Bearer";
		tokenScope = "read";
		tokenRequests = 0;
		registrations = 0;
		issueRefresh = true;
		lastTokenParams = new URLSearchParams();
		codes.clear();
		registeredRedirects.clear();
		issuerPath = "";
		metadataRequests = 0;
		metadataDelay = 0;
		authorizationRequests = 0;
		server = createServer(async (req, res) => {
			const url = new URL(req.url!, origin);
			res.setHeader("content-type", "application/json");
			if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
				metadataRequests++;
				if (metadataDelay)
					await new Promise((resolve) => setTimeout(resolve, metadataDelay));
				res.end(
					JSON.stringify({
						resource: wrongResource
							? "https://other.example/mcp"
							: `${origin}/mcp`,
						authorization_servers: [`${origin}${issuerPath}`],
						scopes_supported: ["read"],
					}),
				);
				return;
			}
			if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
				metadataRequests++;
				res.end(
					JSON.stringify({
						issuer: wrongIssuer
							? "https://other.example"
							: `${origin}${issuerPath}`,
						authorization_endpoint: `${origin}/authorize`,
						token_endpoint: `${origin}/token`,
						registration_endpoint: `${origin}/register`,
						revocation_endpoint: `${origin}/revoke`,
						response_types_supported: ["code"],
						grant_types_supported: ["authorization_code", "refresh_token"],
						code_challenge_methods_supported: ["S256"],
						token_endpoint_auth_methods_supported: [
							"none",
							"client_secret_post",
						],
					}),
				);
				return;
			}
			if (url.pathname === "/authorize") {
				authorizationRequests++;
				const redirect = url.searchParams.get("redirect_uri") ?? "";
				const client = url.searchParams.get("client_id") ?? "";
				const allowed = registeredRedirects.get(client) ?? [];
				const matches = allowed.some((registered) => {
					const expected = new URL(registered),
						actual = new URL(redirect);
					if (client === "pre-registered") actual.port = expected.port; // RFC 8252 native loopback port exception only.
					return actual.href === expected.href;
				});
				if (!matches) {
					res.statusCode = 400;
					res.end('{"error":"invalid_redirect_uri"}');
					return;
				}
				const callback = new URL(redirect);
				const code = `authorization-${codes.size}`;
				codes.set(code, {
					challenge: url.searchParams.get("code_challenge")!,
					redirect,
					resource: url.searchParams.get("resource")!,
				});
				callback.searchParams.set("code", code);
				callback.searchParams.set("state", url.searchParams.get("state")!);
				res.writeHead(302, { location: callback.href });
				res.end();
				return;
			}
			let body = "";
			for await (const b of req) body += b;
			if (url.pathname === "/register") {
				registrations++;
				const metadata = JSON.parse(body);
				registeredRedirects.set("ptolemy-test", metadata.redirect_uris);
				res.end(JSON.stringify({ ...metadata, client_id: "ptolemy-test" }));
				return;
			}
			if (url.pathname === "/revoke") {
				revocations++;
				res.end("{}");
				return;
			}
			if (url.pathname === "/token") {
				const p = new URLSearchParams(body);
				tokenRequests++;
				lastTokenParams = p;
				if (tokenDelay) await new Promise((r) => setTimeout(r, tokenDelay));
				if (p.get("grant_type") === "refresh_token") {
					refreshes++;
					if (deniedRefresh) {
						res.statusCode = 400;
						res.end(
							JSON.stringify({
								error: "invalid_grant",
								error_description: "secret-probe",
							}),
						);
						return;
					}
				} else {
					const code = codes.get(p.get("code")!);
					const challenge = createHash("sha256")
						.update(p.get("code_verifier") ?? "")
						.digest("base64url");
					if (
						!code ||
						challenge !== code.challenge ||
						p.get("redirect_uri") !== code.redirect ||
						p.get("resource") !== code.resource
					) {
						res.statusCode = 400;
						res.end('{"error":"invalid_grant"}');
						return;
					}
					codes.delete(p.get("code")!);
					exchanges++;
				}
				res.end(
					JSON.stringify({
						access_token: refreshes
							? "refreshed-secret-probe"
							: "access-secret-probe",
						token_type: tokenType,
						...(issueRefresh ? { refresh_token: "refresh-secret-probe" } : {}),
						expires_in: 3600,
						...(tokenScope === undefined ? {} : { scope: tokenScope }),
					}),
				);
				return;
			}
			res.statusCode = 404;
			res.end("{}");
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		const vault = new MemorySecretVault();
		registry = new McpRegistry({
			path: join(root, "registry.json"),
			legacyPath: join(root, "legacy.json"),
			vault,
		});
		await registry.save({
			id: "one",
			name: "One",
			transport: "http",
			url: `${origin}/mcp`,
			auth: { type: "oauth", scopes: ["read"] },
			defaults: { claude: true, codex: true },
		});
		oauth = new McpOAuthService({
			registry,
			vault,
			fetcher: fetch,
			openBrowser: async (url) => {
				opened.push(new URL(url));
			},
			now: () => now,
			timeoutMs: 2000,
		});
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await oauth?.dispose();
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server?.closeAllConnections();
		await rm(root, { recursive: true, force: true });
	});
	it("starts promptly, completes discovery/DCR/PKCE and keeps credentials out of status/list/snapshot", async () => {
		await authorize();
		expect(exchanges).toBe(1);
		expect(await oauth.getAccessToken("one")).toBe("access-secret-probe");
		expect(JSON.stringify(await registry.list())).not.toContain("secret-probe");
		expect(JSON.stringify(await registry.snapshot(["one"]))).not.toContain(
			"secret-probe",
		);
		expect(opened[0].searchParams.get("code_challenge_method")).toBe("S256");
		expect(JSON.stringify(await oauth.status("one"))).not.toContain(
			"secret-probe",
		);
		await expect(
			fetch(opened[0].searchParams.get("redirect_uri")!),
		).rejects.toThrow();
	});
	it("rejects a wrong state and closes the callback without exchanging a code", async () => {
		await start();
		await finish(opened[0], { wrongState: true });
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(exchanges).toBe(0);
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		await expect(
			fetch(opened[0].searchParams.get("redirect_uri")!),
		).rejects.toThrow();
	});
	it("reports denied login without reflecting remote errors", async () => {
		await start();
		await finish(opened[0], { deny: true });
		await waitFor(
			async () => (await oauth.status("one")).state === "cancelled",
		);
		expect(exchanges).toBe(0);
	});
	it("cancels and times out pending flows, closing listeners", async () => {
		await start();
		await oauth.cancel("one");
		expect((await oauth.status("one")).state).toBe("cancelled");
		await expect(
			fetch(opened[0].searchParams.get("redirect_uri")!),
		).rejects.toThrow();
		await oauth.dispose();
		opened = [];
		oauth = new McpOAuthService({
			registry,
			fetcher: fetch,
			openBrowser: async (url) => {
				opened.push(new URL(url));
			},
			timeoutMs: 250,
		});
		await start();
		await waitFor(async () => (await oauth.status("one")).state === "error");
		await expect(
			fetch(opened[0].searchParams.get("redirect_uri")!),
		).rejects.toThrow();
	});
	it("refreshes expired credentials once for concurrent callers and revokes on disconnect", async () => {
		await authorize();
		now += 3600_000;
		const tokens = await Promise.all(
			Array.from({ length: 8 }, () => oauth.getAccessToken("one")),
		);
		expect(tokens).toEqual(Array(8).fill("refreshed-secret-probe"));
		expect(refreshes).toBe(1);
		await oauth.disconnect("one");
		expect(revocations).toBeGreaterThan(0);
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		expect((await oauth.status("one")).state).toBe("disconnected");
	});
	it("refreshes a rejected unexpired token once with snapshot binding and coalesces concurrent rejections", async () => {
		await authorize();
		const snapshot = (await registry.snapshot(["one"])).servers[0];
		const rejected = await oauth.getAccessToken("one", snapshot);
		const tokens = await Promise.all(
			Array.from({ length: 8 }, () =>
				oauth.getAccessToken("one", snapshot, rejected),
			),
		);
		expect(tokens).toEqual(Array(8).fill("refreshed-secret-probe"));
		expect(refreshes).toBe(1);
		expect(opened).toHaveLength(1);
		await registry.save({
			...snapshot,
			url: `${origin}/changed`,
		} as McpServerDefinition);
		await expect(
			oauth.getAccessToken("one", snapshot, tokens[0]),
		).rejects.toThrow("alterada");
		expect(refreshes).toBe(1);
	});
	it("rejects wrong resource and issuer discovery before opening browser", async () => {
		wrongResource = true;
		await oauth.connect("one");
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(opened).toHaveLength(0);
		wrongResource = false;
		wrongIssuer = true;
		await oauth.connect("one");
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(opened).toHaveLength(0);
	});
	it("never shares tokens across edited same-id definitions or a stale snapshot", async () => {
		await authorize();
		const old = (await registry.snapshot(["one"])).servers[0];
		await registry.save({
			...old,
			...{
				url: `${origin}/different`,
				auth: { type: "oauth", clientId: "another", scopes: ["read"] },
			},
		} as McpServerDefinition);
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		await expect(oauth.getAccessToken("one", old)).rejects.toThrow("alterada");
		expect((await oauth.status("one")).state).toBe("disconnected");
	});
	it("does not restore credentials when cancelled while the callback exchange is in flight", async () => {
		await start();
		tokenDelay = 80;
		const callback = finish();
		await waitFor(() => tokenRequests > 0);
		await oauth.cancel("one");
		await callback.catch(() => {});
		await new Promise((r) => setTimeout(r, 100));
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		expect((await oauth.status("one")).state).toBe("cancelled");
	});
	it("removes failed refresh credentials without leaking token endpoint error bodies", async () => {
		await authorize();
		now += 3600_000;
		deniedRefresh = true;
		await expect(oauth.getAccessToken("one")).rejects.toThrow(
			"autenticação MCP",
		);
		expect(JSON.stringify(await oauth.status("one"))).not.toContain(
			"secret-probe",
		);
		expect(await oauth.getAccessToken("one")).toBeUndefined();
	});
	it("honors cancellation while connect is still looking up its definition", async () => {
		const pending = oauth.connect("one");
		await oauth.cancel("one");
		expect((await pending).state).toBe("cancelled");
		expect(opened).toHaveLength(0);
	});
	it("honors cancellation while an expired token lookup is still queued", async () => {
		await authorize();
		now += 3600_000;
		const pending = oauth.getAccessToken("one");
		await oauth.cancel("one");
		expect(await pending).toBeUndefined();
		expect(refreshes).toBe(0);
	});
	it("rejects unsupported token types and missing requested scopes before persisting", async () => {
		tokenType = "mac";
		await start();
		await finish();
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		tokenType = "Bearer";
		tokenScope = "different";
		opened = [];
		await start();
		await finish();
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(await oauth.getAccessToken("one")).toBeUndefined();
	});
	it("deduplicates concurrent connect calls and rejects callback issuer mismatches", async () => {
		await Promise.all([
			oauth.connect("one"),
			oauth.connect("one"),
			oauth.connect("one"),
		]);
		await waitFor(() => opened.length > 0);
		expect(opened).toHaveLength(1);
		expect(registrations).toBe(1);
		await finish(opened[0], { issuer: "https://other.example" });
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(exchanges).toBe(0);
	});
	it("uses a pre-registered client and its vaulted secret without dynamic registration", async () => {
		const d = await registry.get("one");
		if (d.transport !== "http") throw Error("fixture");
		d.auth = { type: "oauth", clientId: "pre-registered", scopes: ["read"] };
		await registry.save(d, { "oauth.clientSecret": "client-secret-probe" });
		await authorize();
		expect(registrations).toBe(0);
		expect(lastTokenParams.get("client_secret")).toBe("client-secret-probe");
		expect(opened[0].searchParams.get("client_id")).toBe("pre-registered");
	});
	it("aborts in-flight refresh before disconnect returns without restoring its token", async () => {
		await authorize();
		now += 3600_000;
		tokenDelay = 100;
		const pending = oauth.getAccessToken("one").catch((error) => error);
		await waitFor(() => tokenRequests === 2);
		await oauth.disconnect("one");
		expect(await pending).toBeInstanceOf(Error);
		expect(await oauth.getAccessToken("one")).toBeUndefined();
	});
	it("keeps stdio and non-OAuth HTTP listings disconnected instead of reporting OAuth errors", async () => {
		await registry.save({
			id: "stdio",
			name: "stdio",
			transport: "stdio",
			command: "x",
			defaults: { claude: true, codex: false },
		});
		await registry.save({
			id: "http",
			name: "http",
			transport: "http",
			url: `${origin}/public`,
			defaults: { claude: true, codex: false },
		});
		expect(
			(await registry.list())
				.filter((s) => s.id !== "one")
				.map((s) => s.connection.state),
		).toEqual(["disconnected", "disconnected"]);
	});
	it.each([
		{ issuer: "https://issuer.example" },
		{ resource: "REPLACE_ORIGIN" },
		{ clientId: "another-client" },
		{ scopes: ["different"] },
	])("isolates a same-id OAuth config edit %j", async (edit) => {
		await authorize();
		const old = (await registry.snapshot(["one"])).servers[0];
		if (old.transport !== "http") throw Error("fixture");
		const actual = {
			...edit,
			...(edit.resource ? { resource: `${origin}/` } : {}),
		};
		await registry.save({ ...old, auth: { ...old.auth!, ...actual } });
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		await expect(oauth.getAccessToken("one", old)).rejects.toThrow("alterada");
	});
	it("rejects credentials from a callback when its same-id config changes during exchange", async () => {
		await start();
		tokenDelay = 80;
		const pending = finish();
		await waitFor(() => tokenRequests === 1);
		const d = await registry.get("one");
		if (d.transport !== "http") throw Error("fixture");
		await registry.save({ ...d, auth: { ...d.auth!, clientId: "changed" } });
		await pending;
		await new Promise((r) => setTimeout(r, 100));
		expect(await oauth.getAccessToken("one")).toBeUndefined();
	});
	it("bypasses the app proxy for explicit loopback OAuth endpoints", async () => {
		const proxied = vi
			.spyOn(proxy, "fetchWithProxy")
			.mockRejectedValue(Error("proxy-password-probe"));
		await oauth.dispose();
		oauth = new McpOAuthService({
			registry,
			openBrowser: async (url) => {
				opened.push(new URL(url));
			},
			now: () => now,
		});
		await authorize();
		expect(proxied).not.toHaveBeenCalled();
		expect(await oauth.getAccessToken("one")).toBe("access-secret-probe");
	});
	it("uses proxy-aware fetch for remote HTTPS and never exposes proxy errors", async () => {
		const proxied = vi
			.spyOn(proxy, "fetchWithProxy")
			.mockRejectedValue(Error("proxy-password-probe"));
		const d = await registry.get("one");
		if (d.transport !== "http") throw Error("fixture");
		await registry.save({ ...d, url: "https://remote.example/mcp" });
		await oauth.dispose();
		oauth = new McpOAuthService({
			registry,
			openBrowser: async (url) => {
				opened.push(new URL(url));
			},
		});
		await oauth.connect("one");
		await waitFor(async () => (await oauth.status("one")).state === "error");
		expect(proxied).toHaveBeenCalled();
		expect(JSON.stringify(await oauth.status("one"))).not.toContain(
			"proxy-password-probe",
		);
		expect(opened).toHaveLength(0);
	});
	it("distinguishes expired credentials from never connected, including after restart", async () => {
		expect((await oauth.status("one")).state).toBe("disconnected");
		issueRefresh = false;
		await authorize();
		now += 3600_000;
		expect((await oauth.status("one")).state).toBe("expired");
		expect(await oauth.getAccessToken("one")).toBeUndefined();
		await oauth.dispose();
		oauth = new McpOAuthService({
			registry,
			fetcher: fetch,
			openBrowser: async () => {},
			now: () => now,
		});
		expect((await oauth.status("one")).state).toBe("expired");
		await oauth.disconnect("one");
		expect((await oauth.status("one")).state).toBe("disconnected");
	});
	it("reports expired after a refresh grant is rejected", async () => {
		await authorize();
		now += 3600_000;
		deniedRefresh = true;
		await oauth.getAccessToken("one").catch(() => {});
		expect((await oauth.status("one")).state).toBe("expired");
	});
	it.each([
		"",
		"/another-issuer",
	])("authenticates twice through an authorization endpoint enforcing the pre-registered issuer path %s", async (path) => {
		issuerPath = path;
		const registration = await oauth.getRegistrationInfo("one");
		registeredRedirects.set("pre-registered", [registration.redirectUri]);
		const definition = await registry.get("one");
		if (definition.transport !== "http") throw Error("fixture");
		await registry.save(
			{
				...definition,
				auth: { type: "oauth", clientId: "pre-registered", scopes: ["read"] },
			},
			{ "oauth.clientSecret": "client-secret-probe" },
		);
		const attempts: URL[] = [];
		for (let attempt = 0; attempt < 2; attempt++) {
			opened = [];
			await start();
			attempts.push(opened[0]);
			const redirect = new URL(opened[0].searchParams.get("redirect_uri")!);
			const authorize = await fetch(opened[0], { redirect: "manual" });
			expect(authorize.status).toBe(302);
			expect(redirect.pathname).toBe(
				new URL(registration.redirectUri).pathname,
			);
			await fetch(authorize.headers.get("location")!);
			await waitFor(
				async () => (await oauth.status("one")).state === "connected",
			);
			expect(await oauth.getAccessToken("one")).toBe("access-secret-probe");
			await oauth.disconnect("one");
		}
		expect(authorizationRequests).toBe(2);
		expect(registrations).toBe(0);
		expect(exchanges).toBe(2);
		expect(attempts[0].searchParams.get("state")).not.toBe(
			attempts[1].searchParams.get("state"),
		);
		expect(attempts[0].searchParams.get("code_challenge")).not.toBe(
			attempts[1].searchParams.get("code_challenge"),
		);
	});
	it("accepts an omitted token scope when code exchange and refresh keep the requested grant", async () => {
		tokenScope = undefined;
		await authorize();
		expect(await oauth.getAccessToken("one")).toBe("access-secret-probe");
		now += 3600_000;
		expect(await oauth.getAccessToken("one")).toBe("refreshed-secret-probe");
		expect(refreshes).toBe(1);
		expect((await oauth.status("one")).state).toBe("connected");
	});
	it("discovers a safe registration URI before client registration without a browser or credentials", async () => {
		const registration = await oauth.getRegistrationInfo("one");
		expect(registration.issuer).toBe(`${origin}/`);
		expect(registration.resource).toBe(`${origin}/mcp`);
		expect(new URL(registration.redirectUri).origin).toBe("http://127.0.0.1");
		expect(metadataRequests).toBeGreaterThan(0);
		expect(registrations).toBe(0);
		expect(authorizationRequests).toBe(0);
		expect(tokenRequests).toBe(0);
		expect(opened).toHaveLength(0);
		expect(Object.keys(registration).sort()).toEqual([
			"issuer",
			"redirectUri",
			"resource",
		]);
		expect((await oauth.status("one")).state).toBe("disconnected");
	});
	it("keeps a registration path stable per discovered issuer and distinct for different issuers", async () => {
		const first = await oauth.getRegistrationInfo("one");
		const repeated = await oauth.getRegistrationInfo("one");
		expect(repeated.redirectUri).toBe(first.redirectUri);
		issuerPath = "/another-issuer";
		const other = await oauth.getRegistrationInfo("one");
		expect(new URL(other.redirectUri).pathname).not.toBe(
			new URL(first.redirectUri).pathname,
		);
		expect(other.issuer).toBe(`${origin}/another-issuer`);
		issuerPath = "";
		expect((await oauth.getRegistrationInfo("one")).redirectUri).toBe(
			first.redirectUri,
		);
	});
	it("rejects an unrelated callback path before any token exchange", async () => {
		const registration = await oauth.getRegistrationInfo("one");
		const definition = await registry.get("one");
		if (definition.transport !== "http") throw Error("fixture");
		await registry.save({
			...definition,
			auth: { ...definition.auth!, clientId: "pre-registered" },
		});
		await start();
		const callback = new URL(opened[0].searchParams.get("redirect_uri")!);
		callback.pathname = `${new URL(registration.redirectUri).pathname}/unexpected`;
		const response = await fetch(callback);
		expect(response.status).toBe(404);
		expect(tokenRequests).toBe(0);
		expect(exchanges).toBe(0);
		expect((await oauth.status("one")).state).toBe("waiting");
		await oauth.cancel("one");
	});
	it("validates discovered resource and issuer before returning registration information", async () => {
		wrongResource = true;
		await expect(oauth.getRegistrationInfo("one")).rejects.toThrow(
			"autenticação MCP",
		);
		wrongResource = false;
		wrongIssuer = true;
		await expect(oauth.getRegistrationInfo("one")).rejects.toThrow(
			"autenticação MCP",
		);
		expect(registrations).toBe(0);
		expect(tokenRequests).toBe(0);
		expect(opened).toHaveLength(0);
	});
	it("cancels a registration lookup without starting a login flow", async () => {
		metadataDelay = 80;
		const pending = oauth.getRegistrationInfo("one").catch((error) => error);
		await waitFor(() => metadataRequests > 0);
		await oauth.cancel("one");
		expect(await pending).toBeInstanceOf(Error);
		expect(registrations).toBe(0);
		expect(tokenRequests).toBe(0);
		expect(opened).toHaveLength(0);
	});
});
