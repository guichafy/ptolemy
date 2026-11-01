import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	CanUseTool,
	PermissionResult,
	Query,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
	AgentKind,
	ContextBreakdown,
	ContextUsageInfo,
	SessionInfoPatch,
	SessionStats,
} from "@/shared/agent-protocol";
import type { ExtensionSelection } from "@/shared/extensions";
import type { McpSnapshot } from "@/shared/mcp";
import type { SessionSkill, SessionSkillSelection } from "@/shared/skills";
import { backupCorruptJson, writeJsonAtomic } from "../atomic-json";
import { readCodexContextBreakdown } from "../codex/rollout-info";
import { CodexSessionRuntime } from "../codex/session-runtime";
import { prepareSessionExtensions } from "../extensions/activation";
import { snapshotExtensionMcp } from "../extensions/mcp";
import {
	denyUnselectedSlash,
	inventoryClaudeBuiltins,
} from "../extensions/native";
import {
	claudeExtensionOptions,
	resolveExtensionPrompt,
} from "../extensions/runtime";
import { extensionsStore } from "../extensions/store";
import { mcpRegistry } from "../mcp/registry";
import {
	disposeSessionMcp,
	localMcpEnv,
	type PreparedSessionMcp,
	prepareSessionMcp,
} from "../mcp/runtime";
import { publicSessionMcp } from "../mcp/session-selection";
import { ptolemyDataDir } from "../paths";
import { loadSettings } from "../settings";
import { assertSkillSelectionSupport } from "../skills/runtime-support";
import { skillsStore } from "../skills/store";
import {
	activateSkills,
	buildCodexSkillConfig,
	snapshotSkills,
} from "../skills/workspace";
import { findClaudeCli } from "./claude-cli";
import { mapClaudeContextUsage } from "./context-breakdown";
import { createMessageInbox, type MessageInbox } from "./message-inbox";
import { PermissionGate } from "./permission-gate";
import { type Project, ProjectStore } from "./persistence/project-store";
import { ToolDecisionStore } from "./persistence/tool-decisions";
import { buildQueryOptions } from "./session-options";
import type {
	MessagePersister,
	PersistBlock,
	ResultMeta,
	StreamMessageSender,
} from "./streaming";
import { startStreamingLoop } from "./streaming";
import { checkToolInput } from "./workspace-jail";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const VERBOSE = process.env.CLAUDE_LOG_VERBOSE === "1";
const verbose = (...args: unknown[]) => {
	if (VERBOSE) console.log(...args);
};

