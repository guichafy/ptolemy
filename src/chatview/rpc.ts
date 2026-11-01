import { type ElectrobunRPCSchema, Electroview } from "electrobun/view";
import type {
	AgentEvent,
	AgentKind,
	ApproveBehavior,
	ContextBreakdown,
	ContextUsageInfo,
	ClaudeAuthMode as ProtocolClaudeAuthMode,
	ProtocolModelInfo,
	SessionStats,
} from "@/shared/agent-protocol";
import type { SessionSkill, SkillSummary } from "@/shared/skills";
import { AgentEventBuffer } from "./lib/agent-event-buffer";

const VERBOSE = import.meta.env.VITE_CLAUDE_LOG_VERBOSE === "1";
const verbose = (...args: unknown[]) => {
	if (VERBOSE) console.log(...args);
};

export type GitHubSearchType = "repos" | "code" | "issues" | "users";

export type CustomFilter =
	| {
			id: string;
			kind: "team-repos";
			name: string;
			icon?: string;
			org: string;
			team: string;
	  }
	| {
			id: string;
			kind: "search";
			name: string;
			icon?: string;
			baseType: GitHubSearchType;
			qualifiers: string;
	  };

export interface GitHubSettings {
	customFilters: CustomFilter[];
	hasToken: boolean;
}

export interface AnalyticsSettings {
	consentGiven: boolean;
	anonymousId: string;
}

export type ClaudeAuthMode = "anthropic" | "bedrock";
export type ClaudePermissionMode =
	| "dontAsk"
	| "acceptEdits"
	| "bypassPermissions"
	| "plan";

export interface ClaudeSettings {
	authMode: ClaudeAuthMode;
	model: string;
	permissionMode: ClaudePermissionMode;
}

export interface StoredMcpServer {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	enabled?: boolean;
}

export interface Settings {
	version: 1;
	plugins: {
		enabledOrder: string[];
	};
	github: GitHubSettings;
	analytics: AnalyticsSettings;
	claude: ClaudeSettings;
}

export type GitHubSubType =
	| { kind: "native"; type: GitHubSearchType }
	| { kind: "custom"; filter: CustomFilter };

export type GitHubItem =
	| {
			kind: "repo";
			id: number;
			fullName: string;
			description: string | null;
			stars: number;
			language: string | null;
			url: string;
	  }
	| {
			kind: "code";
			id: string;
			path: string;
			repoFullName: string;
			url: string;
	  }
	| {
			kind: "issue";
			id: number;
			number: number;
			title: string;
			state: "open" | "closed";
			isPR: boolean;
			repoFullName: string;
			url: string;
	  }
	| {
			kind: "user";
			id: number;
			login: string;
			name: string | null;
			avatarUrl: string;
			url: string;
	  };

export interface TokenStatus {
	hasToken: boolean;
	account?: string;
	login?: string;
}

export type SettingsSection = "plugins" | "general" | `plugin:${string}`;

export type ClaudeCliStatus =
	| "not-installed"
	| "not-authenticated"
	| "authenticated";

export interface ClaudeAuthStatus {
	mode: "anthropic" | "bedrock" | "none";
	anthropic?: { cliStatus: ClaudeCliStatus };
	bedrock?: { endpoint: string; profile: string; region: string };
}

export interface BedrockConfig {
	endpoint: string;
	profile: string;
	region: string;
}

