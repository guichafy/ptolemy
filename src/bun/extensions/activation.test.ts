import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { prepareSessionExtensions } from "./activation";
import { ExtensionsStore } from "./store";
import { githubFixture, skill } from "./test-fixtures";

const roots: string[] = [];
async function fixture(files: Record<string, string>) {
	const cwd = await mkdtemp(join(tmpdir(), "ptolemy-extension-"));
	roots.push(cwd, join(cwd, "..", `backend-${cwd.split("/").pop()}`));
	const store = new ExtensionsStore({
		root: join(cwd, "library"),
		fetcher: githubFixture(files).fetcher,
	});
	const source = await store.addSource("https://github.com/example/plugin");
	const item = (await store.browse(source.id))[0];
	const pkg = await store.install(source.id, item.id);
	return { cwd, store, pkg };
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
	);
});

test("selecting one Skill preserves package assets without activating sibling hooks", async () => {
	const { cwd, store, pkg } = await fixture({
		"plugin.json": JSON.stringify({ name: "demo" }),
		"skills/one/SKILL.md": skill("one"),
		"assets/shared.txt": "immutable",
		"hooks/hooks.json": JSON.stringify({
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "echo unsafe" }] }],
			},
		}),
	});
	const one = pkg.components.find((c) => c.kind === "skill")!;
	const result = await prepareSessionExtensions(
		"session",
		cwd,
		[{ packageId: pkg.id, revision: pkg.revision, componentIds: [one.id] }],
		"claude",
		{
			store,
			executionDirectory: join(cwd, "..", `backend-${cwd.split("/").pop()}`),
		},
	);
	expect(result.skills).toHaveLength(1);
	expect(result.hooks).toHaveLength(0);
	expect(
		await readFile(join(result.roots[0], "assets/shared.txt"), "utf8"),
	).toBe("immutable");
	await store.remove(pkg.id);
	expect(
		(
			await prepareSessionExtensions(
				"session",
				cwd,
				[{ packageId: pkg.id, revision: pkg.revision, componentIds: [one.id] }],
				"claude",
				{
					store,
					executionDirectory: join(
						cwd,
						"..",
						`backend-${cwd.split("/").pop()}`,
					),
				},
			)
		).skills,
	).toEqual(result.skills);
	expect(
		(await prepareSessionExtensions("session", cwd, [], "claude", { store }))
			.roots,
	).toEqual([]);
	expect(
		(
			await prepareSessionExtensions("session", cwd, undefined, "claude", {
				store,
			})
		).explicit,
	).toBe(false);
});

test("hooks require final revision trust and unsupported metadata is specific", async () => {
	const { cwd, store, pkg } = await fixture({
		"plugin.json": JSON.stringify({
			name: "demo",
			apps: { connector: "saas-only" },
		}),
		"hooks/hooks.json": JSON.stringify({
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "echo ok" }] }],
			},
		}),
	});
	const selection = {
		packageId: pkg.id,
		revision: pkg.revision,
		componentIds: pkg.components.map((c) => c.id),
	};
	const untrusted = await prepareSessionExtensions(
		"session",
		cwd,
		[selection],
		"claude",
		{
			store,
			executionDirectory: join(cwd, "..", `backend-${cwd.split("/").pop()}`),
		},
	);
	expect(untrusted.hooks).toHaveLength(0);
	expect(
		untrusted.capabilities.some(
			(c) =>
				c.status === "requires-configuration" && c.reason.includes("revisão"),
		),
	).toBe(true);
	const trusted = await prepareSessionExtensions(
		"session",
		cwd,
		[{ ...selection, trustedHookDigest: pkg.revision }],
		"claude",
		{
			store,
			executionDirectory: join(cwd, "..", `backend-${cwd.split("/").pop()}`),
		},
	);
	expect(trusted.hooks).toHaveLength(1);
	expect(trusted.capabilities.some((c) => c.reason.includes("endpoint"))).toBe(
		true,
	);
});

