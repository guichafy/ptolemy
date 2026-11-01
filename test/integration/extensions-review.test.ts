import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	codexHookInventoryPolicy,
	inventoryCodexHooks,
} from "../../src/bun/extensions/codex-hook-inventory";
import { configureLocalAgents } from "./helpers/local-agents";

test("native inventory only permits data-open of an existing ID, denying metadata and removal", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-id-policy-"));
	const saved = { ...process.env };
	const mocks = await configureLocalAgents(root, process.cwd());
	try {
		const id = join(root, ".codex", "installation_id"),
			scratch = join(root, "scratch");
		await mkdir(scratch);
		await writeFile(id, randomUUID(), { mode: 0o644 });
		const bytes = await readFile(id),
			before = await stat(id);
		expect(
			await inventoryCodexHooks(
				process.env.PTOLEMY_CODEX_PATH!,
				root,
				process.env as Record<string, string>,
			),
		).toEqual([]);
		const policy = codexHookInventoryPolicy(
			await realpath(scratch),
			await realpath(id),
		);
		for (const args of [
			["/bin/chmod", "600", id],
			["/bin/rm", id],
		]) {
			const child = Bun.spawn(
				["/usr/bin/sandbox-exec", "-p", policy, ...args],
				{ stdout: "ignore", stderr: "ignore" },
			);
			expect(await child.exited).not.toBe(0);
		}
		const after = await stat(id);
		expect(await readFile(id)).toEqual(bytes);
		expect(after.mtimeMs).toBe(before.mtimeMs);
		expect(after.ctimeMs).toBe(before.ctimeMs);
		expect(after.mode).toBe(before.mode);
		expect(mocks.responsesMock.requests).toHaveLength(0);
		await chmod(id, 0o600);
		const unsupported = await stat(id);
		await expect(
			inventoryCodexHooks(
				process.env.PTOLEMY_CODEX_PATH!,
				root,
				process.env as Record<string, string>,
			),
		).rejects.toThrow("0644");
		expect((await stat(id)).ctimeMs).toBe(unsupported.ctimeMs);
		expect(await readFile(id)).toEqual(bytes);
	} finally {
		mocks.stop();
		for (const key of Object.keys(process.env))
			if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		await rm(root, { recursive: true, force: true });
	}
});

