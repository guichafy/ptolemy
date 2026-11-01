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
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentKind } from "@/shared/agent-protocol";
import { configureLocalAgents, type LocalAgents } from "./helpers/local-agents";
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

let localAgents: LocalAgents | null = null;
if (!LIVE) {
	localAgents = await configureLocalAgents(TMP, REPO);
}

const sm = await import("../../src/bun/claude/session-manager");
const { loadSettings, saveSettings } = await import("../../src/bun/settings");
const { SkillsStore } = await import("../../src/bun/skills/store");
let integrationSkillId = "";
const SKILL_NAME = "ptolemy-integration-review";

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
	const catalog = new SkillsStore({
		download: async () => ({
			name: SKILL_NAME,
			description:
				"Review code when explicitly asked to perform a code review.",
			source: {
				kind: "github",
				url: "https://github.com/ptolemy/test-fixture",
				commit: "a".repeat(40),
			},
			files: [
				{
					path: "SKILL.md",
					content: Buffer.from(
						`---\nname: ${SKILL_NAME}\ndescription: Review code when explicitly asked to perform a code review.\n---\nRead references/guide.md before reviewing code.`,
					).toString("base64"),
					executable: false,
				},
				{
					path: "references/guide.md",
					content: Buffer.from("Report only actionable findings.").toString(
						"base64",
					),
					executable: false,
				},
			],
		}),
	});
	integrationSkillId = (
		await catalog.importGithub("https://github.com/ptolemy/test-fixture")
	).id;
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
	localAgents?.stop();
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
	return {
		agent,
		skillIds: [integrationSkillId],
		model: LIVE
			? agent === "claude"
				? CLAUDE_MODEL
				: CODEX_MODEL
			: agent === "claude"
				? "sonnet"
				: "gpt-6.1-sol",
	};
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
			if (!LIVE) {
				expect(meta.model).toBe(agent === "claude" ? "sonnet" : "gpt-6.1-sol");
				const settings = await loadSettings();
				expect(settings.claude.model).toBe("haiku");
				expect(settings.codex.model).toBe("default");
			}
			expect(meta.skills).toContainEqual(
				expect.objectContaining({ id: integrationSkillId, name: SKILL_NAME }),
			);
			expect(existsSync(state.projectPath)).toBe(true);
			expect(eventsOf(state.id)).toHaveLength(0);
			if (agent === "codex" && !LIVE) {
				// A reversible workspace conflict must not consume the deferred
				// first turn. The next test retries and expects a real response.
				const conflict = join(state.projectPath, ".agents/skills", SKILL_NAME);
				await mkdir(conflict, { recursive: true });
				await expect(sm.resumeSession(state.id)).rejects.toThrow(/existente/);
				await rm(conflict, { recursive: true });
			}
		});

		test(
			"turno 1: cria o arquivo e roda um comando na pasta da conversa",
			async () => {
				expect(await sm.resumeSession(state.id)).toBe(true);
				const turn = await waitTurn(state.id, 0, TURN_TIMEOUT);
				expectCleanTurn(turn, OK_REASON[agent]);
				const skillRoot =
					agent === "claude"
						? ".ptolemy/claude-harness/skills"
						: ".agents/skills";
				expect(
					await readFile(
						join(
							state.projectPath,
							skillRoot,
							SKILL_NAME,
							"references/guide.md",
						),
						"utf8",
					),
				).toBe("Report only actionable findings.");
				if (!LIVE) {
					const requests =
						agent === "claude"
							? localAgents?.anthropicMock.requests
							: localAgents?.responsesMock.requests;
					// The actual CLI must discover the Skill, not merely receive files.
					expect(JSON.stringify(requests)).toContain(SKILL_NAME);
					// The selected session model must reach the first API request.
					if (agent === "claude") {
						expect(
							localAgents?.anthropicMock.requests.some((request) =>
								String(request.model).includes("sonnet"),
							),
						).toBe(true);
					} else {
						expect(
							localAgents?.responsesMock.requests.some(
								(request) => request.body.model === "gpt-6.1-sol",
							),
						).toBe(true);
					}
				}

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
			// The agent revealed the concrete model, and the chat got it as a
			// session-info event before the turn's finish.
			expect(meta.resolvedModel).toBeTruthy();
			const all = eventsOf(state.id);
			const infoIdx = all.findIndex(
				(e) => e.type === "session-info" && e.info.resolvedModel,
			);
			expect(infoIdx).toBeGreaterThan(-1);
			expect(infoIdx).toBeLessThan(all.findIndex((e) => e.type === "finish"));
			console.log(
				`[it] ${agent} session-info: model=${meta.resolvedModel} context=${JSON.stringify(meta.contextUsage ?? null)} stats=${JSON.stringify(meta.stats ?? null)}`,
			);
			const details = await sm.getContextBreakdown(state.id);
			console.log(`[it] ${agent} breakdown: ${JSON.stringify(details)}`);
			expect(details.ok).toBe(true);
			if (details.ok) {
				expect(details.breakdown.usedTokens).toBeGreaterThan(0);
				expect(details.breakdown.categories.length).toBeGreaterThan(0);
			}
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
				if (agent === "claude")
					expect(meta.model).toBe(LIVE ? CLAUDE_MODEL : "sonnet");
				else if (!LIVE) expect(meta.model).toBe("gpt-6.1-sol");
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