test("native snapshots retain old revisions and distinguish enabled installation from cache", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "ptolemy-native-extension-"));
	roots.push(cwd, join(cwd, "..", `backend-${cwd.split("/").pop()}`));
	const local = join(cwd, "native");
	await mkdir(join(local, "skills", "one"), { recursive: true });
	await writeFile(join(local, "skills", "one", "SKILL.md"), skill("one"));
	const store = new ExtensionsStore({ root: join(cwd, "library") });
	const old = await store.importNative("codex", {
		id: "one@market",
		name: "one",
		enabled: true,
		path: local,
		managed: false,
	});
	await writeFile(
		join(local, "skills", "one", "SKILL.md"),
		`${skill("one")}changed`,
	);
	const latest = await store.importNative("codex", {
		id: "one@market",
		name: "one",
		enabled: true,
		path: local,
		managed: false,
	});
	expect(latest.id).toBe(old.id);
	expect(latest.revision).not.toBe(old.revision);
	await rm(local, { recursive: true });
	expect((await store.getPackage(old.id, old.revision)).files[0].content).toBe(
		Buffer.from(skill("one")).toString("base64"),
	);
});

test("native variant selection precedes collision checks and superseded declarations never execute", async () => {
	const { cwd, store, pkg } = await fixture({
		".claude-plugin/plugin.json": JSON.stringify({
			name: "demo",
			mcpServers: { same: { command: "claude-server" } },
		}),
		".codex-plugin/plugin.json": JSON.stringify({
			name: "demo",
			mcpServers: { same: { command: "codex-server" } },
		}),
	});
	const prepared = await prepareSessionExtensions(
		"session",
		cwd,
		[
			{
				packageId: pkg.id,
				revision: pkg.revision,
				componentIds: pkg.components.map((c) => c.id),
			},
		],
		"codex",
		{
			store,
			executionDirectory: join(cwd, "..", `backend-${cwd.split("/").pop()}`),
		},
	);
	expect(prepared.mcpComponents).toHaveLength(1);
	expect(prepared.mcpComponents[0].config.command).toBe("codex-server");
});

test("a trusted Claude prompt hook uses an isolated native plugin and mixed ordering is diagnosed", async () => {
	const { cwd, store, pkg } = await fixture({
		"plugin.json": JSON.stringify({ name: "prompt" }),
		"hooks/hooks.json": JSON.stringify({
			hooks: {
				PreToolUse: [
					{
						hooks: [{ type: "prompt", prompt: "Return ok:false", timeout: 5 }],
					},
				],
			},
		}),
	});
	const selection = {
		packageId: pkg.id,
		revision: pkg.revision,
		componentIds: pkg.components.map((c) => c.id),
		trustedHookDigest: pkg.revision,
	};
	const prepared = await prepareSessionExtensions(
		"prompt",
		cwd,
		[selection],
		"claude",
		{
			store,
			executionDirectory: join(cwd, "..", `backend-${cwd.split("/").pop()}`),
		},
	);
	expect(prepared.capabilities[0].status).toBe("native");
	expect(prepared.hooks).toEqual([]);
	expect(prepared.claudePlugins).toHaveLength(1);
	expect(
		JSON.parse(
			await readFile(
				join(prepared.claudePlugins[0], "hooks/hooks.json"),
				"utf8",
			),
		).hooks.PreToolUse[0].hooks[0].type,
	).toBe("prompt");
	const codex = await prepareSessionExtensions(
		"prompt",
		cwd,
		[selection],
		"codex",
		{ store, materialize: false },
	);
	expect(codex.capabilities[0].reason).toContain("Codex");
});

test("native prompt hooks do not silently reorder mixed handlers", async () => {
	const { cwd, store, pkg } = await fixture({
		"plugin.json": JSON.stringify({ name: "mixed" }),
		"hooks/hooks.json": JSON.stringify({
			hooks: {
				PreToolUse: [
					{
						hooks: [
							{ type: "prompt", prompt: "deny" },
							{ type: "command", command: "echo ok" },
						],
					},
				],
			},
		}),
	});
	const prepared = await prepareSessionExtensions(
		"mixed",
		cwd,
		[
			{
				packageId: pkg.id,
				revision: pkg.revision,
				componentIds: pkg.components.map((c) => c.id),
				trustedHookDigest: pkg.revision,
			},
		],
		"claude",
		{ store, materialize: false },
	);
	expect(
		prepared.capabilities.some(
			(c) => c.status === "incompatible" && c.reason.includes("paralelo"),
		),
	).toBe(true);
});
