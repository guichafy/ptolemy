import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	appendFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import { prepareSessionExtensions } from "../../src/bun/extensions/activation";
import { executeRestricted } from "../../src/bun/extensions/extension-executor.mjs";
import {
	codexHookOverrides,
	runExtensionHook,
	toToml,
} from "../../src/bun/extensions/hooks";
import {
	denyUnselectedSlash,
	inventoryClaudeBuiltins,
	inventoryCodexHooks,
	inventoryCodexPlugins,
	refreshClaudeBuiltinSelection,
} from "../../src/bun/extensions/native";
import {
	claudeExtensionOptions,
	codexExtensionOverrides,
	resolveExtensionPrompt,
} from "../../src/bun/extensions/runtime";
import { ExtensionsStore } from "../../src/bun/extensions/store";
import { configureLocalAgents } from "./helpers/local-agents";
import {
	startMockAnthropicServer,
	stream,
} from "./helpers/mock-anthropic-server";
import { startMockResponsesServer } from "./helpers/mock-responses-server";

test("restricted hooks block effects in both real CLIs and confine shell children/symlinks/timeouts", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-extensions-it-"));
	const saved = { ...process.env };
	const mocks = await configureLocalAgents(root, process.cwd());
	const cwd = join(root, "project");
	await mkdir(cwd);
	const spec = {
		cwd,
		root: cwd,
		data: cwd,
		event: "PreToolUse",
		command: `/bin/sh -c 'echo no > ../native-outside'; echo called >> marker; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"PTOLEMY_BLOCK"}}'`,
		timeout: 5,
	};
	try {
		const before = mocks.anthropicMock.requests.length;
		const builtins = await inventoryClaudeBuiltins(
			process.env.PTOLEMY_CLAUDE_PATH!,
		);
		expect(builtins.some((c) => c.name === "debug")).toBe(true);
		expect(builtins.find((c) => c.name === "debug")?.kind).toBe("skill");
		expect(builtins.find((c) => c.name === "clear")?.kind).toBe("command");
		expect(mocks.anthropicMock.requests.length).toBe(before);
		const q = query({
			prompt:
				"Crie o arquivo blocked.txt na pasta atual contendo exatamente o texto: forbidden",
			options: {
				cwd,
				model: "haiku",
				pathToClaudeCodeExecutable: process.env.PTOLEMY_CLAUDE_PATH,
				env: process.env,
				settingSources: [],
				strictMcpConfig: true,
				mcpServers: {},
				hooks: {
					PreToolUse: [
						{
							hooks: [
								(input, _id, { signal }) =>
									runExtensionHook(spec, input, signal),
							],
						},
					],
				},
				canUseTool: async (_name, input) => ({
					behavior: "allow",
					updatedInput: input,
				}),
			},
		});
		const timeout = setTimeout(() => q.close(), 20000);
		try {
			for await (const _ of q) {
			}
		} finally {
			clearTimeout(timeout);
			q.close();
		}
		expect(
			await readFile(join(cwd, "blocked.txt"), "utf8").catch(() => null),
		).toBeNull();
		expect(await readFile(join(cwd, "marker"), "utf8")).toContain("called");
		await rm(join(cwd, "marker"));
		expect(
			await readFile(join(root, "native-outside"), "utf8").catch(() => null),
		).toBeNull();
		const ordered = new Codex({
			codexPathOverride: process.env.PTOLEMY_CODEX_PATH,
			env: process.env as Record<string, string>,
			configOverrides: codexHookOverrides([
				{
					...spec,
					event: "SessionStart",
					command:
						'sleep 0.3; echo one >> order; printf \'%s\' \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CONTEXT_ONE"}}\'',
				},
				{
					...spec,
					event: "SessionStart",
					command:
						'echo two >> order; printf \'%s\' \'{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CONTEXT_TWO"}}\'',
				},
			]),
		});
		await ordered
			.startThread({
				workingDirectory: cwd,
				skipGitRepoCheck: true,
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
			})
			.run("Hello", { signal: AbortSignal.timeout(20000) });
		expect(await readFile(join(cwd, "order"), "utf8")).toBe("one\ntwo\n");
		expect(JSON.stringify(mocks.responsesMock.requests)).toContain(
			"CONTEXT_ONE",
		);
		expect(JSON.stringify(mocks.responsesMock.requests)).toContain(
			"CONTEXT_TWO",
		);
		const codex = new Codex({
			codexPathOverride: process.env.PTOLEMY_CODEX_PATH,
			env: process.env as Record<string, string>,
			configOverrides: codexHookOverrides([spec]),
		});
		const thread = codex.startThread({
			workingDirectory: cwd,
			skipGitRepoCheck: true,
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
		});
		await thread.run(
			"Crie o arquivo blocked.txt na pasta atual contendo exatamente o texto: forbidden",
			{ signal: AbortSignal.timeout(20000) },
		);
		expect(
			await readFile(join(cwd, "blocked.txt"), "utf8").catch(() => null),
		).toBeNull();
		expect(await readFile(join(cwd, "marker"), "utf8")).toContain("called");
		expect(
			await readFile(join(root, "native-outside"), "utf8").catch(() => null),
		).toBeNull();
		await symlink(root, join(cwd, "escape"));
		const confined = await executeRestricted({
			...spec,
			command:
				"/bin/sh -c 'echo yes > inside; echo no > ../outside; echo no > escape/through-link'",
		});
		expect(confined.code).not.toBe(0);
		expect(await readFile(join(cwd, "inside"), "utf8")).toBe("yes\n");
		expect(
			await readFile(join(root, "outside"), "utf8").catch(() => null),
		).toBeNull();
		expect(
			await readFile(join(root, "through-link"), "utf8").catch(() => null),
		).toBeNull();
		await writeFile(join(cwd, "slow.sh"), "sleep 2; echo escaped > late\n");
		await expect(
			executeRestricted({
				...spec,
				command: "sh slow.sh & wait",
				timeout: 0.1,
			}),
		).rejects.toThrow("prazo");
		await Bun.sleep(2200);
		expect(
			await readFile(join(cwd, "late"), "utf8").catch(() => null),
		).toBeNull();
	} finally {
		mocks.stop();
		for (const k of Object.keys(process.env))
			if (!(k in saved)) delete process.env[k];
		Object.assign(process.env, saved);
		await rm(root, { recursive: true, force: true });
	}
}, 60000);

