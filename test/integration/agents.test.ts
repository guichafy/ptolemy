/**
 * Integration tests for the two chat agents, end to end through the real
 * session manager (the module the RPC layer calls): create → deferred start
 * on resume → streamed AgentEvents → persistence → follow-up turn → switch
 * agents and cold-resume → delete.
 *
 * Two modes, same scenario (see helpers/scenario.ts):
 *
 * - local (default, `bun run test:integration`): real SDKs and real CLIs (the
 *   binaries bundled with each SDK) talking to local mock servers of the
 *   Anthropic Messages API and the OpenAI Responses API. Offline, no sign-in,
 *   runs in CI.
 * - live (`bun run test:integration:live`): the `claude` and `codex` CLIs
 *   installed and signed in on this machine, against the real services.
 *
 * Ptolemy's own data (settings, sessions, projects) always goes to a
 * throwaway PTOLEMY_HOME. In live mode the agents keep the real $HOME, which
 * is where their sign-ins live.
 *
 * Environment knobs (inline, or in a git-ignored .env.test.local):
 *   PTOLEMY_IT_MODE=local|live      (the scripts set this)
 *   PTOLEMY_IT_AGENTS=claude,codex  (run only some agents)
 *   PTOLEMY_IT_CLAUDE_MODEL=haiku   (live: Claude model alias)
 *   PTOLEMY_IT_CODEX_MODEL=...      (live: Codex model; default = CLI config)
 *   PTOLEMY_CLAUDE_PATH / PTOLEMY_CODEX_PATH (force a CLI binary)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentKind } from "@/shared/agent-protocol";
import {
	type MockAnthropicServer,
	startMockAnthropicServer,
} from "./helpers/mock-anthropic-server";
import {
	type MockResponsesServer,
	mockCodexConfigToml,
	startMockResponsesServer,
} from "./helpers/mock-responses-server";
import {
	ASK_FILE_NAME,
	ASK_FILE_TEXT,
	createFilePrompt,
	scenarioFile,
} from "./helpers/scenario";

// ---------------------------------------------------------------------------
// Mode and environment. Everything here runs before the app modules are
// imported: some of them resolve their data paths at import time.
// ---------------------------------------------------------------------------

const MODE = process.env.PTOLEMY_IT_MODE === "live" ? "live" : "local";
const LIVE = MODE === "live";
const WANTED = new Set(
	(process.env.PTOLEMY_IT_AGENTS ?? "claude,codex")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
);

const TMP = await mkdtemp(join(tmpdir(), "ptolemy-it-"));
process.env.PTOLEMY_HOME = TMP;

// When the suite itself runs inside a Claude Code session, a spawned
// `claude` would inherit that session's id and resume the wrong transcript.
const INHERITED_SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID;
for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID"]) {
	delete process.env[key];
}

const REPO = join(import.meta.dir, "..", "..");
let anthropicMock: MockAnthropicServer | null = null;
let responsesMock: MockResponsesServer | null = null;

if (!LIVE) {
	// Local servers only: bypass any HTTP(S) proxy for loopback.
	for (const key of ["NO_PROXY", "no_proxy"]) {
		process.env[key] = ["127.0.0.1", "localhost", process.env[key]]
			.filter(Boolean)
			.join(",");
	}

	// Claude: the CLI bundled with the Agent SDK, isolated config, API key
	// auth against the mock. Drop anything that could route it elsewhere.
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_CODE_")) {
			delete process.env[key];
		}
	}
	anthropicMock = startMockAnthropicServer();
	process.env.ANTHROPIC_BASE_URL = anthropicMock.url;
	process.env.ANTHROPIC_API_KEY = "mock-key";
	process.env.CLAUDE_CONFIG_DIR = join(TMP, ".claude");
	process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
	process.env.PTOLEMY_CLAUDE_PATH ??= join(
		REPO,
		"node_modules",
		"@anthropic-ai",
		`claude-agent-sdk-${process.platform}-${process.arch}`,
		"claude",
	);

	// Codex: the CLI bundled with the SDK, with its own CODEX_HOME pointing
	// at the mock provider.
	responsesMock = startMockResponsesServer();
	const codexHome = join(TMP, ".codex");
	process.env.CODEX_HOME = codexHome;
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		mockCodexConfigToml(responsesMock.url),
	);
	process.env.PTOLEMY_MOCK_API_KEY = "mock-key";
	process.env.PTOLEMY_CODEX_PATH ??= join(
		REPO,
		"node_modules",
		".bin",
		"codex",
	);
}

const sm = await import("../../src/bun/claude/session-manager");
const { loadSettings, saveSettings } = await import("../../src/bun/settings");

const CLAUDE_MODEL = LIVE
	? (process.env.PTOLEMY_IT_CLAUDE_MODEL ?? "haiku")
	: "haiku";
const CODEX_MODEL = LIVE ? process.env.PTOLEMY_IT_CODEX_MODEL : undefined;

// ---------------------------------------------------------------------------
// Which agents can run here
// ---------------------------------------------------------------------------

async function claudeSkipReason(): Promise<string | null> {
	if (!WANTED.has("claude")) return "fora de PTOLEMY_IT_AGENTS";
	try {
		const { findClaudeCli } = await import("../../src/bun/claude/claude-cli");
		const path = await findClaudeCli();
		if (!(await Bun.file(path).exists())) return `CLI não encontrado: ${path}`;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
	return null;
}

async function codexSkipReason(): Promise<string | null> {
	if (!WANTED.has("codex")) return "fora de PTOLEMY_IT_AGENTS";
	const { getCodexAuthStatus } = await import("../../src/bun/codex/auth");
	const status = await getCodexAuthStatus();
	if (status.cliStatus === "not-installed") return "Codex CLI não instalado";
	if (LIVE && status.cliStatus !== "authenticated") {
		return "Codex CLI sem login (rode `codex login`)";
	}
	return null;
}

const SKIP: Record<AgentKind, string | null> = {
	claude: await claudeSkipReason(),
	codex: await codexSkipReason(),
};
for (const [agent, reason] of Object.entries(SKIP)) {
	if (reason) {
		console.warn(`[integration] ${agent} pulado (${MODE}): ${reason}`);
	}
}
console.log(`[integration] modo=${MODE} dados=${TMP}`);

// ---------------------------------------------------------------------------
// Event capture
// ---------------------------------------------------------------------------

const events = new Map<string, AgentEvent[]>();
const wakers: Array<() => void> = [];

sm.setSender({
	sendEvent: (sessionId, event) => {
		const list = events.get(sessionId) ?? [];
		list.push(event);
		events.set(sessionId, list);
		// HITL: approve every permission request, like clicking "Permitir".
		if (event.type === "tool-permission-request") {
			sm.getPermissionGate().approve(event.permissionId, "allow");
		}
		for (const wake of wakers.splice(0)) wake();
	},
});

type Ev<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;

function eventsOf(sessionId: string, from = 0): AgentEvent[] {
	return (events.get(sessionId) ?? []).slice(from);
}

function ofType<T extends AgentEvent["type"]>(
	list: AgentEvent[],
	type: T,
): Ev<T>[] {
	return list.filter((e): e is Ev<T> => e.type === type);
}

function textOf(list: AgentEvent[]): string {
	return ofType(list, "text-delta")
		.map((e) => e.delta)
		.join("");
}

/**
 * Waits until the session emits `finish` after index `from` and returns that
 * turn's events. A timeout reports the errors the agent sent.
 */
