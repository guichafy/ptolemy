import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionsStore } from "./store";
import { githubFixture, skill } from "./test-fixtures";

const roots: string[] = [];
async function root() {
	const path = await mkdtemp(join(tmpdir(), "ptolemy-extensions-"));
	roots.push(path);
	return path;
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
const fixture = (suffix = "") =>
	githubFixture({
		"plugin.json": JSON.stringify({
			name: "demo",
			skills: "./skills",
			mcpServers: {
				api: {
					command: "node",
					args: ["./server.js"],
					// biome-ignore lint/suspicious/noTemplateCurlyInString: Package placeholders must remain unexpanded.
					env: { API_TOKEN: "${API_TOKEN}" },
				},
			},
		}),
		"skills/one/SKILL.md": skill("one"),
		"server.js": `console.log("${suffix}")`,
	});

describe("transactional extension library", () => {
	it("provides the three public builtin sources", async () => {
		const store = new ExtensionsStore({ root: await root() });
		expect(
			(await store.sources()).filter((s) => s.builtin).map((s) => s.url),
		).toEqual([
			"https://github.com/anthropics/skills",
			"https://github.com/anthropics/claude-plugins-official",
			"https://github.com/openai/plugins",
		]);
	});
	it("installs whole packages idempotently, redacts public definitions, survives reload/source removal", async () => {
		const path = await root();
		const f = fixture();
		const store = new ExtensionsStore({ root: path, fetcher: f.fetcher });
		const source = await store.addSource("https://github.com/o/r");
		const [item] = await store.browse(source.id);
		expect(await store.installed()).toEqual([]);
		const inspected = await store.inspect(source.id, item.id);
		expect(inspected.components.some((c) => c.kind === "mcp")).toBe(true);
		expect(JSON.stringify(inspected)).not.toContain("API_TOKEN");
		const first = await store.install(source.id, item.id);
		expect(await store.install(source.id, item.id)).toEqual(first);
		expect(
			(await store.getPackage(first.id)).files.map((f) => f.path),
		).toContain("server.js");
		await store.removeSource(source.id);
		const reloaded = new ExtensionsStore({ root: path, fetcher: f.fetcher });
		expect(await reloaded.installed()).toHaveLength(1);
		expect((await reloaded.getPackage(first.id)).origin.commit).toHaveLength(
			40,
		);
		const readded = await reloaded.addSource("https://github.com/o/r.git/");
		expect(readded.id).toBe(source.id);
		expect((await reloaded.browse(readded.id))[0].id).toBe(first.id);
		await reloaded.remove(first.id);
		expect(await reloaded.installed()).toEqual([]);
		await expect(reloaded.getPackage(first.id)).rejects.toThrow(/instalado/);
		expect((await reloaded.getPackage(first.id, first.revision)).revision).toBe(
			first.revision,
		);
	});
	it("keeps names from different origins separate and serializes concurrent source operations", async () => {
		const store = new ExtensionsStore({
			root: await root(),
			fetcher: fixture().fetcher,
		});
		const [a, b] = await Promise.all([
			store.addSource("https://github.com/a/r"),
			store.addSource("https://github.com/b/r"),
		]);
		const [ai] = await store.browse(a.id);
		const [bi] = await store.browse(b.id);
		expect(ai.id).not.toBe(bi.id);
		await Promise.all([store.install(a.id, ai.id), store.install(b.id, bi.id)]);
		expect(await store.installed()).toHaveLength(2);
	});
	it("updates atomically and retains immutable old revisions", async () => {
		let current = fixture("old");
		const store = new ExtensionsStore({
			root: await root(),
			fetcher: (url) => current.fetcher(url),
		});
		const source = await store.addSource("https://github.com/o/r");
		const [item] = await store.browse(source.id);
		const old = await store.install(source.id, item.id);
		// The Git object changes in this fixture even if the synthetic commit stays fixed.
		// Inline version metadata makes the declared revision change as a real catalog update would.
		current = githubFixture({
			"plugin.json": JSON.stringify({
				name: "demo",
				version: "2",
				skills: "./skills",
			}),
			"skills/one/SKILL.md": skill("one"),
			"server.js": "new",
		});
		const newer = await store.install(source.id, item.id);
		expect(newer.revision).not.toBe(old.revision);
		expect(
			(await store.getPackage(old.id, old.revision)).files.find(
				(f) => f.path === "server.js",
			)?.content,
		).toBe(Buffer.from('console.log("old")').toString("base64"));
		expect((await store.getPackage(old.id)).revision).toBe(newer.revision);
	});
	it("rejects corrupted updates and literal credentials without changing durable records", async () => {
		const path = await root();
		let current = fixture();
		const store = new ExtensionsStore({
			root: path,
			fetcher: (url) => current.fetcher(url),
		});
		const source = await store.addSource("https://github.com/o/r");
		const [item] = await store.browse(source.id);
		const old = await store.install(source.id, item.id);
		const before = await readFile(join(path, "index.json"), "utf8");
		current = githubFixture({
			"plugin.json": '{"name":"demo"}',
			".mcp.json":
				'{"api":{"command":"node","env":{"API_TOKEN":"do-not-save-secret"}}}',
		});
		const inspected = await store.inspect(source.id, item.id);
		expect(inspected.diagnostics.map((d) => d.code)).toContain(
			"embedded-secret",
		);
		expect(JSON.stringify(inspected)).not.toContain("do-not-save-secret");
		await expect(store.install(source.id, item.id)).rejects.toThrow(
			/credencial|segur/i,
		);
		expect(await readFile(join(path, "index.json"), "utf8")).toBe(before);
		current = githubFixture(
			{ "plugin.json": '{"name":"demo"}' },
			{ mismatch: true },
		);
		await expect(store.install(source.id, item.id)).rejects.toThrow();
		expect((await store.getPackage(old.id)).revision).toBe(old.revision);
		expect(await readdir(path)).toEqual(["index.json"]);
	});
	it("recovers the mutation queue after failed discovery and rejects unknown identities", async () => {
		const store = new ExtensionsStore({
			root: await root(),
			fetcher: fixture().fetcher,
		});
		await expect(store.addSource("https://evil.test/x")).rejects.toThrow();
		await store.addSource("https://github.com/o/r");
		expect(await store.sources()).toHaveLength(4);
		await expect(store.install("unknown", "unknown")).rejects.toThrow();
		await expect(store.inspect("unknown", "unknown")).rejects.toThrow();
		await store.removeSource("unknown");
		expect(await store.sources()).toHaveLength(4);
	});
});

describe("persistent package integrity", () => {
	it("does not publish partial records when the atomic index rename fails", async () => {
		const path = await root();
		const fixtureData = fixture();
		let sabotage = false;
		const fetcher = async (url: string) => {
			const response = await fixtureData.fetcher(url);
			if (sabotage && new URL(url).hostname === "raw.githubusercontent.com") {
				sabotage = false;
				await rename(join(path, "index.json"), join(path, "before.json"));
				await mkdir(join(path, "index.json"));
			}
			return response;
		};
		const store = new ExtensionsStore({ root: path, fetcher });
		const source = await store.addSource("https://github.com/o/r");
		const [item] = await store.browse(source.id);
		const before = await readFile(join(path, "index.json"), "utf8");
		sabotage = true;
		await expect(store.install(source.id, item.id)).rejects.toThrow();
		expect(
			(await readdir(path)).filter((name) => name.endsWith(".tmp")),
		).toEqual([]);
		await rm(join(path, "index.json"), { recursive: true });
		await rename(join(path, "before.json"), join(path, "index.json"));
		expect(await readFile(join(path, "index.json"), "utf8")).toBe(before);
		expect(await store.installed()).toEqual([]);
		await store.install(source.id, item.id);
		expect(await store.installed()).toHaveLength(1);
	});
	it("revalidates persisted bytes instead of trusting serialized component configuration", async () => {
		const path = await root();
		const store = new ExtensionsStore({
			root: path,
			fetcher: fixture().fetcher,
		});
		const source = await store.addSource("https://github.com/o/r");
		const [item] = await store.browse(source.id);
		const installed = await store.install(source.id, item.id);
		const file = join(path, "index.json");
		const index = JSON.parse(await readFile(file, "utf8"));
		const mcp = index.packages[0].components.find(
			(c: { kind: string }) => c.kind === "mcp",
		);
		mcp.definition.config.command = "malicious";
		await writeFile(file, JSON.stringify(index));
		expect(
			(await store.getPackage(installed.id)).components.find(
				(c) => c.kind === "mcp",
			)?.definition,
		).toMatchObject({ config: { command: "node" } });
		index.packages[0].files[0].content =
			Buffer.from("tampered").toString("base64");
		await writeFile(file, JSON.stringify(index));
		await expect(store.getPackage(installed.id)).rejects.toThrow(/alterada/);
	});
});

it("refuses to persist credentials from superseded later-native referenced config and exposes public provenance", async () => {
	const fixtureData = githubFixture({
		".claude-plugin/plugin.json":
			'{"name":"demo","skills":[],"mcpServers":{"api":{"command":"safe"}}}',
		".codex-plugin/plugin.json":
			'{"name":"demo","skills":[],"mcpServers":"./custom-codex.json"}',
		"custom-codex.json":
			'{"api":{"command":"node","env":{"API_TOKEN":"literal-credential-probe"}}}',
	});
	const path = await root();
	const store = new ExtensionsStore({
		root: path,
		fetcher: fixtureData.fetcher,
	});
	const source = await store.addSource("https://github.com/o/r");
	const [item] = await store.browse(source.id);
	const inspected = await store.inspect(source.id, item.id);
	expect(
		inspected.components
			.filter((c) => c.kind === "mcp")
			.flatMap((c) => c.sources)
			.map((s) => s.harness),
	).toEqual(expect.arrayContaining(["claude", "codex"]));
	expect(JSON.stringify(inspected)).not.toContain("literal-credential-probe");
	const before = await readFile(join(path, "index.json"), "utf8");
	await expect(store.install(source.id, item.id)).rejects.toThrow(/segurança/);
	expect(await readFile(join(path, "index.json"), "utf8")).toBe(before);
});

it("sanitizes inspection and atomically refuses credentials in superseded inline-only default hooks", async () => {
	const fixtureData = githubFixture({
		".claude-plugin/marketplace.json": JSON.stringify({
			plugins: [
				{
					name: "demo",
					source: "./plugin",
					strict: false,
					skills: ["./skills/one"],
					hooks: {
						hooks: {
							PreToolUse: [
								{ hooks: [{ type: "command", command: "echo safe" }] },
							],
						},
					},
				},
			],
		}),
		"plugin/README.md": "resources",
		"plugin/hooks/hooks.json": JSON.stringify({
			hooks: {
				PreToolUse: [
					{
						hooks: [
							{
								type: "http",
								url: "https://example.test",
								headers: { Authorization: "Bearer credential-probe" },
							},
						],
					},
				],
			},
		}),
		"plugin/skills/one/SKILL.md": skill("one"),
		"plugin/skills/two/SKILL.md": skill("two"),
	});
	const path = await root();
	const store = new ExtensionsStore({
		root: path,
		fetcher: fixtureData.fetcher,
	});
	const source = await store.addSource("https://github.com/o/r");
	const [item] = await store.browse(source.id);
	const inspected = await store.inspect(source.id, item.id);
	expect(inspected.components.filter((c) => c.kind === "hook")).toHaveLength(2);
	expect(
		inspected.components.some((c) =>
			c.sources.some((s) => s.manifest === "@directory" && !s.effective),
		),
	).toBe(true);
	expect(
		inspected.components.filter((c) => c.kind === "skill").map((c) => c.name),
	).toEqual(["one"]);
	expect(JSON.stringify(inspected)).not.toContain("credential-probe");
	expect(inspected.diagnostics.some((d) => d.code === "embedded-secret")).toBe(
		true,
	);
	const before = await readFile(join(path, "index.json"), "utf8");
	await expect(store.install(source.id, item.id)).rejects.toThrow(/segurança/);
	expect(await readFile(join(path, "index.json"), "utf8")).toBe(before);
	expect(await store.installed()).toEqual([]);
});