test("explicit plugin selection suppresses inherited components, preserves selected Skills and uses native agents", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-extension-runtime-"));
	const saved = { ...process.env };
	const mocks = await configureLocalAgents(root, process.cwd());
	process.env.PTOLEMY_HOME = join(root, "ptolemy");
	const cwd = join(root, "project");
	await mkdir(cwd);
	const market = join(root, "market"),
		plugin = join(market, "plugins", "demo");
	let inheritedContacts = 0;
	const inheritedMcp = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => {
			inheritedContacts++;
			return new Response("unexpected", { status: 500 });
		},
	});
	const files: Record<string, string> = {
		".mcp.json": JSON.stringify({
			inherited: {
				type: "http",
				url: `http://127.0.0.1:${inheritedMcp.port}/mcp`,
			},
		}),
		".claude-plugin/plugin.json": JSON.stringify({ name: "demo" }),
		".codex-plugin/plugin.json": JSON.stringify({ name: "demo" }),
		"skills/chosen/SKILL.md":
			"---\nname: chosen\ndescription: SELECTED_SKILL_CONTEXT\n---\nSelected instructions.",
		"skills/sibling/SKILL.md":
			"---\nname: sibling\ndescription: UNSELECTED_SKILL_CONTEXT\n---\nSibling instructions.",
		"commands/check.md":
			"---\ndescription: Command\n---\n$ARGUMENTS !`printf '%s' \"$ARGUMENTS\"`",
		"agents/helper.md":
			"---\ndescription: DELEGATE_HELPER\nmodel: haiku\n---\nAGENT_INSTRUCTION_SENTINEL. Reply briefly.",
		"hooks/hooks.json": JSON.stringify({
			hooks: {
				SessionStart: [
					{
						hooks: [
							{
								type: "command",
								command: `echo inherited > '${cwd}/inherited-hook'`,
							},
						],
					},
				],
			},
		}),
	};
	for (const [path, text] of Object.entries(files)) {
		await mkdir(join(plugin, path, ".."), { recursive: true });
		await writeFile(join(plugin, path), text);
	}
	await mkdir(join(market, ".agents", "plugins"), { recursive: true });
	await writeFile(
		join(market, ".agents", "plugins", "marketplace.json"),
		JSON.stringify({
			name: "fixture",
			plugins: [
				{
					name: "demo",
					source: { source: "local", path: "./plugins/demo" },
					policy: { installation: "AVAILABLE", authentication: "ON_USE" },
				},
			],
		}),
	);
	const run = async (args: string[]) => {
		const p = Bun.spawn([process.env.PTOLEMY_CODEX_PATH!, ...args], {
			cwd,
			env: process.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(p.stdout).text(),
			err = await new Response(p.stderr).text();
		if (await p.exited) throw Error(out + err);
	};
	let probe: ReturnType<typeof startMockAnthropicServer> | undefined;
	let codexProbe: ReturnType<typeof startMockResponsesServer> | undefined;
	try {
		await run(["plugin", "marketplace", "add", market]);
		await run(["plugin", "add", "demo@fixture"]);
		const userConfig = join(process.env.CODEX_HOME!, "config.toml");
		const profileConfig = join(
			process.env.CODEX_HOME!,
			"testprofile.config.toml",
		);
		const profileCommand = "echo profile > profile-config-hook";
		const projectHooks = join(cwd, ".codex", "hooks.json");
		await mkdir(join(cwd, ".codex"), { recursive: true });
		const userCommand = "echo user > user-config-hook",
			projectCommand = "echo project > project-config-hook";
		const trusted: Record<string, unknown> = {};
		for (const [path, command] of [
			[userConfig, userCommand],
			[projectHooks, projectCommand],
			[profileConfig, profileCommand],
		]) {
			const fingerprint = {
				event_name: "session_start",
				hooks: [{ async: false, command, timeout: 5, type: "command" }],
			};
			const hash = `sha256:${createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex")}`;
			for (const source of new Set([
				path,
				path.replace(/^\/var\//, "/private/var/"),
			]))
				trusted[`${source}:session_start:0:0`] = { trusted_hash: hash };
		}

		await writeFile(
			profileConfig,
			`[hooks]\nSessionStart=[{hooks=[{type="command",command=${JSON.stringify(profileCommand)},timeout=5}]}]\n`,
		);
		await writeFile(
			projectHooks,
			JSON.stringify({
				hooks: {
					SessionStart: [
						{
							hooks: [{ type: "command", command: projectCommand, timeout: 5 }],
						},
					],
				},
			}),
		);
		await appendFile(
			userConfig,
			`\n[projects.${JSON.stringify(await realpath(cwd))}]\ntrust_level="trusted"\n[hooks]\nSessionStart=[{hooks=[{type="command",command=${JSON.stringify(userCommand)},timeout=5}]}]\nstate=${toToml(trusted)}\n`,
		);
		const baseline = new Codex({
			codexPathOverride: process.env.PTOLEMY_CODEX_PATH,
			env: process.env as Record<string, string>,
			config: { features: { hooks: true } },
		});
		await baseline
			.startThread({
				workingDirectory: cwd,
				skipGitRepoCheck: true,
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
			})
			.run("Hello", { signal: AbortSignal.timeout(20000) });
		expect(await readFile(join(cwd, "user-config-hook"), "utf8")).toBe(
			"user\n",
		);
		expect(await readFile(join(cwd, "project-config-hook"), "utf8")).toBe(
			"project\n",
		);
		await run([
			"--profile",
			"testprofile",
			"exec",
			"--skip-git-repo-check",
			"--sandbox",
			"workspace-write",
			"-c",
			'approval_policy="never"',
			"-c",
			"features.hooks=true",
			"Hello",
		]);
		expect(await readFile(join(cwd, "profile-config-hook"), "utf8")).toBe(
			"profile\n",
		);
		await rm(join(cwd, "profile-config-hook"));
		await rm(join(cwd, "user-config-hook"));
		await rm(join(cwd, "project-config-hook"));
		inheritedContacts = 0;
		const global = await inventoryCodexPlugins(
			process.env.PTOLEMY_CODEX_PATH!,
			cwd,
			process.env as Record<string, string>,
		);
		expect(global.some((p) => p.id === "demo@fixture" && p.enabled)).toBe(true);
		await mkdir(join(process.env.CLAUDE_CONFIG_DIR!, "plugins"), {
			recursive: true,
		});
		await writeFile(
			join(process.env.CLAUDE_CONFIG_DIR!, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"demo@fixture": [
						{ scope: "user", installPath: plugin, version: "1" },
					],
				},
			}),
		);
		await writeFile(
			join(process.env.CLAUDE_CONFIG_DIR!, "settings.json"),
			JSON.stringify({
				enabledPlugins: { "demo@fixture": true },
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command: `echo global > '${cwd}/global-hook'`,
								},
							],
						},
					],
				},
			}),
		);
		const store = new ExtensionsStore({ root: join(root, "library") });
		const pkg = await store.importNative(
			"codex",
			global.find((p) => p.id === "demo@fixture")!,
		);
		expect(
			pkg.components.some((c) => c.kind === "skill" && c.name === "chosen"),
		).toBe(true);
		const selected = pkg.components
			.filter(
				(c) =>
					c.name === "chosen" || c.kind === "command" || c.kind === "agent",
			)
			.map((c) => c.id);
		const allBuiltins = (
			await inventoryClaudeBuiltins(process.env.PTOLEMY_CLAUDE_PATH!)
		).map((b) => b.name);
		const prepared = await prepareSessionExtensions(
			"fixture",
			cwd,
			[{ packageId: pkg.id, revision: pkg.revision, componentIds: selected }],
			"claude",
			{ store },
		);
		const frozenBuiltins = {
			all: allBuiltins.filter((name) => name !== "update-config"),
			selected: [],
		};
		const refreshedBuiltins = refreshClaudeBuiltinSelection(
			frozenBuiltins,
			allBuiltins,
		);
		expect(frozenBuiltins.all).not.toContain("update-config");
		expect(() =>
			denyUnselectedSlash(
				"/update-config",
				refreshedBuiltins.all,
				refreshedBuiltins.selected,
			),
		).toThrow();
		const opts = await claudeExtensionOptions(prepared, {
			...refreshedBuiltins,
			hasFileSkills: false,
		});
		const command = await resolveExtensionPrompt(
			prepared,
			"/demo:check $(touch ../command-outside)",
			cwd,
		);
		expect(command).toBe(
			"$(touch ../command-outside) $(touch ../command-outside)",
		);
		expect(
			await readFile(join(root, "command-outside"), "utf8").catch(() => null),
		).toBeNull();
		const name = prepared.agents[0].name;
		probe = startMockAnthropicServer({
			tool: "Agent",
			input: {
				description: "Probe",
				prompt: "Reply briefly",
				subagent_type: name,
			},
		});
		const q = query({
			prompt:
				"Crie o arquivo unused.txt na pasta atual contendo exatamente o texto: inert",
			options: {
				...opts,
				cwd,
				model: "haiku",
				pathToClaudeCodeExecutable: process.env.PTOLEMY_CLAUDE_PATH,
				env: { ...process.env, ANTHROPIC_BASE_URL: probe.url },
				strictMcpConfig: true,
				mcpServers: {},
				canUseTool: async (name, input) =>
					name === "Agent"
						? { behavior: "allow", updatedInput: input }
						: { behavior: "deny", message: "Inert probe" },
			},
		});
		const timeout = setTimeout(() => q.close(), 20000);
		try {
			for await (const _ of q) {
			}
		} finally {
			clearTimeout(timeout);
			q.close();
		}
		expect(JSON.stringify(probe.requests)).toContain("SELECTED_SKILL_CONTEXT");
		expect(JSON.stringify(probe.requests)).not.toContain(
			"UNSELECTED_SKILL_CONTEXT",
		);
		expect(
			probe.requests.some((r) =>
				JSON.stringify(r.system).includes("AGENT_INSTRUCTION_SENTINEL"),
			),
		).toBe(true);
		expect(
			await readFile(join(cwd, "inherited-hook"), "utf8").catch(() => null),
		).toBeNull();
		expect(
			await readFile(join(cwd, "global-hook"), "utf8").catch(() => null),
		).toBeNull();
		expect(inheritedContacts).toBe(0);
		probe.stop();
		for (const [skill, blocked] of [
			["update-config", true],
			[
				`${prepared.claudePlugins[0]
					.split("/")
					.pop()
					?.replace(/-claude$/, "")}:chosen`,
				false,
			],
		] as const) {
			probe = startMockAnthropicServer({ tool: "Skill", input: { skill } });
			const permissions: string[] = [];
			const skillQuery = query({
				prompt:
					"Crie o arquivo unused.txt na pasta atual contendo exatamente o texto: inert",
				options: {
					...opts,
					cwd,
					model: "haiku",
					pathToClaudeCodeExecutable: process.env.PTOLEMY_CLAUDE_PATH,
					env: { ...process.env, ANTHROPIC_BASE_URL: probe.url },
					strictMcpConfig: true,
					mcpServers: {},
					canUseTool: async (name, input) => {
						permissions.push(name);
						return name === "Skill"
							? { behavior: "allow", updatedInput: input }
							: { behavior: "deny", message: "Inert probe" };
					},
				},
			});
			try {
				for await (const _ of skillQuery) {
				}
			} finally {
				skillQuery.close();
			}
			const messages = probe.requests.flatMap(
				(r) =>
					(r.messages ?? []) as Array<{
						content?: Array<{
							type?: string;
							is_error?: boolean;
							content?: unknown;
						}>;
					}>,
			);
			const toolResult = messages
				.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
				.find((b) => b.type === "tool_result");
			expect(toolResult?.is_error === true).toBe(blocked);
			if (blocked) {
				expect(permissions).not.toContain("Skill");
				expect(JSON.stringify(toolResult)).toContain(
					"blocked by permission rules",
				);
			} else expect(JSON.stringify(toolResult)).toContain("Launching skill");
			probe.stop();
		}
		const empty = await prepareSessionExtensions("empty", cwd, [], "claude", {
			store,
		});
		const noneOpts = await claudeExtensionOptions(empty, {
			all: allBuiltins,
			selected: [],
			hasFileSkills: false,
		});
		mocks.anthropicMock.requests.length = 0;
		const none = query({
			prompt: "Hello",
			options: {
				...noneOpts,
				cwd,
				model: "haiku",
				pathToClaudeCodeExecutable: process.env.PTOLEMY_CLAUDE_PATH,
				env: process.env,
				strictMcpConfig: true,
				mcpServers: {},
			},
		});
		try {
			for await (const _ of none) {
			}
		} finally {
			none.close();
		}
		expect(JSON.stringify(mocks.anthropicMock.requests)).not.toContain(
			"update-config",
		);
		expect(JSON.stringify(mocks.anthropicMock.requests)).not.toContain(
			"SELECTED_SKILL_CONTEXT",
		);
		const codexPrepared = await prepareSessionExtensions(
			"codex-fixture",
			cwd,
			[{ packageId: pkg.id, revision: pkg.revision, componentIds: selected }],
			"codex",
			{ store },
		);
		const selectedHook = {
			cwd,
			root: cwd,
			data: cwd,
			event: "SessionStart",
			command: "echo selected > selected-hook",
			timeout: 5,
		};
		const installation = join(root, ".codex", "installation_id");
		const beforeInventory = {
			bytes: await readFile(installation),
			mtime: (await stat(installation)).mtimeMs,
		};
		const profileHooks = await inventoryCodexHooks(
			process.env.PTOLEMY_CODEX_PATH!,
			cwd,
			process.env as Record<string, string>,
		);
		expect(
			profileHooks.some((h) => h.key.includes("hooks.json:session_start:0:0")),
		).toBe(true);
		expect(await readFile(installation)).toEqual(beforeInventory.bytes);
		expect((await stat(installation)).mtimeMs).toBe(beforeInventory.mtime);
		const selectedHookOverrides = await codexExtensionOverrides(
			{ ...codexPrepared, hooks: [selectedHook] },
			process.env.PTOLEMY_CODEX_PATH!,
			cwd,
			process.env as Record<string, string>,
			"selected-hook",
		);
		const hooked = new Codex({
			codexPathOverride: process.env.PTOLEMY_CODEX_PATH,
			env: process.env as Record<string, string>,
			configOverrides: selectedHookOverrides,
		});
		await hooked
			.startThread({
				workingDirectory: cwd,
				skipGitRepoCheck: true,
				sandboxMode: "workspace-write",
				approvalPolicy: "never",
			})
			.run("Hello", { signal: AbortSignal.timeout(20000) });

		expect(await readFile(join(cwd, "selected-hook"), "utf8")).toBe(
			"selected\n",
		);
		expect(
			await readFile(join(cwd, "profile-config-hook"), "utf8").catch(
				() => null,
			),
		).toBeNull();
		expect(
			await readFile(join(cwd, "user-config-hook"), "utf8").catch(() => null),
		).toBeNull();
		expect(
			await readFile(join(cwd, "project-config-hook"), "utf8").catch(
				() => null,
			),
		).toBeNull();
		codexProbe = startMockResponsesServer({
			name: "spawn_agent",
			namespace: "collaboration",
			arguments: {
				agent_type: codexPrepared.agents[0].name,
				message: "Reply briefly",
				task_name: "probe",
			},
		});
		const overrides = await codexExtensionOverrides(
			codexPrepared,
			process.env.PTOLEMY_CODEX_PATH!,
			cwd,
			process.env as Record<string, string>,
			"codex-fixture",
		);
		const codex = new Codex({
			codexPathOverride: process.env.PTOLEMY_CODEX_PATH,
			env: process.env as Record<string, string>,
			configOverrides: [
				...overrides,
				`model_providers.ptolemy_mock.base_url=${JSON.stringify(codexProbe.url)}`,
			],
			config: {
				skills: {
					bundled: { enabled: false },
					config: codexPrepared.skills.map((s) => ({
						path: s.path,
						enabled: true,
					})),
				},
			},
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
		expect(JSON.stringify(codexProbe.requests)).not.toContain(
			"UNSELECTED_SKILL_CONTEXT",
		);
		expect(JSON.stringify(codexProbe.requests)).toContain(
			"SELECTED_SKILL_CONTEXT",
		);
		expect(
			codexProbe.requests.some((r) =>
				JSON.stringify(r.body).includes("AGENT_INSTRUCTION_SENTINEL"),
			),
		).toBe(true);
		expect(
			await readFile(join(cwd, "inherited-hook"), "utf8").catch(() => null),
		).toBeNull();
		expect(inheritedContacts).toBe(0);
		expect(
			await readFile(join(cwd, "profile-config-hook"), "utf8").catch(
				() => null,
			),
		).toBeNull();
		expect(
			await readFile(join(cwd, "user-config-hook"), "utf8").catch(() => null),
		).toBeNull();
		expect(
			await readFile(join(cwd, "project-config-hook"), "utf8").catch(
				() => null,
			),
		).toBeNull();
	} finally {
		inheritedMcp.stop(true);
		probe?.stop();
		codexProbe?.stop();
		mocks.stop();
		for (const k of Object.keys(process.env))
			if (!(k in saved)) delete process.env[k];
		Object.assign(process.env, saved);
		await rm(root, { recursive: true, force: true });
	}
}, 90000);

