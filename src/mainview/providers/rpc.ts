import { type ElectrobunRPCSchema, Electroview } from "electrobun/view";
import type {
	AgentEvent,
	AgentKind,
	ContextUsageInfo,
	SessionStats,
} from "@/shared/agent-protocol";
import type { ExtensionRequests } from "@/shared/extension-rpc";
import type { ExtensionSelection } from "@/shared/extensions";
import type { SessionSkill, SkillSummary } from "@/shared/skills";

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

export type CodexSandboxMode = "workspace-write" | "read-only";
export type CodexReasoningEffort = "" | "low" | "medium" | "high" | "xhigh";

export interface CodexSettings {
	model: string;
	sandboxMode: CodexSandboxMode;
	reasoningEffort: CodexReasoningEffort;
}

export type CodexCliStatus =
	| "not-installed"
	| "not-authenticated"
	| "authenticated";

export interface CodexAuthStatus {
	cliStatus: CodexCliStatus;
	method?: "chatgpt" | "api-key";
	cliPath?: string;
}

export type ProxyMode = "auto" | "system" | "env" | "none" | "manual";

export type ManualProxyProtocol = "http" | "https";

export interface ManualProxySettings {
	protocol: ManualProxyProtocol;
	host: string;
	port: number;
	username?: string;
	hasPassword: boolean;
	noProxy: string[];
}

export interface ProxySettings {
	mode: ProxyMode;
	manual?: ManualProxySettings;
}

export type ProxySource =
	| "env"
	| "scutil"
	| "scutil+pac"
	| "pac"
	| "manual"
	| "none";

export interface ProxyStatus {
	mode: ProxyMode;
	source: ProxySource;
	httpsProxy: string | null;
	httpProxy: string | null;
	noProxyCount: number;
	resolvedAt: number;
	pacUrl?: string;
}

export interface Settings {
	version: 1;
	plugins: {
		enabledOrder: string[];
	};
	github: GitHubSettings;
	analytics: AnalyticsSettings;
	claude: ClaudeSettings;
	codex: CodexSettings;
	proxy: ProxySettings;
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

export type SettingsSection =
	| "plugins"
	| "general"
	| "network"
	| "extensions"
	| `plugin:${string}`;

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
	extensionSelections?: ExtensionSelection[];
	builtinCommandNames?: string[];
	mcpServerIds?: string[];
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
	modelUsed?: string;
	/** Assistant messages: concrete model that produced the reply. */
	model?: string;
}

interface PtolemyRPCSchema extends ElectrobunRPCSchema {
	bun: {
		requests: ExtensionRequests & {
			listApps: { params: void; response: { name: string; path: string }[] };
			openApp: { params: { path: string }; response: boolean };
			openUrl: { params: { url: string }; response: boolean };
			getAppIcon: {
				params: { path: string };
				response: { icon: string | null };
			};
			resizeWindow: {
				params: { height: number; width?: number };
				response: boolean;
			};
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
					extensionSelections?: ExtensionSelection[];
					builtinCommandNames?: string[];
					mcpServerIds?: string[];
					model?: string;
				};
				response: { sessionId: string };
			};
			claudeResumeSession: {
				params: { sessionId: string };
				response: boolean;
			};
			claudeSendMessage: { params: { message: string }; response: void };
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
			claudeOpenChat: {
				params: { sessionId?: string };
				response: boolean;
			};
			claudeListSupportedModels: {
				params: void;
				response: {
					models: import("@/shared/agent-protocol").ProtocolModelInfo[];
					authMode: ClaudeAuthMode;
				};
			};
			codexGetAuthStatus: { params: void; response: CodexAuthStatus };
			codexOpenLogin: {
				params: void;
				response: { ok: boolean; error?: string };
			};
			codexInstallCli: {
				params: void;
				response: { ok: boolean; error?: string };
			};
			codexListModels: {
				params: void;
				response: {
					models: import("@/shared/agent-protocol").ProtocolModelInfo[];
				};
			};
			agentApproveTool: {
				params: {
					permissionId: string;
					behavior: import("@/shared/agent-protocol").ApproveBehavior;
					modifiedArgs?: Record<string, unknown>;
				};
				response: boolean;
			};
			agentRejectTool: {
				params: { permissionId: string; reason?: string };
				response: boolean;
			};
			getProxyStatus: { params: void; response: ProxyStatus };
			reloadProxyFromSystem: { params: void; response: ProxyStatus };
			saveManualProxy: {
				params: {
					protocol: ManualProxyProtocol;
					host: string;
					port: number;
					username?: string;
					password?: string;
					noProxy: string[];
				};
				response: { ok: boolean; error?: string };
			};
			clearManualProxy: { params: void; response: boolean };
			testProxyConnection: {
				params: { testUrl?: string };
				response: {
					ok: boolean;
					status?: number;
					latencyMs: number;
					error?: string;
				};
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			openPreferences: { section?: SettingsSection };
			claudeStreamChunk: { sessionId: string; chunk: unknown };
			claudeStreamEnd: {
				sessionId: string;
				result: {
					subtype: string;
					result?: string;
					totalCostUsd?: number;
					durationMs?: number;
					usage?: { input: number; output: number };
				};
			};
			claudeStreamError: { sessionId: string; error: string };
			claudeOpenSession: { sessionId: string };
			claudeSessionsUpdate: { sessions: SessionMeta[] };
			windowShown: { at: number };
			agentEvent: { sessionId: string; event: AgentEvent };
		};
	};
}