function previewText(text: string, max = 60): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}...`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMeta {
	extensionSelections?: ExtensionSelection[];
	builtinCommands?: { all: string[]; selected: string[] };
	/** Safe logical selection for listings; no credential references. */
	mcpServerIds?: string[];
	id: string;
	/**
	 * Agent-side conversation id: the Claude SDK session id, or the Codex
	 * thread id. Codex sessions start with "" until the first turn reveals it.
	 */
	sdkSessionId: string;
	/** Which agent backs this session. Absent on pre-Codex sessions = claude. */
	agent?: AgentKind;
	/** Immutable file Skill snapshots selected before the first turn. */
	skills?: SessionSkill[];
	/** Undefined retains legacy native discovery; explicit selection is frozen at creation. */
	skillSelection?: SessionSkillSelection;
	title: string;
	/** Project this conversation belongs to. Many sessions can share one project. */
	projectId: string;
	/** Snapshot of the project path — agent's cwd for this session. */
	projectPath: string;
	model: string;
	/** Claude auth mode at creation time. Absent on Codex sessions. */
	authMode?: "anthropic" | "bedrock";
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	lastMessage: string;
	/** Concrete model behind `model` (e.g. the alias `default`), once known. */
	resolvedModel?: string;
	/** Context window usage after the last turn. */
	contextUsage?: ContextUsageInfo;
	/** Conversation totals (cost, compactions). */
	stats?: SessionStats;
}

/**
 * Version 2 introduces per-conversation project isolation: every session now
 * references a Project (projectId + projectPath). On read, an index whose
 * version is anything other than 2 is discarded — the sessions tree predates
 * the project model and is not worth migrating.
 */
interface StoredSessionMeta extends SessionMeta {
	/** Undefined is a pre-selection legacy session; [] is an explicit frozen none. */
	mcpSelection?: McpSnapshot;
}

export interface SessionIndex {
	version: 2;
	sessions: StoredSessionMeta[];
}

/** Legacy format (v1): plain text content. */
export interface StoredMessageV1 {
	role: "user" | "assistant";
	content: string;
	timestamp: string;
}

/** Block type for V2 persistence (mirrors PersistBlock from streaming). */
export type StoredBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string; durationMs?: number }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: unknown;
			status: "running" | "done" | "error";
			elapsedSeconds?: number;
	  }
	| {
			type: "tool_result";
			toolUseId: string;
			content: string;
			isError?: boolean;
	  };

/** Current format (v2): structured content blocks. */
export interface StoredMessageV2 {
	version: 2;
	role: "user" | "assistant";
	blocks: StoredBlock[];
	timestamp: string;
	cost?: number;
	durationMs?: number;
	tokenUsage?: { input: number; output: number };
	/** Set when this user message was sent with a per-turn model override. */
	modelUsed?: string;
	/** Assistant messages: concrete model that produced the reply. */
	model?: string;
}

export type StoredMessage = StoredMessageV1 | StoredMessageV2;

/** Type guard for V2 messages. */
function isV2(msg: StoredMessage): msg is StoredMessageV2 {
	return "version" in msg && (msg as StoredMessageV2).version === 2;
}

/** Promote a v1 message to v2 by wrapping content in a text block. */
function migrateStoredMessage(msg: StoredMessage): StoredMessageV2 {
	if (isV2(msg)) return msg;
	return {
		version: 2,
		role: msg.role,
		blocks: [{ type: "text", text: msg.content }],
		timestamp: msg.timestamp,
	};
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SESSIONS_DIR = join(ptolemyDataDir(), "sessions");
const INDEX_PATH = join(SESSIONS_DIR, "index.json");

const projectStore = new ProjectStore();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ActiveQuery {
	mcp: PreparedSessionMcp;
	query: Query;
	inbox: MessageInbox;
	streamingLoop: Promise<void> | null;
	/**
	 * Callbacks fired when the streaming loop reports the next `result`
	 * SDKMessage. Used by `sendMessage` to restore the model after a per-turn
	 * override completes. FIFO; each turn shifts one off.
	 */
	turnCompletionQueue: Array<() => Promise<void>>;
}

let active: { sessionId: string; q: ActiveQuery } | null = null;

let pendingNew: {
	id: string;
	prompt: string;
	inbox: MessageInbox;
	authMode: SessionMeta["authMode"];
	options: ReturnType<typeof buildQueryOptions>;
} | null = null;

/** Live Codex conversation. Mutually exclusive with `active` (Claude). */
let activeCodex: CodexSessionRuntime | null = null;

/** Codex counterpart of `pendingNew`: first turn deferred until resume. */
let pendingCodex: { id: string; prompt: string; cwd: string } | null = null;

export function sessionAgent(meta: Pick<SessionMeta, "agent">): AgentKind {
	return meta.agent ?? "claude";
}

function buildUserMessage(text: string): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content: text },
		parent_tool_use_id: null,
	} as SDKUserMessage;
}

/**
 * Injected by the RPC layer (Etapa 5) before any session is created.
 * Falls back to no-op implementations so the module works stand-alone.
 */
let sender: StreamMessageSender = {
	sendEvent: () => {},
};

/**
 * Configure the sender used to push stream events to the renderer.
 */
export function setSender(s: StreamMessageSender): void {
	sender = s;
}

// ---------------------------------------------------------------------------
// HITL permission gate (phase 4)
// ---------------------------------------------------------------------------

const toolDecisionStore = new ToolDecisionStore();

const permissionGate = new PermissionGate({
	onDecision: (record) => {
		toolDecisionStore.append(record.sessionId, record).catch((err) => {
			console.error("[claude:permission] audit write failed:", err);
		});
	},
});

/**
 * Expose the shared permission gate so the RPC layer can forward
 * approve/reject commands from the renderer. The gate is a singleton —
 * there is only one active Claude session at a time.
 */
export function getPermissionGate(): PermissionGate {
	return permissionGate;
}

/**
 * Build the canUseTool callback that the Agent SDK invokes before executing
 * a tool. Runs the workspace jail first — any Write/Edit/Bash targeting a
 * path outside `workspace` short-circuits to a hard deny, never reaching
 * the user's permission prompt. Remaining calls go through the usual HITL
 * gate, resolved from the renderer via agentApproveTool/agentRejectTool.
 */
function buildCanUseTool(sessionId: string, workspace: string): CanUseTool {
	return async (toolName, input, options): Promise<PermissionResult> => {
		const jailed = checkToolInput(workspace, toolName, input);
		if (!jailed.allowed) {
			console.warn(`[claude:jail] tool=${toolName} blocked: ${jailed.reason}`);
			return { behavior: "deny", message: jailed.reason };
		}

		const { permissionId, request, promise } = permissionGate.request({
			sessionId,
			toolCallId: options.toolUseID,
			toolName,
			args: input as Record<string, unknown>,
			decisionReason: options.decisionReason,
			blockedPath: options.blockedPath,
		});

		sender.sendEvent?.(sessionId, {
			type: "tool-permission-request",
			permissionId,
			toolCallId: options.toolUseID,
			toolName,
			args: input,
			decisionReason: request.risk.reason ?? options.decisionReason,
			blockedPath: options.blockedPath,
		});

		const decision = await promise;
		if (decision.behavior === "allow") {
			return decision.updatedInput
				? { behavior: "allow", updatedInput: decision.updatedInput }
				: { behavior: "allow", updatedInput: input };
		}
		return { behavior: "deny", message: decision.message };
	};
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function ensureSessionsDir(): Promise<void> {
	await mkdir(SESSIONS_DIR, { recursive: true });
}

let indexWriteQueue: Promise<void> = Promise.resolve();
const messageWriteQueues = new Map<string, Promise<void>>();

async function readIndexRaw(): Promise<SessionIndex> {
	if (!existsSync(INDEX_PATH)) {
		return { version: 2, sessions: [] };
	}
	try {
		const parsed = JSON.parse(await readFile(INDEX_PATH, "utf8"));
		if (
			parsed &&
			typeof parsed === "object" &&
			parsed.version === 2 &&
			Array.isArray(parsed.sessions)
		) {
			return parsed as SessionIndex;
		}
		// Legacy (v1 or malformed) — start fresh. Old session folders remain on
		// disk but are not listed; users can `rm -rf ~/.ptolomeu/sessions`
		// manually if they care about reclaiming the space.
		await backupCorruptJson(INDEX_PATH);
		return { version: 2, sessions: [] };
	} catch {
		await backupCorruptJson(INDEX_PATH);
		return { version: 2, sessions: [] };
	}
}

async function readIndex(): Promise<SessionIndex> {
	await indexWriteQueue;
	return readIndexRaw();
}

async function writeIndexRaw(index: SessionIndex): Promise<void> {
	await ensureSessionsDir();
	await writeJsonAtomic(INDEX_PATH, index);
}

async function mutateIndex<T>(
	apply: (index: SessionIndex) => T | Promise<T>,
): Promise<T> {
	const next = indexWriteQueue.then(async () => {
		const index = await readIndexRaw();
		const result = await apply(index);
		await writeIndexRaw(index);
		return result;
	});
	indexWriteQueue = next.then(
		() => {},
		() => {},
	);
	return next;
}

function sessionDir(sessionId: string): string {
	return join(SESSIONS_DIR, sessionId);
}

/**
 * Returns the project directory for a session. Prefers the live project
 * entry (handles renames/moves later) and falls back to the denormalized
 * snapshot stored on the SessionMeta itself.
 */
async function resolveProjectPath(meta: SessionMeta): Promise<string> {
	const project = await projectStore.get(meta.projectId);
	return project?.path ?? meta.projectPath;
}

function messagesPath(sessionId: string): string {
	return join(sessionDir(sessionId), "messages.json");
}

async function readMessagesRaw(sessionId: string): Promise<StoredMessageV2[]> {
	const path = messagesPath(sessionId);
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (!Array.isArray(parsed)) {
			await backupCorruptJson(path);
			return [];
		}
		return parsed.map((msg: StoredMessage) => migrateStoredMessage(msg));
	} catch {
		await backupCorruptJson(path);
		return [];
	}
}

async function readMessages(sessionId: string): Promise<StoredMessageV2[]> {
	await (messageWriteQueues.get(sessionId) ?? Promise.resolve());
	return readMessagesRaw(sessionId);
}

async function writeMessages(
	sessionId: string,
	messages: StoredMessageV2[],
): Promise<void> {
	const dir = sessionDir(sessionId);
	await mkdir(dir, { recursive: true });
	await writeJsonAtomic(messagesPath(sessionId), messages);
}

async function appendStoredMessageV2(
	sessionId: string,
	msg: StoredMessageV2,
): Promise<void> {
	const next = (messageWriteQueues.get(sessionId) ?? Promise.resolve()).then(
		async () => {
			const messages = await readMessagesRaw(sessionId);
			messages.push(msg);
			await writeMessages(sessionId, messages);

			await mutateIndex((index) => {
				const meta = index.sessions.find((s) => s.id === sessionId);
				if (!meta) return;
				meta.messageCount = messages.length;
				meta.updatedAt = new Date().toISOString();
				if (msg.role === "user") {
					const preview = msg.blocks
						.filter(
							(b): b is { type: "text"; text: string } => b.type === "text",
						)
						.map((b) => b.text)
						.join("")
						.slice(0, 100);
					meta.lastMessage = preview;
				}
			});
		},
	);
	messageWriteQueues.set(
		sessionId,
		next.catch(() => {}),
	);
	return next;
}

/**
 * Generates a short title from the first user prompt (~50 chars).
 */
function generateTitle(prompt: string): string {
	const cleaned = prompt.replace(/\s+/g, " ").trim();
	if (cleaned.length <= 50) return cleaned;
	return `${cleaned.slice(0, 47)}...`;
}

// ---------------------------------------------------------------------------
// MessagePersister (wired into the streaming loop)
// ---------------------------------------------------------------------------

const persister: MessagePersister = {
	appendMessage: async (
		sessionId: string,
		role: "assistant",
		blocks: PersistBlock[],
		meta?: ResultMeta,
	) => {
		const msg: StoredMessageV2 = {
			version: 2,
			role,
			blocks: blocks as StoredBlock[],
			timestamp: new Date().toISOString(),
			...(meta?.totalCostUsd != null && { cost: meta.totalCostUsd }),
			...(meta?.durationMs != null && { durationMs: meta.durationMs }),
			...(meta?.usage && { tokenUsage: meta.usage }),
			...(meta?.model && { model: meta.model }),
		};
		await appendStoredMessageV2(sessionId, msg);
	},
};

/**
 * Persist what the agent revealed about the session (resolved model, context
 * usage) on its index entry, so a reopened chat shows it before the next
 * turn. Best-effort: a failed write only costs the cached snapshot.
 */
async function recordSessionInfo(
	sessionId: string,
	patch: SessionInfoPatch,
): Promise<void> {
	try {
		await mutateIndex((idx) => {
			const m = idx.sessions.find((s) => s.id === sessionId);
			if (!m) return;
			if (patch.resolvedModel) m.resolvedModel = patch.resolvedModel;
			if (patch.contextUsage) m.contextUsage = patch.contextUsage;
			if (patch.stats) m.stats = patch.stats;
		});
	} catch (err) {
		console.error("[claude:session] recordSessionInfo failed:", err);
	}
}

/**
 * Persist the SDK-issued session id captured from the first SDKMessage. Called
 * at most once per streaming loop (the streaming loop's own `sdkSessionIdRecorded`
 * latch enforces single-fire). Concurrent invocations would create a TOCTOU
 * between `readIndex` and `writeIndex`; the latch is the only thing preventing
 * that race today, so don't add new callers without revisiting.
 *
 * Called by the streaming loop's `onSdkSessionId` hook when the SDK reveals
 * its own session id on the first message. Updates the index only when the
 * value actually changes (the placeholder UUID is replaced exactly once).
 */
async function recordSdkSessionId(
	internalId: string,
	sdkSessionId: string,
): Promise<void> {
	if (!sdkSessionId) return;
	try {
		await mutateIndex((idx) => {
			const m = idx.sessions.find((s) => s.id === internalId);
			if (m && m.sdkSessionId !== sdkSessionId) {
				verbose(
					`[claude:session] recordSdkSessionId: id=${internalId} old=${m.sdkSessionId} new=${sdkSessionId}`,
				);
				m.sdkSessionId = sdkSessionId;
			}
		});
	} catch (err) {
		console.error("[claude:session] recordSdkSessionId failed:", err);
	}
}

// ---------------------------------------------------------------------------
// Models cache helpers (lazy — module lands in Task 6)
// ---------------------------------------------------------------------------

type ModelsCacheModule = {
	peekModels: (
		authMode: SessionMeta["authMode"],
	) => import("@anthropic-ai/claude-agent-sdk").ModelInfo[] | null;
	putModelsFromInit: (
		models: import("@anthropic-ai/claude-agent-sdk").ModelInfo[],
		authMode: SessionMeta["authMode"],
	) => void;
};

// Indirect specifier so TypeScript doesn't statically resolve the module
// before Task 6 lands. The `import()` call still works at runtime once the
// real `models-cache.ts` exists; until then it throws and the catch handles it.
const MODELS_CACHE_SPECIFIER = "./models-cache";

async function loadModelsCache(): Promise<ModelsCacheModule | null> {
	try {
		const mod = (await import(MODELS_CACHE_SPECIFIER)) as ModelsCacheModule;
		return mod;
	} catch {
		return null;
	}
}

async function tryGetCachedModels(
	authMode: SessionMeta["authMode"],
): Promise<import("@anthropic-ai/claude-agent-sdk").ModelInfo[] | null> {
	const mod = await loadModelsCache();
	if (!mod) return null;
	try {
		return mod.peekModels(authMode);
	} catch {
		return null;
	}
}

function notifySessionModelChanged(sessionId: string, model: string): void {
	sender.sendEvent?.(sessionId, {
		type: "session-model-changed",
		sessionId,
		model,
	});
}

async function primeModelsCacheFromQuery(
	q: Query,
	authMode: SessionMeta["authMode"],
): Promise<void> {
	try {
		const mod = await loadModelsCache();
		if (!mod) return;
		const init = await q.initializationResult();
		mod.putModelsFromInit(init.models, authMode);
	} catch (err) {
		// init result not yet available or other transient failure; ignore.
		verbose(`[claude:session] primeModelsCacheFromQuery skipped: ${err}`);
	}
}

function clearSessionPermissionState(sessionId: string, reason: string): void {
	const cancelled = permissionGate.cancelAll(reason, sessionId);
	permissionGate.clearWhitelist(sessionId);
	if (cancelled > 0) {
		console.log(
			`[claude:permission] cleared ${cancelled} pending requests for sessionId=${sessionId}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Streaming-loop launcher