test("trusted package scripts survive workspace mutation and cannot modify their execution snapshot", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-integrity-it-"));
	const saved = process.env.PTOLEMY_HOME;
	process.env.PTOLEMY_HOME = root;
	try {
		const cwd = join(root, "project"),
			plugin = join(root, "plugin");
		await mkdir(cwd);
		await mkdir(join(plugin, "hooks"), { recursive: true });
		await writeFile(
			join(plugin, "plugin.json"),
			JSON.stringify({ name: "integrity" }),
		);
		await writeFile(
			join(plugin, "script.sh"),
			'echo original > "$PLUGIN_DATA/result"; echo corrupt > "$PLUGIN_ROOT/script.sh"; printf \'{}\'',
		);
		await writeFile(
			join(plugin, "hooks/hooks.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							hooks: [
								{ type: "command", command: 'sh "$PLUGIN_ROOT/script.sh"' },
							],
						},
					],
				},
			}),
		);
		const store = new ExtensionsStore({ root: join(root, "library") });
		const pkg = await store.importNative("claude", {
			id: "integrity@test",
			name: "integrity",
			enabled: true,
			path: plugin,
			managed: false,
		});
		const prepared = await prepareSessionExtensions(
			"integrity",
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
			{ store },
		);
		const hook = prepared.hooks[0],
			original = await readFile(join(hook.root, "script.sh"), "utf8");
		await rm(join(prepared.roots[0], "script.sh"));
		await writeFile(
			join(cwd, "replacement"),
			'echo replaced > "$PLUGIN_DATA/result"',
		);
		await symlink(
			join(cwd, "replacement"),
			join(prepared.roots[0], "script.sh"),
		);
		await runExtensionHook(hook, {
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
		});
		expect(await readFile(join(hook.data, "result"), "utf8")).toBe(
			"original\n",
		);
		expect(await readFile(join(hook.root, "script.sh"), "utf8")).toBe(original);
	} finally {
		if (saved === undefined) delete process.env.PTOLEMY_HOME;
		else process.env.PTOLEMY_HOME = saved;
		await rm(root, { recursive: true, force: true });
	}
});