test("direct execution finds login-PATH tools and preserves only HOME and live proxy routing", async () => {
	const { buildExtensionEnvironment } = await import(
		"../../src/bun/extensions/execution-environment"
	);
	const { executeRestricted } = await import(
		"../../src/bun/extensions/extension-executor.mjs"
	);
	const root = await mkdtemp(join(tmpdir(), "ptolemy-execution-env-"));
	const saved = { ...process.env };
	try {
		const bin = join(root, "bin");
		await mkdir(bin);
		await writeFile(
			join(bin, "login-only"),
			`#!/bin/sh\nprintf "%s\\n" "$HOME" "$HTTPS_PROXY" "$NO_PROXY" "\${ANTHROPIC_API_KEY-unset}" "\${MCP_SECRET-unset}" "\${CODEX_AUTH_TOKEN-unset}"\n`,
			{ mode: 0o755 },
		);
		process.env.PATH = "/usr/bin:/bin";
		process.env.HTTPS_PROXY = "http://fixture-proxy:8080";
		process.env.NO_PROXY = "localhost";
		process.env.ANTHROPIC_API_KEY = "secret";
		process.env.MCP_SECRET = "secret";
		process.env.CODEX_AUTH_TOKEN = "secret";
		const resolvePath = async () => `${bin}:/usr/bin:/bin`;
		const spec = {
			cwd: root,
			root,
			data: root,
			command: "login-only",
			timeout: 5,
		};
		const result = await executeRestricted(
			spec,
			"",
			undefined,
			await buildExtensionEnvironment(resolvePath),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe(
			`${saved.HOME}\nhttp://fixture-proxy:8080\nlocalhost\nunset\nunset\nunset\n`,
		);
		process.env.HTTPS_PROXY = "http://new-proxy:9090";
		const next = await executeRestricted(
			spec,
			"",
			undefined,
			await buildExtensionEnvironment(resolvePath),
		);
		expect(next.stdout).toContain("http://new-proxy:9090");
		expect(process.env.HOME).toBe(saved.HOME);
	} finally {
		for (const key of Object.keys(process.env))
			if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		await rm(root, { recursive: true, force: true });
	}
});

test("Codex executes a materialized Skill's root/data asset instruction", async () => {
	const { Codex } = await import("@openai/codex-sdk");
	const { ExtensionsStore } = await import("../../src/bun/extensions/store");
	const { prepareSessionExtensions } = await import(
		"../../src/bun/extensions/activation"
	);
	const { startMockResponsesServer } = await import(
		"./helpers/mock-responses-server"
	);
	const root = await mkdtemp(join(tmpdir(), "ptolemy-skill-asset-"));
	const saved = { ...process.env };
	const mocks = await configureLocalAgents(root, process.cwd());
	let probe: ReturnType<typeof startMockResponsesServer> | undefined;
	try {
		process.env.PTOLEMY_HOME = root;
		const cwd = join(root, "project"),
			plugin = join(root, "plugin");
		await mkdir(cwd);
		await mkdir(join(plugin, "skills", "asset"), { recursive: true });
		await mkdir(join(plugin, "assets"));
		await writeFile(
			join(plugin, "plugin.json"),
			JSON.stringify({ name: "assets" }),
		);
		await writeFile(
			join(plugin, "assets", "value.txt"),
			"package asset consumed",
		);
		await writeFile(
			join(plugin, "skills", "asset", "SKILL.md"),
			`---\nname: asset\ndescription: Read packaged asset\n---\ncat "\${CLAUDE_PLUGIN_ROOT}/assets/value.txt" > "\${PLUGIN_DATA}/result"\n`,
		);
		const store = new ExtensionsStore({ root: join(root, "library") });
		const pkg = await store.importNative("claude", {
			id: "assets@fixture",
			name: "assets",
			enabled: true,
			managed: false,
			path: plugin,
		});
		const prepared = await prepareSessionExtensions(
			"asset",
			cwd,
			[
				{
					packageId: pkg.id,
					revision: pkg.revision,
					componentIds: pkg.components
						.filter((c) => c.kind === "skill")
						.map((c) => c.id),
				},
			],
			"codex",
			{ store },
		);
		const skill = await readFile(prepared.skills[0].path, "utf8"),
			command = skill.split("\n").find((line) => line.startsWith("cat "))!;
		expect(command).not.toContain("${");
		probe = startMockResponsesServer(
			`const result=await tools.exec_command({cmd:${JSON.stringify(command)},login:false});text(result.output);`,
		);
		const codex = new Codex({
			codexPathOverride: process.env.PTOLEMY_CODEX_PATH,
			env: process.env as Record<string, string>,
			configOverrides: [
				`model_providers.ptolemy_mock.base_url=${JSON.stringify(probe.url)}`,
			],
		});
		await codex
			.startThread({
				workingDirectory: cwd,
				skipGitRepoCheck: true,
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
			})
			.run(
				"Crie o arquivo unused.txt na pasta atual contendo exatamente o texto: inert",
				{ signal: AbortSignal.timeout(20000) },
			);
		const destination = command.match(/> "([^"]+)"/)![1];
		expect(await readFile(destination, "utf8")).toBe("package asset consumed");
		expect(probe.requests.length).toBeGreaterThan(1);
	} finally {
		probe?.stop();
		mocks.stop();
		for (const key of Object.keys(process.env))
			if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

test("both session lifecycles cancel pending/follow-up expansion and shell children", async () => {
	const child = Bun.spawn(
		[process.execPath, "test/integration/helpers/extension-lifecycle.ts"],
		{ stdout: "pipe", stderr: "pipe", env: process.env },
	);
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw Error(`${out}\n${err}`);
	expect(out).toContain("LIFECYCLE_CANCELLATION_OK");
}, 120000);

test("cancellation races with shell child creation without leaving delayed writers", async () => {
	const { executeRestricted } = await import(
		"../../src/bun/extensions/extension-executor.mjs"
	);
	const root = await mkdtemp(join(tmpdir(), "ptolemy-cancel-race-"));
	try {
		for (let i = 0; i < 30; i++) {
			const signal = new AbortController();
			const result = executeRestricted(
				{
					cwd: root,
					root,
					data: root,
					command: `echo ready > started; (sleep .1; echo late > late) & wait`,
					timeout: 5,
				},
				"",
				signal.signal,
			).catch(() => null);
			while (
				!(await readFile(join(root, "started")).then(
					() => true,
					() => false,
				))
			)
				await Bun.sleep(1);
			signal.abort();
			await result;
			await Bun.sleep(120);
			expect(await readFile(join(root, "late")).catch(() => null)).toBeNull();
			await rm(join(root, "started"));
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 15000);
