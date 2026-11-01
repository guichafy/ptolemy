/**
 * Integration tests for the two chat agents, end to end through the real
 * session manager (the same module the RPC layer calls): create → deferred
 * start on resume → streamed AgentEvents → persistence → follow-up turn on
 * the same conversation → delete.
 *
 * - Codex: real @openai/codex-sdk + real Codex CLI (bundled with the SDK),
 *   pointed at a local mock of the Responses API. Runs offline.
 * - Claude: real @anthropic-ai/claude-agent-sdk + the installed `claude` CLI
 *   against the real model. Skipped when `claude` is not installed, or with
 *   PTOLEMY_IT_SKIP_CLAUDE=1.
 *
 * Everything runs under a throwaway HOME, so settings, sessions and project
 * folders never touch the real ~/.ptolomeu or ~/Library.
 *
 * Run with: bun run test:integration
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@/shared/agent-protocol";
import {
	CODEX_FILE_NAME,
	CODEX_FILE_TEXT,
	type MockResponsesServer,
	mockProviderConfig,
	startMockResponsesServer,
	TOOL_MARKER,
} from "./helpers/mock-responses-server";

// ---------------------------------------------------------------------------
// Isolated environment (must be set before the app modules are imported:
// session paths are resolved from HOME at import time).
// ---------------------------------------------------------------------------

const REAL_HOME = process.env.HOME ?? "";
const HOME = await mkdtemp(join(tmpdir(), "ptolemy-it-"));
process.env.HOME = HOME;
for (const key of ["NO_PROXY", "no_proxy"]) {
	process.env[key] = ["127.0.0.1", "localhost", process.env[key]]
		.filter(Boolean)
		.join(",");
}

// When the suite itself runs inside a Claude Code session, the spawned
// `claude` CLI would inherit that session's id and resume the wrong
// transcript. Drop the inherited ids so each test conversation is its own.
const INHERITED_SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID;
for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID"]) {
	delete process.env[key];
}

const REPO = join(import.meta.dir, "..", "..");
const BUNDLED_CODEX = join(REPO, "node_modules", ".bin", "codex");
process.env.PTOLEMY_CODEX_PATH ??= BUNDLED_CODEX;
process.env.PTOLEMY_MOCK_API_KEY = "mock-key";

// An alias from the SDK's model list: full ids are not in that list, and a
// cold resume would silently swap them for "default".
const CLAUDE_MODEL = process.env.PTOLEMY_IT_CLAUDE_MODEL ?? "haiku";
const CLAUDE_AVAILABLE =
	process.env.PTOLEMY_IT_SKIP_CLAUDE !== "1" && Bun.which("claude") !== null;

const sm = await import("../../src/bun/claude/session-manager");

// ---------------------------------------------------------------------------
// Event capture
// ---------------------------------------------------------------------------

const events = new Map<string, AgentEvent[]>();
const waiters: Array<() => void> = [];

sm.setSender({
	sendEvent: (sessionId, event) => {
		const list = events.get(sessionId) ?? [];
		list.push(event);
		events.set(sessionId, list);
		// HITL: approve every tool permission request, like a user clicking
		// "Permitir" in the chat.
		if (event.type === "tool-permission-request") {
			sm.getPermissionGate().approve(event.permissionId, "allow");
		}
		for (const wake of waiters.splice(0)) wake();
	},
});

function eventsOf(sessionId: string): AgentEvent[] {
	return events.get(sessionId) ?? [];
}

function countOf(sessionId: string, type: AgentEvent["type"]): number {
	return eventsOf(sessionId).filter((e) => e.type === type).length;
}

async function waitFor(
	label: string,
	predicate: () => boolean,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(`timeout waiting for ${label}`);
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, Math.min(remaining, 1000));
			waiters.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
}

const waitForFinish = (sessionId: string, n: number, timeoutMs: number) =>
	waitFor(
		`finish #${n} of ${sessionId}`,
		() => countOf(sessionId, "finish") >= n,
		timeoutMs,
	);

function streamedText(sessionId: string): string {
	return eventsOf(sessionId)
		.filter(
			(e): e is Extract<AgentEvent, { type: "text-delta" }> =>
				e.type === "text-delta",
		)
		.map((e) => e.delta)
		.join("");
}

function finishes(sessionId: string) {
	return eventsOf(sessionId).filter(
		(e): e is Extract<AgentEvent, { type: "finish" }> => e.type === "finish",
	);
}

async function metaOf(sessionId: string) {
	const sessions = await sm.listSessions();
	const meta = sessions.find((s) => s.id === sessionId);
	if (!meta) throw new Error(`session ${sessionId} not in index`);
	return meta;
}

function blockTypes(
	messages: Awaited<ReturnType<typeof sm.getSessionMessages>>,
) {
	return messages.map(
		(m) => `${m.role}:${m.blocks.map((b) => b.type).join("+")}`,
	);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let mock: MockResponsesServer;

beforeAll(async () => {
	mock = startMockResponsesServer();

	// Codex reads its provider from $HOME/.codex/config.toml.
	const cfg = mockProviderConfig(mock.url);
	const provider = cfg.model_providers.ptolemy_mock;
	await mkdir(join(HOME, ".codex"), { recursive: true });
	await writeFile(
		join(HOME, ".codex", "config.toml"),
		[
			`model_provider = "${cfg.model_provider}"`,
			`model = "${cfg.model}"`,
			"",
			"[model_providers.ptolemy_mock]",
			`name = "${provider.name}"`,
			`base_url = "${provider.base_url}"`,
			`env_key = "${provider.env_key}"`,
			`wire_api = "${provider.wire_api}"`,
			`supports_websockets = ${provider.supports_websockets}`,
			`request_max_retries = ${provider.request_max_retries}`,
			`stream_max_retries = ${provider.stream_max_retries}`,
			"",
		].join("\n"),
	);

	// App settings: Claude model for the run; Codex defers to the CLI config.
	const { loadSettings, saveSettings } = await import("../../src/bun/settings");
	const settings = await loadSettings();
	await saveSettings({
		...settings,
		claude: { ...settings.claude, model: CLAUDE_MODEL },
	});
});

afterAll(async () => {
	mock?.stop();
	process.env.HOME = REAL_HOME;
	await rm(HOME, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

describe("Codex (SDK + CLI reais, modelo local)", () => {
	let sessionId = "";
	let projectPath = "";

	test("cria a sessão e só inicia o turno quando o chat retoma", async () => {
		sessionId = await sm.createSession(
			`Crie ${CODEX_FILE_NAME} e mostre o conteúdo ${TOOL_MARKER}`,
			{ agent: "codex" },
		);
		const meta = await metaOf(sessionId);
		projectPath = meta.projectPath;
		expect(meta.agent).toBe("codex");
		expect(meta.sdkSessionId).toBe("");
		expect(existsSync(projectPath)).toBe(true);
		// Deferred start: nothing has run before resumeSession.
		expect(eventsOf(sessionId)).toHaveLength(0);
		expect(mock.requests).toHaveLength(0);
	});

	test("primeiro turno: arquivo, comando e resposta chegam como AgentEvents", async () => {
		expect(await sm.resumeSession(sessionId)).toBe(true);
		await waitForFinish(sessionId, 1, 90_000);

		const evs = eventsOf(sessionId);
		const toolCalls = evs.filter(
			(e): e is Extract<AgentEvent, { type: "tool-call" }> =>
				e.type === "tool-call",
		);
		expect(toolCalls.map((t) => t.toolName)).toEqual(["ApplyPatch", "Shell"]);
		expect(toolCalls[1].args).toMatchObject({
			command: expect.stringContaining(`cat ${CODEX_FILE_NAME}`),
		});
		const shellResult = evs.find(
			(e): e is Extract<AgentEvent, { type: "tool-result" }> =>
				e.type === "tool-result" && e.toolCallId === toolCalls[1].toolCallId,
		);
		expect(String(shellResult?.result)).toContain(CODEX_FILE_TEXT);
		expect(streamedText(sessionId)).toContain(
			`Pronto: criei ${CODEX_FILE_NAME}.`,
		);
		expect(countOf(sessionId, "error")).toBe(0);

		const [finish] = finishes(sessionId);
		expect(finish.reason).toBe("completed");
		expect(finish.usage.inputTokens).toBeGreaterThan(0);

		// The sandbox wrote inside the conversation's project directory.
		expect(await readFile(join(projectPath, CODEX_FILE_NAME), "utf8")).toBe(
			`${CODEX_FILE_TEXT}\n`,
		);
	});

	test("persiste o thread id e as mensagens antes do finish", async () => {
		const meta = await metaOf(sessionId);
		expect(meta.sdkSessionId).not.toBe("");
		const messages = await sm.getSessionMessages(sessionId);
		expect(blockTypes(messages)).toEqual([
			"user:text",
			"assistant:tool_use+tool_result+tool_use+tool_result+text",
		]);
	});

	test("segundo turno retoma o mesmo thread do Codex", async () => {
		const threadId = (await metaOf(sessionId)).sdkSessionId;
		const before = mock.requests.length;
		await sm.sendMessage("E agora, tudo certo?");
		await waitForFinish(sessionId, 2, 90_000);

		expect(finishes(sessionId)[1].reason).toBe("completed");
		expect(streamedText(sessionId)).toContain("Continuo na mesma conversa.");
		expect((await metaOf(sessionId)).sdkSessionId).toBe(threadId);
		// `codex exec resume` sent the earlier turn back as history.
		const resumed = JSON.stringify(mock.requests[before].body.input);
		expect(resumed).toContain(TOOL_MARKER);
		expect(resumed).toContain("E agora, tudo certo?");
		expect((await sm.getSessionMessages(sessionId)).length).toBe(4);
	});

	test("apagar a sessão remove a pasta do projeto", async () => {
		expect(await sm.deleteSession(sessionId)).toBe(true);
		expect(existsSync(projectPath)).toBe(false);
		expect(sm.getActiveSessionId()).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const CLAUDE_FILE = "ola-claude.txt";
const CLAUDE_TEXT = "Olá do Claude";

describe.skipIf(!CLAUDE_AVAILABLE)(
	`Claude (Agent SDK real, ${CLAUDE_MODEL})`,
	() => {
		let claudeId = "";
		let codexId = "";
		let projectPath = "";

		test("primeiro turno: escreve o arquivo e roda um comando com aprovação", async () => {
			claudeId = await sm.createSession(
				[
					`Use a ferramenta Write para criar o arquivo ${CLAUDE_FILE} na pasta atual com exatamente o texto: ${CLAUDE_TEXT}`,
					`Depois use a ferramenta Bash para rodar: cat ${CLAUDE_FILE}`,
					"Por fim responda em uma frase curta.",
				].join("\n"),
			);
			const meta = await metaOf(claudeId);
			projectPath = meta.projectPath;
			expect(meta.agent ?? "claude").toBe("claude");

			expect(await sm.resumeSession(claudeId)).toBe(true);
			await waitForFinish(claudeId, 1, 240_000);

			const evs = eventsOf(claudeId);
			const toolNames = evs
				.filter(
					(e): e is Extract<AgentEvent, { type: "tool-call" }> =>
						e.type === "tool-call",
				)
				.map((e) => e.toolName);
			expect(toolNames).toContain("Write");
			expect(toolNames).toContain("Bash");
			expect(countOf(claudeId, "tool-result")).toBeGreaterThanOrEqual(2);
			expect(countOf(claudeId, "text-delta")).toBeGreaterThan(0);
			expect(finishes(claudeId)[0].reason).toBe("success");

			const written = await readFile(join(projectPath, CLAUDE_FILE), "utf8");
			expect(written.trim()).toBe(CLAUDE_TEXT);

			const messages = await sm.getSessionMessages(claudeId);
			expect(messages[0].role).toBe("user");
			expect(messages.at(-1)?.role).toBe("assistant");
			const sdkId = (await metaOf(claudeId)).sdkSessionId;
			expect(sdkId).not.toBe(claudeId);
			if (INHERITED_SESSION_ID) expect(sdkId).not.toBe(INHERITED_SESSION_ID);
		}, 300_000);

		test("segundo turno lembra o contexto da conversa", async () => {
			await sm.sendMessage(
				"Qual é o nome do arquivo que você acabou de criar? Responda só o nome.",
			);
			await waitForFinish(claudeId, 2, 180_000);
			expect(finishes(claudeId)[1].reason).toBe("success");
			const lastTurn = eventsOf(claudeId).slice(
				eventsOf(claudeId).indexOf(finishes(claudeId)[0]),
			);
			const text = lastTurn
				.filter(
					(e): e is Extract<AgentEvent, { type: "text-delta" }> =>
						e.type === "text-delta",
				)
				.map((e) => e.delta)
				.join("");
			expect(text).toContain(CLAUDE_FILE);
		}, 200_000);

		test("alterna para o Codex e volta para o Claude (retomada a frio)", async () => {
			codexId = await sm.createSession(`Olá ${TOOL_MARKER}`, {
				agent: "codex",
			});
			expect(await sm.resumeSession(codexId)).toBe(true);
			expect(sm.getActiveSessionId()).toBe(codexId);
			await waitForFinish(codexId, 1, 90_000);
			expect(finishes(codexId)[0].reason).toBe("completed");

			// Cold resume: a fresh query() with `resume: <sdk session id>`.
			expect(await sm.resumeSession(claudeId)).toBe(true);
			expect(sm.getActiveSessionId()).toBe(claudeId);
			const before = eventsOf(claudeId).length;
			await sm.sendMessage(
				"Qual texto você escreveu no arquivo? Responda só o texto.",
			);
			await waitForFinish(claudeId, 3, 180_000);
			expect(finishes(claudeId)[2].reason).toBe("success");
			const text = eventsOf(claudeId)
				.slice(before)
				.filter(
					(e): e is Extract<AgentEvent, { type: "text-delta" }> =>
						e.type === "text-delta",
				)
				.map((e) => e.delta)
				.join("");
			expect(text).toContain(CLAUDE_TEXT);
			expect((await metaOf(claudeId)).model).toBe(CLAUDE_MODEL);
		}, 300_000);

		test("cada plugin vê só as sessões do seu agente", async () => {
			const sessions = await sm.listSessions();
			const byId = new Map(sessions.map((s) => [s.id, s]));
			expect(sm.sessionAgent(byId.get(claudeId) ?? {})).toBe("claude");
			expect(sm.sessionAgent(byId.get(codexId) ?? {})).toBe("codex");
		});

		afterAll(async () => {
			for (const id of [claudeId, codexId]) {
				if (id) await sm.deleteSession(id).catch(() => {});
			}
		});
	},
);