test("trusted native Claude prompt hooks evaluate without tools and deny before Write", async () => {
	const root = await mkdtemp(join(tmpdir(), "ptolemy-prompt-hook-it-"));
	const saved = { ...process.env };
	const mocks = await configureLocalAgents(root, process.cwd());
	process.env.PTOLEMY_HOME = join(root, "ptolemy");
	const cwd = join(root, "project"),
		plugin = join(root, "source");
	await mkdir(cwd);
	await mkdir(join(plugin, "hooks"), { recursive: true });
	await writeFile(
		join(plugin, "plugin.json"),
		JSON.stringify({ name: "promptprobe" }),
	);
	await writeFile(
		join(plugin, "hooks/hooks.json"),
		JSON.stringify({
			hooks: {
				PreToolUse: [
					{
						hooks: [
							{
								type: "prompt",
								prompt: "PTOLEMY_PROMPT_HANDLER deny this action. $ARGUMENTS",
								timeout: 5,
							},
						],
					},
				],
			},
		}),
	);
	let evaluations = 0;
	const proxy = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const text = await req.text();
			if (
				text.includes("PTOLEMY_PROMPT_HANDLER") &&
				!(JSON.parse(text).tools ?? []).length
			) {
				evaluations++;
				const b = JSON.parse(text);
				expect((b.tools ?? []).length).toBe(0);
				const usage = {
					input_tokens: 10,
					output_tokens: 10,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				};
				const block = {
					type: "text" as const,
					text: JSON.stringify({ ok: false, reason: "PTOLEMY_PROMPT_BLOCK" }),
				};
				return b.stream
					? new Response(stream(evaluations, b.model, usage, block), {
							headers: { "content-type": "text/event-stream" },
						})
					: Response.json({
							id: "hook",
							type: "message",
							role: "assistant",
							model: b.model,
							content: [block],
							stop_reason: "end_turn",
							usage,
						});
			}
			return fetch(mocks.anthropicMock.url + new URL(req.url).pathname, {
				method: req.method,
				headers: req.headers,
				body: text,
			});
		},
	});
	try {
		const store = new ExtensionsStore({ root: join(root, "library") });
		const pkg = await store.importNative("claude", {
			id: "prompt@fixture",
			name: "prompt",
			enabled: true,
			path: plugin,
			managed: false,
		});
		const prepared = await prepareSessionExtensions(
			"prompt",
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
			{ store },
		);
		const q = query({
			prompt:
				"Crie o arquivo blocked.txt na pasta atual contendo exatamente o texto: forbidden",
			options: {
				cwd,
				model: "haiku",
				pathToClaudeCodeExecutable: process.env.PTOLEMY_CLAUDE_PATH,
				env: {
					...process.env,
					ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
				},
				strictMcpConfig: true,
				mcpServers: {},
				...(await claudeExtensionOptions(prepared)),
				canUseTool: async (_t, input) => ({
					behavior: "allow",
					updatedInput: input,
				}),
			},
		});
		try {
			for await (const _ of q) {
			}
		} finally {
			q.close();
		}
		expect(evaluations).toBeGreaterThan(0);
		expect(JSON.stringify(mocks.anthropicMock.requests)).toContain(
			"PTOLEMY_PROMPT_BLOCK",
		);
		expect(
			await readFile(join(cwd, "blocked.txt"), "utf8").catch(() => null),
		).toBeNull();
	} finally {
		proxy.stop();
		mocks.stop();
		for (const k of Object.keys(process.env))
			if (!(k in saved)) delete process.env[k];
		Object.assign(process.env, saved);
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

test("read-only Codex extensions cannot write even inside the project", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "ptolemy-extension-readonly-"));
	try {
		const spec = {
			cwd,
			root: cwd,
			data: cwd,
			event: "PreToolUse",
			command: "echo forbidden > readonly-file",
			timeout: 2,
			readOnly: true,
		};
		expect(await runExtensionHook(spec, {})).toMatchObject({
			hookSpecificOutput: { permissionDecision: "deny" },
		});
		expect(
			await readFile(join(cwd, "readonly-file"), "utf8").catch(() => null),
		).toBeNull();
		const prepared = await prepareSessionExtensions(
			"readonly",
			cwd,
			[],
			"codex",
		);
		prepared.commands.push({
			name: "test:read",
			root: cwd,
			metadata: {},
			prompt: "!`echo forbidden > readonly-command; printf safe`",
		});
		expect(
			await resolveExtensionPrompt(prepared, "/test:read", cwd, true),
		).toBe("safe");
		expect(
			await readFile(join(cwd, "readonly-command"), "utf8").catch(() => null),
		).toBeNull();
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