// ---------------------------------------------------------------------------

function startLoopForActive(sessionId: string): boolean {
	if (!active || active.sessionId !== sessionId) return false;
	const q = active.q.query;
	active.q.streamingLoop = startStreamingLoop(
		q as AsyncIterable<SDKMessage>,
		sessionId,
		sender,
		persister,
		{
			onTurnComplete: () => {
				if (!active || active.sessionId !== sessionId) return;
				const cb = active.q.turnCompletionQueue.shift();
				if (cb) {
					cb().catch((err) => {
						console.error(
							"[claude:session] turn completion callback failed:",
							err,
						);
					});
				}
			},
			onSdkSessionId: (sdkSessionId) => {
				void recordSdkSessionId(sessionId, sdkSessionId);
			},
			onSessionInfo: (patch) => {
				void recordSessionInfo(sessionId, patch);
			},
			loadStats: async () =>
				(await readIndex()).sessions.find((s) => s.id === sessionId)?.stats,
		},
	).finally(() => {
		if (active && active.sessionId === sessionId) {
			active.q.streamingLoop = null;
		}
	});
	return true;
}

// ---------------------------------------------------------------------------
// Agent switching (only one live agent session at a time)
// ---------------------------------------------------------------------------

async function deactivateClaude(reason: string): Promise<void> {
	if (!active) return;
	const prev = active;
	console.log(
		`[claude:session] tearing down active Claude session ${prev.sessionId} (${reason})`,
	);
	clearSessionPermissionState(prev.sessionId, reason);
	try {
		prev.q.inbox.close();
		prev.q.query.close();
	} catch {
		// best-effort cleanup
	}
	if (prev.q.streamingLoop) {
		await prev.q.streamingLoop.catch(() => {});
	}
	await prev.q.mcp.dispose();
	if (active === prev) active = null;
}

