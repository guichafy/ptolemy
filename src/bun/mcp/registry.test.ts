import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpRegistry } from "./registry";
import { MemorySecretVault } from "./secrets";

// Catches lost legacy JSON values, plaintext persistence, stale snapshots and lost updates.
describe("shared MCP registry", () => {
	let root: string;
	let path: string;
	let legacyPath: string;
	let vault: MemorySecretVault;
	let registry: McpRegistry;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-registry-"));
		path = join(root, "registry.json");
		legacyPath = join(root, "legacy.json");
		vault = new MemorySecretVault();
		registry = new McpRegistry({ path, legacyPath, vault });
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});
	it("migrates valid v1 entries preserving args/env and disabled defaults without publishing env", async () => {
		const legacy = {
			version: 1,
			servers: [
				{
					name: "one",
					command: "bun",
					args: ["x y", '{"json":1}'],
					env: { TOKEN: "secret-probe", EMPTY: "" },
				},
				{ name: "one", command: "ignored" },
				{ name: "off", command: "x", enabled: false },
				{ name: "bad", command: "" },
			],
		};
		await writeFile(legacyPath, JSON.stringify(legacy));
		const list = await registry.list();
		expect(list.map((s) => s.name)).toEqual(["one", "off"]);
		expect(list[0].credentials.env).toEqual(["TOKEN", "EMPTY"]);
		expect(JSON.stringify(list)).not.toContain("secret-probe");
		expect(list[1].defaults).toEqual({ claude: false, codex: false });
		const snapshot = await registry.snapshot([list[0].id]);
		expect(JSON.stringify(snapshot)).not.toContain("secret-probe");
		expect((await registry.resolve(snapshot))[0]).toMatchObject({
			command: "bun",
			args: ["x y", '{"json":1}'],
			env: { TOKEN: "secret-probe", EMPTY: "" },
		});
		expect(await readFile(path, "utf8")).not.toContain("secret-probe");
		expect(await readFile(legacyPath, "utf8")).toBe(JSON.stringify(legacy));
		await registry.finalizeLegacyMigration();
		await expect(readFile(legacyPath)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await registry.finalizeLegacyMigration();
	});
	it("keeps legacy source intact when vault or persistence fails", async () => {
		const bytes = JSON.stringify({
			version: 1,
			servers: [{ name: "one", command: "x", env: { TOKEN: "secret-probe" } }],
		});
		await writeFile(legacyPath, bytes);
		const broken = new McpRegistry({
			path,
			legacyPath,
			vault: {
				get: async () => undefined,
				set: async () => {
					throw Error("secret-probe");
				},
				delete: async () => {},
			},
		});
		await expect(broken.list()).rejects.toThrow("Não foi possível");
		expect(await readFile(legacyPath, "utf8")).toBe(bytes);
		const diskBroken = new McpRegistry({ path: root, legacyPath, vault });
		await expect(diskBroken.list()).rejects.toThrow();
		expect(await readFile(legacyPath, "utf8")).toBe(bytes);
	});
	it("serializes whole saves and defaults without losing concurrent changes", async () => {
		await Promise.all([
			registry.save({
				id: "a",
				name: "A",
				transport: "stdio",
				command: "a",
				defaults: { claude: true, codex: false },
			}),
			registry.save({
				id: "b",
				name: "B",
				transport: "stdio",
				command: "b",
				defaults: { claude: false, codex: true },
			}),
		]);
		await registry.setDefaults("codex", ["a"]);
		expect(
			(await registry.list()).map((s) => [s.id, s.defaults.codex]),
		).toEqual([
			["a", true],
			["b", false],
		]);
		await expect(
			registry.save({
				id: "c",
				name: "A",
				transport: "stdio",
				command: "c",
				defaults: { claude: false, codex: false },
			}),
		).rejects.toThrow();
		await expect(registry.setDefaults("claude", ["missing"])).rejects.toThrow();
		expect((await registry.list()).length).toBe(2);
	});
	it("stores supplied credentials out of JSON and keeps prior snapshot credentials after edits/removal", async () => {
		await registry.save({
			id: "a",
			name: "A",
			transport: "http",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer secret-probe" },
			defaults: { claude: true, codex: true },
		});
		const old = await registry.snapshot(["a"]);
		await registry.save({
			id: "a",
			name: "A",
			transport: "http",
			url: "https://other.example/mcp",
			headers: { Authorization: "Bearer replacement" },
			defaults: { claude: true, codex: true },
		});
		await registry.remove("a");
		expect((await registry.resolve(old))[0]).toMatchObject({
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer secret-probe" },
		});
		expect(await readFile(path, "utf8")).not.toContain("replacement");
	});
	it("rejects insecure URLs and malformed definitions without echoing input", async () => {
		for (const url of [
			"http://example.com/mcp",
			"https://user:secret-probe@example.com/mcp",
			"https://example.com/mcp?token=secret-probe",
		]) {
			await expect(
				registry.save({
					id: "a",
					name: "A",
					transport: "http",
					url,
					defaults: { claude: true, codex: true },
				}),
			).rejects.toThrow("Configuração MCP inválida");
		}
		await expect(
			registry.save({
				id: "a",
				name: "A",
				transport: "stdio",
				command: "x",
				args: [1],
				defaults: { claude: true, codex: true },
			} as never),
		).rejects.toThrow();
		expect(await registry.list()).toEqual([]);
	});
	it("does not erase legacy edits made after migration", async () => {
		await writeFile(legacyPath, JSON.stringify({ version: 1, servers: [] }));
		await registry.list();
		await writeFile(
			legacyPath,
			JSON.stringify({ version: 1, servers: [{ name: "late", command: "x" }] }),
		);
		await expect(registry.finalizeLegacyMigration()).rejects.toThrow();
		expect(await readFile(legacyPath, "utf8")).toContain("late");
	});
});

