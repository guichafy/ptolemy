import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpLoader } from "./mcp-loader";

describe("McpLoader", () => {
	let root: string;
	let path: string;
	let loader: McpLoader;

	beforeEach(async () => {
		root = join(tmpdir(), `ptolemy-mcp-${Date.now()}-${Math.random()}`);
		await mkdir(root, { recursive: true });
		path = join(root, "mcp-servers.json");
		loader = new McpLoader({ path });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	describe("load", () => {
		it("returns empty file when path does not exist", async () => {
			const file = await loader.load();
			expect(file).toEqual({ version: 1, servers: [] });
		});

		it("round-trips a valid file", async () => {
			await loader.save({
				version: 1,
				servers: [
					{ name: "shadcn", command: "npx", args: ["shadcn@latest", "mcp"] },
				],
			});
			const file = await loader.load();
			expect(file.servers).toHaveLength(1);
			expect(file.servers[0]).toMatchObject({ name: "shadcn", command: "npx" });
		});

		it("returns defaults when version does not match", async () => {
			await writeFile(path, JSON.stringify({ version: 2, servers: [] }));
			expect(await loader.load()).toEqual({ version: 1, servers: [] });
		});

		it("drops invalid server entries but keeps valid ones", async () => {
			await writeFile(
				path,
				JSON.stringify({
					version: 1,
					servers: [
						{ name: "", command: "npx" }, // empty name → drop
						{ name: "ok", command: "" }, // empty command → drop
						{ name: "good", command: "npx", args: ["a", "b"] },
						{ name: "bad-args", command: "npx", args: [1, 2] }, // non-string → drop
						{ name: "with-env", command: "x", env: { K: "v" } },
						{ name: "bad-env", command: "x", env: { K: 1 } }, // non-string env → drop
					],
				}),
			);
			const file = await loader.load();
			expect(file.servers.map((s) => s.name)).toEqual(["good", "with-env"]);
		});

		it("deduplicates servers with the same name, keeping the first", async () => {
			await writeFile(
				path,
				JSON.stringify({
					version: 1,
					servers: [
						{ name: "dup", command: "first" },
						{ name: "dup", command: "second" },
					],
				}),
			);
			const file = await loader.load();
			expect(file.servers).toHaveLength(1);
			expect(file.servers[0].command).toBe("first");
		});

		it("returns defaults on malformed JSON", async () => {
			await writeFile(path, "{not valid json");
			expect(await loader.load()).toEqual({ version: 1, servers: [] });
		});
	});

	describe("resolve", () => {
		it("projects stored servers into the SDK shape with type=stdio", async () => {
			await loader.save({
				version: 1,
				servers: [
					{
						name: "shadcn",
						command: "npx",
						args: ["shadcn@latest", "mcp"],
						env: { NO_COLOR: "1" },
					},
				],
			});
			const resolved = await loader.resolve();
			expect(resolved).toEqual({
				shadcn: {
					type: "stdio",
					command: "npx",
					args: ["shadcn@latest", "mcp"],
					env: { NO_COLOR: "1" },
				},
			});
		});

		it("omits the args and env fields when they are empty", async () => {
			await loader.save({
				version: 1,
				servers: [
					{ name: "simple", command: "./my-server", args: [], env: {} },
				],
			});
			const resolved = await loader.resolve();
			expect(resolved.simple).toEqual({
				type: "stdio",
				command: "./my-server",
			});
		});

		it("drops disabled servers", async () => {
			await loader.save({
				version: 1,
				servers: [
					{ name: "on", command: "a" },
					{ name: "off", command: "b", enabled: false },
				],
			});
			const resolved = await loader.resolve();
			expect(Object.keys(resolved)).toEqual(["on"]);
		});

		it("returns {} when no servers configured", async () => {
			const resolved = await loader.resolve();
			expect(resolved).toEqual({});
		});
	});

	describe("save", () => {
		it("creates the parent directory lazily", async () => {
			const nested = new McpLoader({ path: join(root, "nested", "mcp.json") });
			await nested.save({
				version: 1,
				servers: [{ name: "x", command: "y" }],
			});
			expect((await nested.load()).servers).toHaveLength(1);
		});

		it("re-validates before writing, dropping invalid entries", async () => {
			await loader.save({
				version: 1,
				servers: [
					{ name: "ok", command: "x" },
					{ name: "", command: "y" } as unknown as {
						name: string;
						command: string;
					},
				],
			});
			const reloaded = await loader.load();
			expect(reloaded.servers.map((s) => s.name)).toEqual(["ok"]);
		});
	});
});