async function deactivateCodex(reason: string): Promise<void> {
	if (!activeCodex) return;
	const prev = activeCodex;
	activeCodex = null;
	console.log(
		`[codex:session] tearing down active Codex session ${prev.sessionId} (${reason})`,
	);
	await prev.close();
}

function discardPendingClaude(reason: string): void {
	if (!pendingNew) return;
	console.warn(
		`[claude:session] discarding unrealized pendingNew id=${pendingNew.id} (${reason})`,
	);
	try {
		pendingNew.inbox.close();
	} catch {
		// best-effort
	}
	pendingNew = null;
}

async function prepareStoredSessionMcp(
	sessionId: string,
	cwd: string,
	agent: AgentKind,
): Promise<PreparedSessionMcp> {
	const meta = (await readIndex()).sessions.find((s) => s.id === sessionId);
	if (!meta) throw Error("Sessão não encontrada.");
	const snapshot =
		meta.mcpSelection ??
		(agent === "claude"
			? await mcpRegistry.legacySnapshot()
			: { version: 1 as const, servers: [] });
	const context = await prepareSessionMcp(sessionId, cwd, snapshot, agent);
	context.explicit = meta.mcpSelection !== undefined;
	return context;
}

/** App shutdown owns both CLI runtimes, all gateways and pending prompt streams. */
export async function shutdownSessions(): Promise<void> {
	discardPendingClaude("application shutdown");
	pendingCodex = null;
	await deactivateClaude("application shutdown");
	await deactivateCodex("application shutdown");
	await disposeSessionMcp();
}

async function createCodexRuntime(
	sessionId: string,
	cwd: string,
	threadId: string | null,
): Promise<CodexSessionRuntime> {
	const mcp = await prepareStoredSessionMcp(sessionId, cwd, "codex");
	return new CodexSessionRuntime({
		mcp,
		sessionId,
		cwd,
		threadId,
		// Late-bound: `sender` is swapped by setSender after module load.
		sender: { sendEvent: (sid, event) => sender.sendEvent?.(sid, event) },
		persister,
		loadConfig: async () => {
			const [settings, index] = await Promise.all([
				loadSettings(),
				readIndex(),
			]);
			const meta = index.sessions.find((s) => s.id === sessionId);
			return {
				model: meta?.model ?? settings.codex.model,
				sandboxMode: settings.codex.sandboxMode,
				reasoningEffort: settings.codex.reasoningEffort,
			};
		},
		loadSkillConfig: async () => {
			const meta = (await readIndex()).sessions.find((s) => s.id === sessionId);
			return buildCodexSkillConfig(
				meta?.skillSelection,
				await skillsStore.nativePaths("codex", cwd),
				meta?.skillSelection
					? (meta.skills ?? []).map((skill) =>
							join(cwd, ".agents", "skills", skill.name, "SKILL.md"),
						)
					: [],
			);
		},
		loadExtensions: async () => {
			const meta = (await readIndex()).sessions.find((s) => s.id === sessionId);
			return prepareSessionExtensions(
				sessionId,
				cwd,
				meta?.extensionSelections,
				"codex",
			);
		},
		onSessionInfo: (patch) => {
			void recordSessionInfo(sessionId, patch);
		},
		onThreadId: (threadId) => {
			void recordSdkSessionId(sessionId, threadId);
		},
	});
}