describe("safe editable MCP drafts", () => {
	it("preserves, replaces and removes credentials without publishing vault references", async () => {
		const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-draft-"));
		try {
			const registry = new McpRegistry({
				path: join(root, "registry.json"),
				legacyPath: join(root, "legacy.json"),
				vault: new MemorySecretVault(),
			});
			await registry.save(
				{
					id: "a",
					name: "A",
					transport: "http",
					url: "https://example.com/mcp",
					headers: { Authorization: "secret-probe", Other: "remove-me" },
					auth: { type: "oauth", clientId: "client" },
					defaults: { claude: true, codex: true },
				},
				{ "oauth.clientSecret": "client-secret-probe" },
			);
			const draft = await registry.getEditable("a");
			expect(draft).toMatchObject({
				url: "https://example.com/mcp",
				headers: {
					Authorization: { preserve: true },
					Other: { preserve: true },
				},
				auth: { clientSecret: { preserve: true } },
			});
			expect(JSON.stringify(draft)).not.toContain("secret-probe");
			expect(JSON.stringify(draft)).not.toContain("secretRef");
			if (draft.transport !== "http") throw Error("fixture");
			delete draft.headers!.Other;
			draft.headers!.New = { value: "replacement-probe" };
			await registry.saveEditable(draft);
			expect(
				(await registry.resolve(await registry.snapshot(["a"])))[0],
			).toMatchObject({
				headers: { Authorization: "secret-probe", New: "replacement-probe" },
			});
			const next = await registry.getEditable("a");
			if (next.transport !== "http") throw Error("fixture");
			delete next.auth!.clientSecret;
			await registry.saveEditable(next);
			expect(await registry.getEditable("a")).not.toHaveProperty(
				"auth.clientSecret",
			);
			await expect(
				registry.saveEditable({ ...draft, id: "new" }),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("MCP validation boundaries", () => {
	it("rejects malformed optional fields instead of silently dropping them", async () => {
		const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-invalid-"));
		try {
			const registry = new McpRegistry({
				path: join(root, "registry.json"),
				legacyPath: join(root, "legacy.json"),
				vault: new MemorySecretVault(),
			});
			for (const extra of [{ env: null }, { env: 0 }, { env: false }])
				await expect(
					registry.save({
						id: "a",
						name: "A",
						transport: "stdio",
						command: "x",
						defaults: { claude: true, codex: false },
						...extra,
					} as never),
				).rejects.toThrow();
			for (const auth of [
				{ type: "oauth", issuer: 0 },
				{ type: "oauth", resource: false },
				{
					type: "oauth",
					clientSecret: { secretRef: "------------------------------------" },
				},
			])
				await expect(
					registry.save({
						id: "a",
						name: "A",
						transport: "http",
						url: "https://example.com/mcp",
						auth,
						defaults: { claude: true, codex: false },
					} as never),
				).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("preserves legacy non-shell env keys and refuses to partially migrate valid v1 values outside new bounds", async () => {
		const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-legacy-"));
		try {
			const path = join(root, "registry.json"),
				legacyPath = join(root, "legacy.json");
			const vault = new MemorySecretVault();
			const registry = new McpRegistry({ path, legacyPath, vault });
			await writeFile(
				legacyPath,
				JSON.stringify({
					version: 1,
					servers: [
						{
							name: "one",
							command: "x",
							env: { "CLIENT-KEY": "secret-probe" },
						},
					],
				}),
			);
			const list = await registry.list();
			expect(list).toHaveLength(1);
			expect(
				(await registry.resolve(await registry.snapshot([list[0].id])))[0],
			).toHaveProperty("env.CLIENT-KEY", "secret-probe");
			await rm(path);
			const original = JSON.stringify({
				version: 1,
				servers: [{ name: "one", command: "x", args: ["x".repeat(65537)] }],
			});
			await writeFile(legacyPath, original);
			await expect(registry.list()).rejects.toThrow();
			expect(await readFile(legacyPath, "utf8")).toBe(original);
			await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("legacy migration cutover", () => {
	it("reconciles late v1 edits atomically, preserving shared entries and historical snapshots", async () => {
		const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-cutover-"));
		try {
			const path = join(root, "registry.json"),
				legacyPath = join(root, "legacy.json");
			const registry = new McpRegistry({
				path,
				legacyPath,
				vault: new MemorySecretVault(),
			});
			await writeFile(
				legacyPath,
				JSON.stringify({
					version: 1,
					servers: [
						{ name: "old", command: "before", env: { KEY: "before-probe" } },
						{ name: "deleted", command: "x" },
					],
				}),
			);
			const oldId = (await registry.list())[0].id;
			const old = await registry.snapshot([oldId]);
			await registry.save({
				id: "shared",
				name: "Shared",
				transport: "stdio",
				command: "keep",
				defaults: { claude: false, codex: true },
			});
			await writeFile(
				legacyPath,
				JSON.stringify({
					version: 1,
					servers: [
						{
							name: "old",
							command: "after",
							args: ['{"a":1}'],
							env: { KEY: "after-probe" },
						},
					],
				}),
			);
			await registry.reconcileLegacyMigration();
			await registry.reconcileLegacyMigration();
			expect((await registry.list()).map((s) => s.name)).toEqual([
				"Shared",
				"old",
			]);
			expect(
				(await registry.resolve(await registry.snapshot([oldId])))[0],
			).toMatchObject({
				command: "after",
				args: ['{"a":1}'],
				env: { KEY: "after-probe" },
			});
			expect((await registry.resolve(old))[0]).toMatchObject({
				command: "before",
				env: { KEY: "before-probe" },
			});
			await registry.finalizeLegacyMigration();
			await expect(readFile(legacyPath)).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("credential input validation", () => {
	it("rejects header injection supplied separately from the referenced definition", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "ptolemy-mcp-secret-validation-"),
		);
		try {
			const registry = new McpRegistry({
				path: join(root, "registry.json"),
				legacyPath: join(root, "legacy.json"),
				vault: new MemorySecretVault(),
			});
			await registry.save({
				id: "one",
				name: "One",
				transport: "http",
				url: "https://example.com/mcp",
				headers: { Authorization: "old" },
				defaults: { claude: true, codex: false },
			});
			const definition = await registry.get("one");
			await expect(
				registry.save(definition, {
					"headers.Authorization": "secret-probe\r\nInjected: true",
				}),
			).rejects.toThrow();
			expect(
				(await registry.resolve(await registry.snapshot(["one"])))[0],
			).toHaveProperty("headers.Authorization", "old");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("preserves prototype-shaped env keys without modifying object prototypes", async () => {
		const root = await mkdtemp(join(tmpdir(), "ptolemy-mcp-env-"));
		try {
			const path = join(root, "registry.json"),
				legacyPath = join(root, "legacy.json");
			const registry = new McpRegistry({
				path,
				legacyPath,
				vault: new MemorySecretVault(),
			});
			await writeFile(
				legacyPath,
				'{"version":1,"servers":[{"name":"one","command":"x","env":{"__proto__":"value-probe","constructor":"kept"}}]}',
			);
			const id = (await registry.list())[0].id;
			const resolved = (
				await registry.resolve(await registry.snapshot([id]))
			)[0];
			expect(
				Object.getOwnPropertyDescriptor(
					resolved.transport === "stdio" ? resolved.env! : {},
					"__proto__",
				)?.value,
			).toBe("value-probe");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