async function waitTurn(
	sessionId: string,
	from: number,
	timeoutMs: number,
): Promise<AgentEvent[]> {
	const deadline = Date.now() + timeoutMs;
	while (ofType(eventsOf(sessionId, from), "finish").length === 0) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			const errors = ofType(eventsOf(sessionId, from), "error").map(
				(e) => e.error.message,
			);
			throw new Error(
				`timeout esperando o fim do turno de ${sessionId}${
					errors.length ? `; erros: ${errors.join(" | ")}` : ""
				}`,
			);
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, Math.min(remaining, 1000));
			wakers.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
	return eventsOf(sessionId, from);
}

function expectCleanTurn(turn: AgentEvent[], okReason: string) {
	const errors = ofType(turn, "error").map((e) => e.error.message);
	expect(errors).toEqual([]);
	expect(ofType(turn, "finish")[0].reason).toBe(okReason);
}

async function metaOf(sessionId: string) {
	const meta = (await sm.listSessions()).find((s) => s.id === sessionId);
	if (!meta) throw new Error(`sessão ${sessionId} não está no índice`);
	return meta;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	const settings = await loadSettings();
	await saveSettings({
		...settings,
		claude: { ...settings.claude, model: CLAUDE_MODEL },
		codex: CODEX_MODEL
			? { ...settings.codex, model: CODEX_MODEL }
			: settings.codex,
	});
});