let openPreferencesHandler:
	| ((args: { section?: SettingsSection }) => void)
	| null = null;

export function setOpenPreferencesHandler(
	handler: ((args: { section?: SettingsSection }) => void) | null,
) {
	openPreferencesHandler = handler;
}

type AgentEventArgs = { sessionId: string; event: AgentEvent };
type AgentEventListener = (args: AgentEventArgs) => void;

const agentEventListeners = new Set<AgentEventListener>();

export function onAgentEvent(listener: AgentEventListener): () => void {
	agentEventListeners.add(listener);
	return () => {
		agentEventListeners.delete(listener);
	};
}

type WindowShownListener = () => void;

const windowShownListeners = new Set<WindowShownListener>();

export function onWindowShown(listener: WindowShownListener): () => void {
	windowShownListeners.add(listener);
	return () => {
		windowShownListeners.delete(listener);
	};
}

let claudeSessionsUpdateHandler:
	| ((args: { sessions: SessionMeta[] }) => void)
	| null = null;

// Buffer the most recent claudeSessionsUpdate message that arrives before
// the React tree has registered a handler. This happens on app start — bun
// pushes the session list as soon as the main window gains focus, which can
// race with the webview's initial mount. We keep only the latest args because
// newer pushes supersede older ones (the backend is authoritative).
let pendingClaudeSessionsUpdate: { sessions: SessionMeta[] } | null = null;

export function setClaudeSessionsUpdateHandler(
	handler: ((args: { sessions: SessionMeta[] }) => void) | null,
) {
	claudeSessionsUpdateHandler = handler;
	if (handler && pendingClaudeSessionsUpdate) {
		const pending = pendingClaudeSessionsUpdate;
		pendingClaudeSessionsUpdate = null;
		handler(pending);
	}
}

const rpcInstance = Electroview.defineRPC<PtolemyRPCSchema>({
	// GitHub Skill imports have a bounded 60s backend deadline.
	maxRequestTime: 90_000,
	handlers: {
		messages: {
			openPreferences: (args) => {
				openPreferencesHandler?.(args ?? {});
			},
			claudeStreamChunk: () => {},
			claudeStreamEnd: () => {},
			claudeStreamError: () => {},
			claudeOpenSession: () => {},
			claudeSessionsUpdate: (args) => {
				if (claudeSessionsUpdateHandler) {
					claudeSessionsUpdateHandler(args);
				} else {
					pendingClaudeSessionsUpdate = args;
				}
			},
			windowShown: () => {
				for (const listener of windowShownListeners) {
					try {
						listener();
					} catch (err) {
						console.error("[mainview:rpc] windowShown listener threw:", err);
					}
				}
			},
			agentEvent: (args) => {
				for (const listener of agentEventListeners) {
					try {
						listener(args);
					} catch (err) {
						console.error("[mainview:rpc] agentEvent listener threw:", err);
					}
				}
			},
		},
	},
});

new Electroview({ rpc: rpcInstance });

export const rpc = rpcInstance;