export interface SessionMeta {
	id: string;
	sdkSessionId: string;
	/** Backing agent; absent on sessions created before Codex support. */
	agent?: AgentKind;
	skills?: SessionSkill[];
	title: string;
	/** Project this conversation belongs to. */
	projectId: string;
	/** Snapshot of the project directory (agent's cwd for the session). */
	projectPath: string;
	model: string;
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

/** Block type for stored messages. */
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

/** Stored message V2 format with structured blocks. */
export interface StoredMessage {
	version: 2;
	role: "user" | "assistant";
	blocks: StoredBlock[];
	timestamp: string;
	cost?: number;
	durationMs?: number;
	tokenUsage?: { input: number; output: number };
	/** Set when a per-turn model override was used for a user message. */
	modelUsed?: string;
	/** Assistant messages: concrete model that produced the reply. */
	model?: string;
}

interface PtolemyRPCSchema extends ElectrobunRPCSchema {
	bun: {
		requests: {
			listApps: { params: void; response: { name: string; path: string }[] };
			openApp: { params: { path: string }; response: boolean };
			openUrl: { params: { url: string }; response: boolean };
			getAppIcon: {
				params: { path: string };
				response: { icon: string | null };
			};
			resizeWindow: { params: { height: number }; response: boolean };
			loadSettings: { params: void; response: Settings };
			saveSettings: { params: Settings; response: boolean };
			githubGetTokenStatus: { params: void; response: TokenStatus };
			githubSetToken: {
				params: { token: string };
				response: { ok: boolean; login?: string; error?: string };
			};
			githubDeleteToken: { params: void; response: boolean };
			githubFetchSearch: {
				params: { subType: GitHubSubType; query: string };
				response: { items: GitHubItem[]; cached: boolean };
			};
			githubInvalidateCache: {
				params: void;
				response: boolean;
			};
			trackAnalyticsEvent: {
				params: { event: string; properties?: Record<string, unknown> };
				response: boolean;
			};
			setAnalyticsConsent: {
				params: { consentGiven: boolean };
				response: boolean;
			};
			agentListSkills: {
				params: { agent: AgentKind };
				response: SkillSummary[];
			};
			agentImportSkill: { params: { url: string }; response: SkillSummary };
			agentSetDefaultSkills: {
				params: { agent: AgentKind; skillIds: string[] };
				response: boolean;
			};
			claudeListSessions: { params: void; response: SessionMeta[] };
			claudeCreateSession: {
				params: {
					prompt: string;
					projectId?: string;
					agent?: AgentKind;
					skillIds?: string[];
					model?: string;
				};
				response: { sessionId: string };
			};
			claudeResumeSession: {
				params: { sessionId: string };
				response: boolean;
			};
			claudeSendMessage: {
				params: { message: string; modelOverride?: string };
				response: void;
			};
			claudeStopGeneration: { params: void; response: boolean };
			claudeDeleteSession: {
				params: { sessionId: string };
				response: boolean;
			};
			claudeGetSessionMessages: {
				params: { sessionId: string };
				response: StoredMessage[];
			};
			claudeGetAuthStatus: { params: void; response: ClaudeAuthStatus };
			claudeOpenLogin: {
				params: void;
				response: { ok: boolean; error?: string };
			};
			claudeInstallCli: {
				params: void;
				response: { ok: boolean; error?: string };
			};
			claudeSetBedrock: { params: BedrockConfig; response: boolean };
			claudeGetBedrock: { params: void; response: BedrockConfig | null };
			claudeListSupportedModels: {
				params: void;
				response: {
					models: ProtocolModelInfo[];
					authMode: ProtocolClaudeAuthMode;
				};
			};
			claudeSetSessionModel: {
				params: { sessionId: string; model: string };
				response: {
					ok: boolean;
					reason?: "session-not-found" | "session-busy" | "sdk-error";
				};
			};
			agentGetContextBreakdown: {
				params: { sessionId: string };
				response:
					| { ok: true; breakdown: ContextBreakdown }
					| { ok: false; reason: string };
			};
			claudeOpenChat: {
				params: { sessionId?: string };
				response: boolean;
			};
			codexListModels: {
				params: void;
				response: { models: ProtocolModelInfo[] };
			};
			agentApproveTool: {
				params: {
					permissionId: string;
					behavior: ApproveBehavior;
					modifiedArgs?: Record<string, unknown>;
				};
				response: boolean;
			};
			agentRejectTool: {
				params: { permissionId: string; reason?: string };
				response: boolean;
			};
			agentListMcpServers: { params: void; response: StoredMcpServer[] };
			agentSaveMcpServers: {
				params: { servers: StoredMcpServer[] };
				response: boolean;
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			openPreferences: { section?: SettingsSection };
			claudeOpenSession: { sessionId: string };
			agentEvent: { sessionId: string; event: AgentEvent };
		};
	};
}

let openSessionHandler: ((args: { sessionId: string }) => void) | null = null;

// Buffer for claudeOpenSession messages that arrive before the React tree
// has mounted and registered a handler via onOpenSession. This happens when
// the backend creates a new chat window and sends the sessionId before the
// webview's JS has fully loaded. We deliver the buffered args as soon as a
// handler is registered.
let pendingOpenSession: { sessionId: string } | null = null;

// Typed agent-event channel. Subscribers see every event the backend emits for
// any session; filter by sessionId downstream. Events received before the first
// subscriber are buffered (see agent-event-buffer.ts) because the streaming
// loop starts before the chat window's React tree mounts — without the buffer
// the early text-start/text-delta events would be dropped and the assistant
// bubble would render empty.
type AgentEventListener = (args: {
	sessionId: string;
	event: AgentEvent;
}) => void;
const agentEventBuffer = new AgentEventBuffer();

export function onAgentEvent(listener: AgentEventListener): () => void {
	return agentEventBuffer.subscribe(listener);
}

const rpcInstance = Electroview.defineRPC<PtolemyRPCSchema>({
	maxRequestTime: 90_000,
	handlers: {
		messages: {
			openPreferences: () => {},
			claudeOpenSession: (args) => {
				console.log(`[chat:rpc] openSession: sessionId=${args.sessionId}`);
				if (openSessionHandler) {
					openSessionHandler(args);
				} else {
					console.log(
						`[chat:rpc] openSession buffered (handler not ready): sessionId=${args.sessionId}`,
					);
					pendingOpenSession = args;
				}
			},
			agentEvent: (args) => {
				verbose(
					`[chat:rpc] agentEvent: sessionId=${args.sessionId} type=${args.event.type}`,
				);
				agentEventBuffer.push(args);
			},
		},
	},
});

new Electroview({ rpc: rpcInstance });

export function onOpenSession(handler: (args: { sessionId: string }) => void) {
	openSessionHandler = handler;
	// Drain any message that arrived before the handler was registered.
	if (pendingOpenSession) {
		const pending = pendingOpenSession;
		pendingOpenSession = null;
		console.log(`[chat:rpc] openSession drain: sessionId=${pending.sessionId}`);
		handler(pending);
	}
}

export const rpc = rpcInstance;
