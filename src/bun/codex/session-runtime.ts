import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";
import type { SessionInfoPatch } from "@/shared/agent-protocol";
import type {
	MessagePersister,
	StreamMessageSender,
} from "../claude/streaming";
import {
	buildCodexMcpOverrides,
	inheritedCodexMcpNames,
	localMcpEnv,
	type PreparedSessionMcp,
} from "../mcp/runtime";
import type { CodexReasoningEffort, CodexSandboxMode } from "../settings";
import { assertSkillSelectionSupport } from "../skills/runtime-support";
import { buildCodexEnv, findCodexCli } from "./codex-cli";
import { toSdkModel } from "./models";
import { readCodexSessionInfo } from "./rollout-info";
import { type CodexThreadLike, runCodexTurn } from "./runner";

export interface CodexTurnConfig {
	/** Session model (stored value; `CODEX_DEFAULT_MODEL` defers to the CLI). */
	model: string;
	sandboxMode: CodexSandboxMode;
	reasoningEffort: CodexReasoningEffort;
}

export interface CodexRuntimeDeps {
	sessionId: string;
	mcp?: PreparedSessionMcp;
	/** Conversation project directory: Codex's working dir and sandbox root. */
	cwd: string;
	/** Codex thread id from a previous run, or null for a brand-new thread. */
	threadId: string | null;
	sender: StreamMessageSender;
	persister: MessagePersister;
	/** Read fresh before every turn so settings edits apply to the next turn. */
	loadConfig: () => Promise<CodexTurnConfig>;
	onThreadId: (threadId: string) => void;
	/** Persists the resolved model / context usage revealed by a turn. */
	onSessionInfo?: (patch: SessionInfoPatch) => void;
	/** Injected in tests; defaults to reading the thread's rollout file. */
	readSessionInfo?: (threadId: string) => Promise<SessionInfoPatch | null>;
	/** Fresh inventory disables newly installed native Skills for explicit selections. */
	loadSkillConfig?: () => Promise<NonNullable<CodexOptions["config"]>>;
	/** Injected in tests; defaults to spawning the user's Codex CLI. */
	createThread?: (
		threadId: string | null,
		options: ThreadOptions,
		config: NonNullable<CodexOptions["config"]>,
		mcp?: PreparedSessionMcp,
	) => Promise<CodexThreadLike>;
}

/**
 * Builds the per-turn `ThreadOptions`. The sandbox is what confines Codex's
 * writes to the conversation's project directory (the counterpart of the
 * Claude workspace jail), so `workingDirectory` is always the project and
 * full access is never requested. `approvalPolicy: "never"` because
 * `codex exec` is non-interactive: there is no channel to ask the user.
 */
export function buildThreadOptions(
	config: CodexTurnConfig,
	cwd: string,
	modelOverride?: string,
): ThreadOptions {
	const options: ThreadOptions = {
		sandboxMode: config.sandboxMode,
		workingDirectory: cwd,
		// Project dirs are plain folders, not git repos.
		skipGitRepoCheck: true,
		approvalPolicy: "never",
	};
	const model = toSdkModel(modelOverride ?? config.model);
	if (model) options.model = model;
	if (config.reasoningEffort) {
		options.modelReasoningEffort = config.reasoningEffort;
	}
	return options;
}

async function defaultCreateThread(
	threadId: string | null,
	options: ThreadOptions,
	config: NonNullable<CodexOptions["config"]>,
	mcp?: PreparedSessionMcp,
): Promise<CodexThreadLike> {
	// Imported lazily so the SDK (and its CLI lookup) only loads when a Codex
	// session actually runs.
	const { Codex } = await import("@openai/codex-sdk");
	const cliPath = await findCodexCli();
	const env = localMcpEnv({ ...(await buildCodexEnv()), ...mcp?.env });
	const configOverrides =
		mcp && mcp.explicit !== false
			? buildCodexMcpOverrides(
					mcp.codexConfig,
					await inheritedCodexMcpNames(cliPath, options.workingDirectory!, env),
				)
			: undefined;
	if (config.skills)
		await assertSkillSelectionSupport("codex", cliPath, undefined, env);
	const codex = new Codex({
		config,
		configOverrides,
		codexPathOverride: cliPath,
		env,
	});
	return threadId
		? codex.resumeThread(threadId, options)
		: codex.startThread(options);
}