async function createCodexSession(
	id: string,
	prompt: string,
	project: Project,
	skills: SessionSkill[],
	skillSelection: SessionSkillSelection,
	mcpSelection: McpSnapshot,
	extensionSelections: ExtensionSelection[],
	model?: string,
): Promise<string> {
	const settings = await loadSettings();
	const now = new Date().toISOString();
	const meta: StoredSessionMeta = {
		id,
		sdkSessionId: "", // filled in when Codex reports thread.started
		agent: "codex",
		skills,
		skillSelection,
		mcpSelection,
		extensionSelections,
		title: generateTitle(prompt),
		projectId: project.id,
		projectPath: project.path,
		model: model ?? settings.codex.model,
		createdAt: now,
		updatedAt: now,
		messageCount: 1,
		lastMessage: prompt.slice(0, 100),
	};
	await mutateIndex((index) => {
		index.sessions.push(meta);
	});
	await appendStoredMessageV2(id, {
		version: 2,
		role: "user",
		blocks: [{ type: "text", text: prompt }],
		timestamp: now,
	});

	discardPendingClaude("new Codex session created");
	// Same deferred start as Claude: the first turn runs on the chat window's
	// resumeSession, once its transport is wired.
	pendingCodex = { id, prompt, cwd: project.path };
	console.log(
		`[codex:session] createSession done: id=${id} model=${meta.model}; first turn deferred until resumeSession`,
	);
	return id;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns metadata for all stored sessions, sorted by most recent first.
 */
export async function listSessions(): Promise<SessionMeta[]> {
	const index = await readIndex();
	return index.sessions
		.map(publicSessionMcp)
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
}

/**
 * Creates a new Claude session, sends the initial prompt, and starts the
 * streaming loop. Returns our internal session UUID.
 *
 * Each conversation is isolated inside its own project directory. Callers
 * can pass an existing `projectId` to group multiple conversations under the
 * same project (shared files/memory across sessions); otherwise a fresh
 * project is auto-provisioned from the prompt title.
 */
export async function createSession(
	prompt: string,
	opts: {
		projectId?: string;
		agent?: AgentKind;
		skillIds?: string[];
		mcpServerIds?: string[];
		extensionSelections?: ExtensionSelection[];
		builtinCommandNames?: string[];
		model?: string;
	} = {},
): Promise<string> {
	const t0 = Date.now();
	const id = crypto.randomUUID();
	if (opts.agent && opts.agent !== "claude" && opts.agent !== "codex")
		throw new Error("Agente inválido.");
	if (
		opts.model !== undefined &&
		(typeof opts.model !== "string" ||
			!opts.model.trim() ||
			opts.model.length > 256)
	)
		throw new Error("Modelo inválido.");
	const mcpSelection = await mcpRegistry.snapshot(
		opts.mcpServerIds ??
			(await mcpRegistry.list())
				.filter((server) => server.defaults[opts.agent ?? "claude"])
				.map((server) => server.id),
	);
	const skillIds =
		opts.skillIds ?? (await skillsStore.defaults(opts.agent ?? "claude"));
	// Resolve before provisioning a project or mutating the session index.
	const selectedSkills = await skillsStore.resolveForSession(
		opts.agent ?? "claude",
		skillIds,
	);

	const skillSelection = {
		nativePaths: await skillsStore.nativePaths(opts.agent ?? "claude"),
	};
	const extensionDefaults = await extensionsStore.defaults(
		opts.agent ?? "claude",
	);
	const extensionSelections = structuredClone(
		opts.extensionSelections ?? extensionDefaults?.selections ?? [],
	);
	const builtins =
		opts.agent !== "codex"
			? await inventoryClaudeBuiltins(await findClaudeCli())
			: [];
	const builtinCommands = {
		all: builtins.map((b) => b.name),
		selected:
			opts.builtinCommandNames ??
			(opts.skillIds === undefined
				? (extensionDefaults?.builtinCommandNames ??
					builtins.map((b) => b.name))
				: []),
	};
	if (
		!Array.isArray(builtinCommands.selected) ||
		builtinCommands.selected.some((name) => !builtinCommands.all.includes(name))
	)
		throw Error("Seleção de comandos internos inválida.");
	denyUnselectedSlash(prompt, builtinCommands.all, builtinCommands.selected);

	const extensions = await prepareSessionExtensions(
		id,
		join(ptolemyDataDir(), "projects", "preview"),
		extensionSelections,
		opts.agent ?? "claude",
		{ materialize: false },
	);
	const duplicate = extensions.skills.find((s) =>
		selectedSkills.some((existing) => existing.name === s.name),
	);
	if (duplicate)
		throw Error(`Skills com mesmo nome na seleção: ${duplicate.name}.`);

	// Resolve (or create) the project this conversation belongs to. The
	// project directory becomes the agent's cwd — every Write/Edit/Bash is
	// scoped to it, guaranteeing isolation between conversations.
	let project: Project;
	if (opts.projectId) {
		const existing = await projectStore.get(opts.projectId);
		if (!existing) {
			throw new Error(`Project not found: ${opts.projectId}`);
		}
		project = existing;
	} else {
		project = await projectStore.create({ title: generateTitle(prompt) });
	}
	const materialized = await prepareSessionExtensions(
		id,
		project.path,
		extensionSelections,
		opts.agent ?? "claude",
		{ materialize: false },
	);
	const pluginMcp = await snapshotExtensionMcp(materialized);
	for (const server of pluginMcp.servers)
		if (!mcpSelection.servers.some((s) => s.id === server.id))
			mcpSelection.servers.push(server);

	console.log(
		`[claude:session] createSession start: id=${id} agent=${opts.agent ?? "claude"} projectId=${project.id} path=${project.path} promptLength=${prompt.length}`,
	);

	if (opts.agent === "codex") {
		const skills = await snapshotSkills(SESSIONS_DIR, id, selectedSkills);
		return createCodexSession(
			id,
			prompt,
			project,
			skills,
			skillSelection,
			mcpSelection,
			extensionSelections,
			opts.model,
		);
	}
	verbose(
		`[claude:session] createSession prompt preview: id=${id} prompt="${previewText(prompt)}"`,
	);

	const settings = await loadSettings();
	const { permissionMode, authMode } = settings.claude;
	const model = opts.model ?? settings.claude.model;
	verbose(
		`[claude:session] createSession settings: model=${model} permissionMode=${permissionMode} authMode=${authMode}`,
	);

	const claudePath = await findClaudeCli();
	await assertSkillSelectionSupport("claude", claudePath);
	const mcpServers = {};
	const skills = await snapshotSkills(SESSIONS_DIR, id, selectedSkills);

	// Build the inbox and the first user message; do NOT start query() yet.
	// Deferred-start (existing invariant): the chat window must be mounted
	// before the streaming loop emits its first chunk, otherwise
	// chatRpc.send.* drops.
	const inbox = createMessageInbox();

	const now = new Date().toISOString();
	const meta: StoredSessionMeta = {
		id,
		sdkSessionId: id, // placeholder; gets corrected by sdk-session-id capture in the streaming loop
		skills,
		skillSelection,
		mcpSelection,
		extensionSelections,
		builtinCommands,
		title: generateTitle(prompt),
		projectId: project.id,
		projectPath: project.path,
		model,
		authMode,
		createdAt: now,
		updatedAt: now,
		messageCount: 1,
		lastMessage: prompt.slice(0, 100),
	};

	await mutateIndex((index) => {
		index.sessions.push(meta);
	});

	await appendStoredMessageV2(id, {
		version: 2,
		role: "user",
		blocks: [{ type: "text", text: prompt }],
		timestamp: now,
	});
	verbose(
		`[claude:session] metadata persisted: id=${id} title="${meta.title}"`,
	);

	if (pendingNew) {
		console.warn(
			`[claude:session] createSession: replacing unrealized pendingNew id=${pendingNew.id} (chat never opened?)`,
		);
		try {
			pendingNew.inbox.close();
		} catch {
			// best-effort cleanup
		}
	}
	pendingCodex = null;
	pendingNew = {
		id,
		prompt,
		inbox,
		authMode,
		options: buildQueryOptions({
			explicitSkillSelection: true,
			explicitMcpSelection: true,
			model,
			permissionMode,
			claudePath,
			canUseTool: buildCanUseTool(id, project.path),
			mcpServers,
			cwd: project.path,
		}),
	};

	console.log(
		`[claude:session] createSession done: id=${id} (${Date.now() - t0}ms) — query() deferred until resumeSession`,
	);
	return id;
}

/**
 * Resumes a previously created session by loading its metadata and
 * re-attaching to the SDK session.
 *
 * Doubles as the deferred-start entrypoint for freshly created sessions:
 * `createSession` leaves the prompt + options primed but does not call
 * `query()`, because early events would race the chat window's RPC transport
 * and vanish. The first `resumeSession` from the newly opened window
 * triggers `query()` + `startStreamingLoop` — by then the renderer is
 * subscribed.
 */
export async function resumeSession(sessionId: string): Promise<boolean> {
	console.log(`[claude:session] resumeSession start: id=${sessionId}`);

	// Codex: already live (deferred start fired, or resumed earlier).
	if (activeCodex && activeCodex.sessionId === sessionId) {
		return true;
	}

	// Codex: deferred new session, run its first turn now.
	if (pendingCodex && pendingCodex.id === sessionId) {
		const pending = pendingCodex;
		await deactivateClaude("switching to Codex session");
		await deactivateCodex("session changed");
		await activateSkills(SESSIONS_DIR, sessionId, pending.cwd, "codex");
		const runtime = await createCodexRuntime(pending.id, pending.cwd, null);
		// Activation can fail on a workspace conflict. Retain the deferred
		// prompt until preparation succeeds so reopening the chat can retry.
		if (pendingCodex === pending) pendingCodex = null;
		activeCodex = runtime;
		void runtime.enqueue(pending.prompt);
		return true;
	}
	if (pendingCodex && pendingCodex.id !== sessionId) {
		console.warn(
			`[codex:session] resumeSession: discarding stale pendingCodex id=${pendingCodex.id}`,
		);
		pendingCodex = null;
	}

	// Case 1: same session already active (deferred-start has already fired)
	if (active && active.sessionId === sessionId) {
		if (active.q.streamingLoop) {
			console.log(
				`[claude:session] resumeSession: id=${sessionId} stream already running`,
			);
			return true;
		}
		// Stream finished but query is still alive — start a fresh one.
		// Practically rare with the long-lived stable Query; defensive guard only.
		return startLoopForActive(sessionId);
	}

	// Case 2: deferred new session — first resume from chat window after createSession
	if (pendingNew && pendingNew.id === sessionId) {
		await deactivateCodex("switching to Claude session");
		await deactivateClaude("switching to a new Claude session");
		if (!pendingNew || pendingNew.id !== sessionId) return false;
		await activateSkills(
			SESSIONS_DIR,
			sessionId,
			pendingNew.options.cwd as string,
			"claude",
		);
		const mcp = await prepareStoredSessionMcp(
			sessionId,
			pendingNew.options.cwd as string,
			"claude",
		);
		pendingNew.options.mcpServers = mcp.servers;
		pendingNew.options.strictMcpConfig = mcp.explicit;
		pendingNew.options.env = localMcpEnv({ ...process.env, ...mcp.env });
		const meta = (await readIndex()).sessions.find((s) => s.id === sessionId)!;
		const extensions = await prepareSessionExtensions(
			sessionId,
			pendingNew.options.cwd as string,
			meta.extensionSelections,
			"claude",
		);
		const extensionOptions = await claudeExtensionOptions(
			extensions,
			meta.builtinCommands
				? { ...meta.builtinCommands, hasFileSkills: !!meta.skills?.length }
				: undefined,
		);
		const basePlugins = pendingNew.options.plugins ?? [];
		Object.assign(pendingNew.options, extensionOptions, {
			plugins: [...basePlugins, ...(extensionOptions.plugins ?? [])],
		});
		pendingNew.inbox.push(
			buildUserMessage(
				await resolveExtensionPrompt(
					extensions,
					pendingNew.prompt,
					pendingNew.options.cwd as string,
				),
			),
		);
		const pendingAuthMode = pendingNew.authMode;
		let q: Query;
		try {
			q = query({
				prompt: pendingNew.inbox.iterable,
				options: pendingNew.options,
			});
		} catch {
			await mcp.dispose();
			throw Error("Não foi possível iniciar a sessão Claude.");
		}
		active = {
			sessionId,
			q: {
				mcp,
				query: q,
				inbox: pendingNew.inbox,
				streamingLoop: null,
				turnCompletionQueue: [],
			},
		};
		permissionGate.clearWhitelist(sessionId);
		pendingNew = null;
		void primeModelsCacheFromQuery(q, pendingAuthMode);
		return startLoopForActive(sessionId);
	}

	// Case 3: cold resume of a previously persisted session
	// Discard a stale pendingNew if it belongs to a different session — it
	// will never be consumed and would silently leak its inbox + options.
	if (pendingNew && pendingNew.id !== sessionId) {
		console.warn(
			`[claude:session] resumeSession: discarding stale pendingNew id=${pendingNew.id} during cold resume of ${sessionId}`,
		);
		try {
			pendingNew.inbox.close();
		} catch {
			// best-effort
		}
		pendingNew = null;
	}

	const index = await readIndex();
	const meta = index.sessions.find((s) => s.id === sessionId);
	if (!meta) {
		console.error(
			`[claude:session] resumeSession: metadata not found for id=${sessionId}`,
		);
		return false;
	}

	if (sessionAgent(meta) === "codex") {
		try {
			await deactivateClaude("switching to Codex session");
			await deactivateCodex("session changed");
			const cwd = await resolveProjectPath(meta);
			await activateSkills(SESSIONS_DIR, sessionId, cwd, "codex");
			activeCodex = await createCodexRuntime(
				sessionId,
				cwd,
				meta.sdkSessionId || null,
			);
			console.log(
				`[codex:session] resumeSession ready: id=${sessionId} threadId=${meta.sdkSessionId || "(new)"} model=${meta.model}`,
			);
			return true;
		} catch (err) {
			console.error("[codex:session] resumeSession failed:", err);
			return false;
		}
	}

	const settings = await loadSettings();
	const { permissionMode } = settings.claude;
	const authMode = meta.authMode ?? "anthropic";
	let model = meta.model;
	let preparedMcp: PreparedSessionMcp | undefined;

	try {
		await deactivateCodex("switching to Claude session");
		if (active && active.sessionId !== sessionId) {
			const previousSessionId = active.sessionId;
			console.log(
				`[claude:session] resumeSession: tearing down prior active session ${previousSessionId} before cold resume of ${sessionId}`,
			);
			clearSessionPermissionState(previousSessionId, "session changed");
			try {
				active.q.inbox.close();
				active.q.query.close();
			} catch {
				// best-effort cleanup
			}
			if (active.q.streamingLoop) {
				await active.q.streamingLoop.catch(() => {});
			}
			await active.q.mcp.dispose();
			active = null;
		}

		const claudePath = await findClaudeCli();
		if (meta.skillSelection !== undefined)
			await assertSkillSelectionSupport("claude", claudePath);
		const cwd = await resolveProjectPath(meta);
		const mcp = await prepareStoredSessionMcp(sessionId, cwd, "claude");
		preparedMcp = mcp;
		await activateSkills(SESSIONS_DIR, sessionId, cwd, "claude");
		const extensions = await prepareSessionExtensions(
			sessionId,
			cwd,
			meta.extensionSelections,
			"claude",
		);
		const extensionOptions = await claudeExtensionOptions(
			extensions,
			meta.builtinCommands
				? { ...meta.builtinCommands, hasFileSkills: !!meta.skills?.length }
				: undefined,
		);

		// Downgrade silently when meta.model has been retired.
		const cached = await tryGetCachedModels(authMode);
		if (cached && cached.length > 0 && !cached.some((m) => m.value === model)) {
			console.warn(
				`[claude:session] meta.model="${model}" not in cache — downgrading to "${cached[0].value}"`,
			);
			model = cached[0].value;
			meta.model = model;
			await mutateIndex((idx) => {
				const latest = idx.sessions.find((s) => s.id === sessionId);
				if (latest) latest.model = model;
			});
			notifySessionModelChanged(sessionId, model);
		}

		const inbox = createMessageInbox();
		const q = query({
			prompt: inbox.iterable,
			options: {
				...buildQueryOptions({
					explicitSkillSelection: meta.skillSelection !== undefined,
					explicitMcpSelection: mcp.explicit,
					mcpEnv: mcp.env,
					model,
					permissionMode,
					claudePath,
					canUseTool: buildCanUseTool(sessionId, cwd),
					mcpServers: mcp.servers,
					cwd,
					resumeSdkSessionId: meta.sdkSessionId,
				}),
				...extensionOptions,
				plugins: [
					{ type: "local", path: join(cwd, ".ptolemy", "claude-harness") },
					...(extensionOptions.plugins ?? []),
				],
			},
		});
		active = {
			sessionId,
			q: { mcp, query: q, inbox, streamingLoop: null, turnCompletionQueue: [] },
		};
		permissionGate.clearWhitelist(sessionId);
		void primeModelsCacheFromQuery(q, authMode);

		console.log(
			`[claude:session] resumeSession ready: id=${sessionId} sdkSessionId=${meta.sdkSessionId} model=${model}`,
		);
		return startLoopForActive(sessionId);
	} catch (err) {
		await preparedMcp?.dispose();
		console.error("[claude:session] resumeSession failed:", err);
		return false;
	}
}

/**
 * Sends a follow-up message in the active session.
 *
 * With the stable `query()` API the SDK session is long-lived and accepts
 * additional user messages via the prompt async-iterable. We just push the
 * new message on the inbox; the running streaming loop continues to drain
 * the resulting SDK messages.
 *
 * `opts.modelOverride` switches the model for just this turn. The previous
 * model is restored via the `turnCompletionQueue`, fired when the streaming
 * loop reports the next `result`.
 */
export async function sendMessage(
	message: string,
	opts: { modelOverride?: string } = {},
): Promise<void> {
	if (activeCodex) {
		const runtime = activeCodex;
		console.log(
			`[codex:session] sendMessage: sessionId=${runtime.sessionId} length=${message.length} override=${opts.modelOverride ?? "(none)"} busy=${runtime.busy}`,
		);
		await appendStoredMessageV2(runtime.sessionId, {
			version: 2,
			role: "user",
			blocks: [{ type: "text", text: message }],
			timestamp: new Date().toISOString(),
			...(opts.modelOverride && { modelUsed: opts.modelOverride }),
		});
		// Queued behind any running turn; the model override applies only to
		// this turn because each Codex turn builds its own thread options.
		void runtime.enqueue(message, opts.modelOverride);
		return;
	}
	if (!active) {
		console.error("[claude:session] sendMessage: no active session");
		throw new Error("No active session");
	}
	const snap = active; // captured BEFORE any await
	const internalId = snap.sessionId;
	const selectionMeta = (await readIndex()).sessions.find(
		(s) => s.id === internalId,
	);
	if (selectionMeta?.builtinCommands)
		denyUnselectedSlash(
			message,
			selectionMeta.builtinCommands.all,
			selectionMeta.builtinCommands.selected,
		);
	if (selectionMeta?.extensionSelections)
		message = await resolveExtensionPrompt(
			await prepareSessionExtensions(
				internalId,
				selectionMeta.projectPath,
				selectionMeta.extensionSelections,
				"claude",
				{ materialize: false },
			),
			message,
			selectionMeta.projectPath,
		);

	console.log(
		`[claude:session] sendMessage start: sessionId=${internalId} length=${message.length} override=${opts.modelOverride ?? "(none)"}`,
	);
	verbose(
		`[claude:session] sendMessage preview: sessionId=${internalId} message="${previewText(message)}"`,
	);

	await appendStoredMessageV2(internalId, {
		version: 2,
		role: "user",
		blocks: [{ type: "text", text: message }],
		timestamp: new Date().toISOString(),
		...(opts.modelOverride && { modelUsed: opts.modelOverride }),
	});

	const index = await readIndex();
	const meta = index.sessions.find((s) => s.id === internalId);
	if (!meta) {
		throw new Error(`Session metadata not found: ${internalId}`);
	}

	let restore: string | null = null;
	if (opts.modelOverride && opts.modelOverride !== meta.model) {
		const cached = await tryGetCachedModels(meta.authMode ?? "anthropic");
		// If we have a cache and the override isn't in it, ignore.
		// If we have no cache, allow it (best-effort).
		if (!cached || cached.some((m) => m.value === opts.modelOverride)) {
			restore = meta.model;
			try {
				await snap.q.query.setModel(opts.modelOverride);
			} catch (err) {
				console.warn("[claude:session] setModel(override) failed:", err);
				restore = null;
			}
		} else {
			console.warn(
				`[claude:session] modelOverride="${opts.modelOverride}" not in cache — ignoring`,
			);
		}
	}

	if (restore !== null) {
		const restoreModel = restore;
		snap.q.turnCompletionQueue.push(async () => {
			// Identity-guard: only restore if this exact slot is still active.
			if (active !== snap) return;
			try {
				await snap.q.query.setModel(restoreModel);
			} catch (err) {
				console.warn("[claude:session] setModel(restore) failed:", err);
				sender.sendEvent?.(internalId, {
					type: "error",
					error: {
						message: "Falha ao restaurar modelo da sessão",
						recoverable: true,
					},
				});
			}
		});
	}

	snap.q.inbox.push(buildUserMessage(message));
}

/**
 * Stops the currently running generation by interrupting the active query.
 * The Query is kept alive so follow-up messages remain possible.
 */
export async function stopGeneration(): Promise<boolean> {
	console.log(
		`[claude:session] stopGeneration: activeId=${active?.sessionId ?? activeCodex?.sessionId ?? "null"}`,
	);
	if (activeCodex) return activeCodex.stop();
	if (!active) return false;

	// Release any tool-permission promises the SDK is awaiting. The interrupt
	// below races them; cancelling explicitly avoids leaking deny timers.
	clearSessionPermissionState(active.sessionId, "generation stopped");

	try {
		await active.q.query.interrupt();
		// Drain any pending turn-completion callbacks (e.g. model-override
		// restore) since `onTurnComplete` will not fire after an interrupt.
		// Spec invariant: override restore always runs, including on cancel.
		if (active) {
			const pending = active.q.turnCompletionQueue.splice(0);
			for (const cb of pending) {
				cb().catch((err) => {
					console.warn(
						"[claude:session] stopGeneration drain callback failed:",
						err,
					);
				});
			}
		}
		console.log("[claude:session] stopGeneration: interrupted");
		return true;
	} catch (err) {
		console.error("[claude:session] stopGeneration failed:", err);
		return false;
	}
}

/**
 * Deletes a session's stored data and removes it from the index. If the
 * session's project has no other sessions attached, the project folder is
 * also removed — for today's 1:1 project-per-conversation mapping that
 * means deleting a conversation wipes its workspace too. The lookup keeps
 * working once multiple sessions share a project.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
	console.log(`[claude:session] deleteSession start: id=${sessionId}`);
	const index = await readIndex();
	const idx = index.sessions.findIndex((s) => s.id === sessionId);
	if (idx === -1) {
		console.log(
			`[claude:session] deleteSession: id=${sessionId} not found in index`,
		);
		return false;
	}

	const meta = index.sessions[idx];
	const { projectId } = meta;
	clearSessionPermissionState(sessionId, "session deleted");

	// If this is the active session, close it and drain its streaming loop
	// BEFORE touching files — otherwise the loop's final writes can land
	// after rm and either recreate the dir or error out mid-flush.
	if (active && active.sessionId === sessionId) {
		try {
			active.q.inbox.close();
			active.q.query.close();
		} catch {
			// Ignore close errors
		}
		if (active.q.streamingLoop) {
			await active.q.streamingLoop.catch(() => {});
		}
		await active.q.mcp.dispose();
		active = null;
	}
	if (activeCodex && activeCodex.sessionId === sessionId) {
		await deactivateCodex("session deleted");
	}
	if (pendingCodex && pendingCodex.id === sessionId) {
		pendingCodex = null;
	}

	const removal = await mutateIndex((current) => {
		const currentIdx = current.sessions.findIndex((s) => s.id === sessionId);
		if (currentIdx === -1) return null;
		current.sessions.splice(currentIdx, 1);
		return [...current.sessions];
	});
	if (!removal) return false;

	// Drain qualquer escrita pendente desta sessão antes de remover o
	// diretório, senão a fila recria arquivos depois do rm. Em seguida,
	// libera a entrada do mapa para não vazar memória por sessão criada.
	const pendingWrite = messageWriteQueues.get(sessionId);
	if (pendingWrite) {
		await pendingWrite.catch(() => {});
		messageWriteQueues.delete(sessionId);
	}

	// Remove session directory
	const dir = sessionDir(sessionId);
	try {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	} catch {
		// Best-effort cleanup
	}

	// Delete the project folder only when no other session — persisted OR
	// currently active in memory — still needs it. The in-memory check
	// matters once multiple sessions share a project: a sibling session
	// might be mid-flight and not yet persisted.
	const activeSessionIdSnap =
		active?.sessionId ?? activeCodex?.sessionId ?? null;
	const activeOnProject =
		activeSessionIdSnap !== null
			? removal.find((s) => s.id === activeSessionIdSnap)?.projectId ===
				projectId
			: false;
	const stillReferenced =
		activeOnProject || removal.some((s) => s.projectId === projectId);
	if (!stillReferenced) {
		await projectStore.delete(projectId).catch((err) => {
			console.error(
				"[claude:session] deleteSession: project cleanup failed:",
				err,
			);
		});
	}

	console.log(`[claude:session] deleteSession done: id=${sessionId}`);
	return true;
}

/**
 * Returns all stored messages for a given session.
 */
export async function getSessionMessages(
	sessionId: string,
): Promise<StoredMessageV2[]> {
	return readMessages(sessionId);
}

/**
 * Returns the ID of the currently active session, or null.
 */
export function getActiveSessionId(): string | null {
	return active?.sessionId ?? activeCodex?.sessionId ?? null;
}

/** Lists all known projects. Exposed for future project-picker UI. */
export async function listProjects(): Promise<Project[]> {
	return projectStore.list();
}

/**
 * Persists a new model on a session's metadata, switching the live runtime
 * model when that session is currently active. Refuses while a streaming
 * loop is in flight (the SDK can't safely change models mid-turn).
 */
export async function setSessionModel(
	sessionId: string,
	model: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const index = await readIndex();
	const meta = index.sessions.find((s) => s.id === sessionId);
	if (!meta) return { ok: false, reason: "session-not-found" };

	if (sessionAgent(meta) === "codex") {
		// Codex builds thread options per turn, so the new model simply
		// applies from the next turn on.
		if (
			activeCodex &&
			activeCodex.sessionId === sessionId &&
			activeCodex.busy
		) {
			return { ok: false, reason: "session-busy" };
		}
		await mutateIndex((idx) => {
			const latest = idx.sessions.find((s) => s.id === sessionId);
			if (latest) latest.model = model;
		});
		notifySessionModelChanged(sessionId, model);
		return { ok: true };
	}

	if (active && active.sessionId === sessionId) {
		if (active.q.streamingLoop) {
			return { ok: false, reason: "session-busy" };
		}
		try {
			await active.q.query.setModel(model);
		} catch (err) {
			console.error("[claude:session] setSessionModel runtime failed:", err);
			return { ok: false, reason: "sdk-error" };
		}
	}

	meta.model = model;
	await mutateIndex((idx) => {
		const latest = idx.sessions.find((s) => s.id === sessionId);
		if (latest) latest.model = model;
	});
	notifySessionModelChanged(sessionId, model);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Context breakdown ("what fills the context window")
// ---------------------------------------------------------------------------

const CONTEXT_USAGE_TIMEOUT_MS = 8000;

export type ContextBreakdownResult =
	| { ok: true; breakdown: ContextBreakdown }
	| { ok: false; reason: string };

/**
 * Detailed context usage of a session. Claude asks the live CLI process
 * (`getContextUsage`, the data behind `/context`), so the session must be the
 * active one; Codex is estimated from the thread's rollout file.
 */
export async function getContextBreakdown(
	sessionId: string,
): Promise<ContextBreakdownResult> {
	const meta = (await readIndex()).sessions.find((s) => s.id === sessionId);
	if (!meta) return { ok: false, reason: "Sessão não encontrada." };

	if (sessionAgent(meta) === "codex") {
		if (!meta.sdkSessionId) {
			return {
				ok: false,
				reason: "O Codex ainda não respondeu nesta conversa.",
			};
		}
		try {
			const breakdown = await readCodexContextBreakdown(meta.sdkSessionId);
			return breakdown
				? { ok: true, breakdown }
				: {
						ok: false,
						reason:
							"Não encontrei o histórico desta thread em ~/.codex/sessions.",
					};
		} catch (err) {
			return {
				ok: false,
				reason: `Falha ao ler o histórico do Codex: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	if (!active || active.sessionId !== sessionId) {
		return {
			ok: false,
			reason: "A sessão não está ativa. Envie uma mensagem e tente de novo.",
		};
	}
	const q = active.q.query;
	try {
		const res = await Promise.race([
			q.getContextUsage(),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("tempo esgotado")),
					CONTEXT_USAGE_TIMEOUT_MS,
				),
			),
		]);
		return { ok: true, breakdown: mapClaudeContextUsage(res) };
	} catch (err) {
		console.warn("[claude:session] getContextUsage failed:", err);
		return {
			ok: false,
			reason: `O Claude não informou o uso do contexto (${err instanceof Error ? err.message : String(err)}).`,
		};
	}
}