afterAll(async () => {
	anthropicMock?.stop();
	responsesMock?.stop();
	await rm(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The scenario, per agent
// ---------------------------------------------------------------------------

const TURN_TIMEOUT = LIVE ? 240_000 : 60_000;
const TEST_TIMEOUT = TURN_TIMEOUT + 30_000;

const OK_REASON: Record<AgentKind, string> = {
	claude: "success",
	codex: "completed",
};

/** Tools the mock "models" use, as the chat names them. */
const LOCAL_TOOLS: Record<AgentKind, string[]> = {
	claude: ["Write", "Bash"],
	codex: ["ApplyPatch", "Shell"],
};

function createOptions(agent: AgentKind) {
	return agent === "codex" ? { agent } : {};
}

function scenario(agent: AgentKind, other: AgentKind) {
	const file = scenarioFile(agent);
	const state = { id: "", projectPath: "", sdkId: "", otherId: "" };

	describe.skipIf(SKIP[agent] !== null)(`${agent} (${MODE})`, () => {
		test("cria a sessão e só inicia o agente quando o chat retoma", async () => {
			state.id = await sm.createSession(
				createFilePrompt(file),
				createOptions(agent),
			);
			const meta = await metaOf(state.id);
			state.projectPath = meta.projectPath;
			expect(sm.sessionAgent(meta)).toBe(agent);
			expect(existsSync(state.projectPath)).toBe(true);
			expect(eventsOf(state.id)).toHaveLength(0);
		});

		test(
			"turno 1: cria o arquivo e roda um comando na pasta da conversa",
			async () => {
				expect(await sm.resumeSession(state.id)).toBe(true);
				const turn = await waitTurn(state.id, 0, TURN_TIMEOUT);
				expectCleanTurn(turn, OK_REASON[agent]);

				const tools = ofType(turn, "tool-call").map((t) => t.toolName);
				if (LIVE) expect(tools.length).toBeGreaterThan(0);
				else expect(tools).toEqual(LOCAL_TOOLS[agent]);
				expect(ofType(turn, "tool-result").length).toBeGreaterThan(0);
				expect(textOf(turn).trim()).not.toBe("");

				const written = await readFile(
					join(state.projectPath, file.name),
					"utf8",
				);
				expect(written.trim()).toBe(file.text);
			},
			TEST_TIMEOUT,
		);

		test("persiste a conversa e o id do agente", async () => {
			const meta = await metaOf(state.id);
			state.sdkId = meta.sdkSessionId;
			expect(state.sdkId).not.toBe("");
			expect(state.sdkId).not.toBe(state.id);
			if (INHERITED_SESSION_ID) {
				expect(state.sdkId).not.toBe(INHERITED_SESSION_ID);
			}

			const messages = await sm.getSessionMessages(state.id);
			expect(messages[0].role).toBe("user");
			expect(messages.at(-1)?.role).toBe("assistant");
			const blocks = messages.slice(1).flatMap((m) => m.blocks);
			expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
			expect(blocks.some((b) => b.type === "text")).toBe(true);
		});

		test(
			"turno 2: lembra o primeiro turno na mesma sessão",
			async () => {
				const from = eventsOf(state.id).length;
				await sm.sendMessage(ASK_FILE_NAME);
				const turn = await waitTurn(state.id, from, TURN_TIMEOUT);
				expectCleanTurn(turn, OK_REASON[agent]);
				expect(textOf(turn)).toContain(file.name);
				expect((await metaOf(state.id)).sdkSessionId).toBe(state.sdkId);
			},
			TEST_TIMEOUT,
		);

		test.skipIf(SKIP[other] !== null)(
			`troca para ${other} e retoma a frio, lembrando a conversa`,
			async () => {
				state.otherId = await sm.createSession(
					"Responda só: oi",
					createOptions(other),
				);
				expect(await sm.resumeSession(state.otherId)).toBe(true);
				expect(sm.getActiveSessionId()).toBe(state.otherId);
				const otherTurn = await waitTurn(state.otherId, 0, TURN_TIMEOUT);
				expectCleanTurn(otherTurn, OK_REASON[other]);

				// Cold resume: a fresh SDK session/thread from the stored id.
				expect(await sm.resumeSession(state.id)).toBe(true);
				expect(sm.getActiveSessionId()).toBe(state.id);
				const from = eventsOf(state.id).length;
				await sm.sendMessage(ASK_FILE_TEXT);
				const turn = await waitTurn(state.id, from, TURN_TIMEOUT);
				expectCleanTurn(turn, OK_REASON[agent]);
				expect(textOf(turn)).toContain(file.text);

				const meta = await metaOf(state.id);
				expect(meta.sdkSessionId).toBe(state.sdkId);
				if (agent === "claude") expect(meta.model).toBe(CLAUDE_MODEL);
			},
			TEST_TIMEOUT * 2,
		);

		test("apagar a sessão remove a pasta do projeto", async () => {
			for (const id of [state.otherId, state.id]) {
				if (id) expect(await sm.deleteSession(id)).toBe(true);
			}
			expect(existsSync(state.projectPath)).toBe(false);
			expect(sm.getActiveSessionId()).toBeNull();
		});
	});
}

scenario("codex", "claude");
scenario("claude", "codex");