/**
 * Live state of one Codex conversation.
 *
 * Unlike the Claude SDK's long-lived `query()`, each Codex turn is a separate
 * `codex exec` process: a new thread on the first turn, `resume <threadId>`
 * afterwards. Turns are serialized through a promise chain, so a message sent
 * while Codex is still working runs right after the current turn, like the
 * Claude inbox.
 */
export class CodexSessionRuntime {
	readonly sessionId: string;
	private readonly deps: CodexRuntimeDeps;
	private chain: Promise<void> = Promise.resolve();
	private controller: AbortController | null = null;
	private pending = 0;
	private closed = false;
	private currentThreadId: string | null;

	constructor(deps: CodexRuntimeDeps) {
		this.deps = deps;
		this.sessionId = deps.sessionId;
		this.currentThreadId = deps.threadId;
	}

	get threadId(): string | null {
		return this.currentThreadId;
	}

	/** True while a turn is running or queued. */
	get busy(): boolean {
		return this.pending > 0;
	}

	/** Queues a turn; resolves when that turn has finished (never rejects). */
	enqueue(prompt: string, modelOverride?: string): Promise<void> {
		this.pending++;
		const next = this.chain.then(() => this.runTurn(prompt, modelOverride));
		this.chain = next.finally(() => {
			this.pending--;
		});
		return this.chain;
	}

	private async runTurn(prompt: string, modelOverride?: string): Promise<void> {
		if (this.closed) return;
		const controller = new AbortController();
		this.controller = controller;
		try {
			const config = await this.deps.loadConfig();
			const options = buildThreadOptions(config, this.deps.cwd, modelOverride);
			const createThread = this.deps.createThread ?? defaultCreateThread;
			const skillConfig = (await this.deps.loadSkillConfig?.()) ?? {};
			const thread = await createThread(
				this.currentThreadId,
				options,
				skillConfig,
				this.deps.mcp,
			);
			await runCodexTurn({
				thread,
				prompt,
				sessionId: this.sessionId,
				sender: this.deps.sender,
				persister: this.deps.persister,
				signal: controller.signal,
				onThreadId: (id) => {
					if (id && id !== this.currentThreadId) {
						this.currentThreadId = id;
						this.deps.onThreadId(id);
					}
				},
				readSessionInfo: async () => {
					const threadId = this.currentThreadId;
					if (!threadId) return null;
					const read = this.deps.readSessionInfo ?? readCodexSessionInfo;
					return read(threadId);
				},
				onSessionInfo: this.deps.onSessionInfo,
			});
		} catch (err) {
			// Setup failures (CLI missing, settings unreadable) never reach
			// runCodexTurn's own error handling; surface them the same way.
			console.error(
				`[codex:session] turn setup failed: ${this.sessionId}`,
				err,
			);
			this.deps.sender.sendEvent(this.sessionId, {
				type: "error",
				error: {
					message: err instanceof Error ? err.message : String(err),
					recoverable: true,
				},
			});
			this.deps.sender.sendEvent(this.sessionId, {
				type: "finish",
				reason: "error",
				usage: { inputTokens: 0, outputTokens: 0 },
			});
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	/** Aborts the running turn (queued turns still run). */
	stop(): boolean {
		if (!this.controller) return false;
		this.controller.abort();
		return true;
	}

	/** Aborts everything and waits for the chain to drain. */
	async close(): Promise<void> {
		this.closed = true;
		this.controller?.abort();
		await this.chain.catch(() => {});
		await this.deps.mcp?.dispose();
	}
}
