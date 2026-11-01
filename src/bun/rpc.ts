import { readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineElectrobunRPC, type ElectrobunRPCSchema } from "electrobun/bun";
import type { SkillSummary } from "@/shared/skills";
import type {
	AgentEvent,
	AgentKind,
	ApproveBehavior,
	ClaudeAuthMode,
	ContextBreakdown,
	ProtocolModelInfo,
} from "../shared/agent-protocol";
// Value import (not type-only) — keep the path relative so Bun's bundler can
// resolve it without the tsconfig `@/*` alias. Other bun-side imports of
// `@/shared/...` survive only because they're type-only and get erased.
import { BROADCAST_SESSION_ID } from "../shared/agent-protocol";
import { setAnalyticsEnabled, trackEvent } from "./analytics";
import {
	type BedrockConfig,
	type ClaudeAuthStatus,
	getBedrockConfig,
	getClaudeAuthStatus,
	installClaudeCli,
	openClaudeLogin,
	setBedrockConfig,
} from "./claude/auth";
import { mcpLoader, type StoredMcpServer } from "./claude/mcp-loader";
import {
	createSession as claudeCreateSession,
	deleteSession as claudeDeleteSession,
	getSessionMessages as claudeGetSessionMessages,
	listSessions as claudeListSessions,
	resumeSession as claudeResumeSession,
	sendMessage as claudeSendMessage,
	setSender as claudeSetSender,
	stopGeneration as claudeStopGeneration,
	getContextBreakdown,
	getPermissionGate,
	type SessionMeta,
	type StoredMessageV2,
} from "./claude/session-manager";
import {
	type CodexAuthStatus,
	getCodexAuthStatus,
	installCodexCli,
	openCodexLogin,
} from "./codex/auth";
import { listCodexModels } from "./codex/models";
import { readConfiguredCodexModel } from "./codex/rollout-info";
import {
	type GitHubItem,
	type GitHubSubType,
	githubFetchSearch,
} from "./github/github-fetch";
import { invalidateAll as invalidateSearchCache } from "./github/search-cache";
import {
	deleteToken as deleteGithubToken,
	getStatus as getGithubTokenStatus,
	setToken as setGithubToken,
	type TokenStatus,
} from "./github-token";
import { deletePassword, setPassword } from "./keychain";
import {
	fetchWithProxy,
	getProxyStatus as getProxyStatusFromModule,
	initProxy,
	manualAccountId,
	PROXY_KEYCHAIN_SERVICE,
	type ProxyStatus,
	reloadFromSystem as reloadProxyFromSystemModule,
} from "./net/proxy";
import {
	loadSettings as loadSettingsFromDisk,
	type ManualProxyProtocol,
	type ManualProxySettings,
	type Settings,
	saveSettings as saveSettingsToDisk,
} from "./settings";
import { skillsStore } from "./skills/store";

export type SettingsSection =
	| "plugins"
	| "general"
	| "network"
	| `plugin:${string}`;

export interface PtolemyRPCSchema extends ElectrobunRPCSchema {
	bun: {
		requests: {
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
				// No cwd: the backend auto-provisions a project directory per
				// conversation. Pass projectId to attach a new session to an
				// existing project (future multi-session-per-project UI).
				// `agent` picks the backing agent; omitted means Claude.
				params: {
					prompt: string;
					projectId?: string;
					agent?: AgentKind;
					skillIds?: string[];
					mcpServerIds?: string[];
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
				response: StoredMessageV2[];
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
				response: { models: ProtocolModelInfo[]; authMode: ClaudeAuthMode };
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
				response: { models: ProtocolModelInfo[] };
			};
			// HITL tool-permission commands (phase 4).
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
			claudeOpenSession: { sessionId: string };
			claudeSessionsUpdate: { sessions: SessionMeta[] };
			windowShown: { at: number };
			agentEvent: { sessionId: string; event: AgentEvent };
		};
	};
}

type BunRequests = PtolemyRPCSchema["bun"]["requests"];
type RequestParams<K extends keyof BunRequests> = BunRequests[K]["params"];
type RequestResponse<K extends keyof BunRequests> = Awaited<
	BunRequests[K]["response"]
>;
type BunRequestHandlers = {
	[K in keyof BunRequests]: (
		...args: undefined extends RequestParams<K>
			? [params?: RequestParams<K>]
			: [params: RequestParams<K>]
	) => RequestResponse<K> | Promise<RequestResponse<K>>;
};

// Callback for opening chat window (set from index.ts)
let openChatCallback: ((sessionId?: string) => void) | null = null;
export function setOpenChatCallback(cb: (sessionId?: string) => void) {
	openChatCallback = cb;
}

// Window reference for resize handler (set from index.ts)
let mainWindowRef: {
	getFrame: () => { x: number; y: number; width: number; height: number };
	setFrame: (x: number, y: number, w: number, h: number) => void;
} | null = null;
export function setMainWindow(win: {
	getFrame: () => { x: number; y: number; width: number; height: number };
	setFrame: (x: number, y: number, w: number, h: number) => void;
}) {
	mainWindowRef = win;
}

// Late-bound visibility check, wired from index.ts via the native FFI.
// Used to ignore resizeWindow calls that arrive after the window has been
// orderOut'd — Electrobun's setFrame applied to a hidden window can re-show
// it, producing a "flicker + reopen" behavior when fast typing races a
// hotkey-hide.
let mainWindowVisibilityChecker: (() => boolean) | null = null;
export function setMainWindowVisibilityChecker(fn: () => boolean) {
	mainWindowVisibilityChecker = fn;
}

let cachedApps: { name: string; path: string }[] | null = null;

async function scanDirectory(
	dir: string,
): Promise<{ name: string; path: string }[]> {
	const results: { name: string; path: string }[] = [];
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.name.endsWith(".app")) {
				results.push({
					name: entry.name.replace(/\.app$/, ""),
					path: fullPath,
				});
			} else if (entry.isDirectory()) {
				const subResults = await scanDirectory(fullPath);
				results.push(...subResults);
			}
		}
	} catch {
		// Directory may not exist or be unreadable
	}
	return results;
}

async function scanApps(): Promise<{ name: string; path: string }[]> {
	if (cachedApps) return cachedApps;

	const dirs = [
		"/Applications",
		"/System/Applications",
		join(homedir(), "Applications"),
	];

	const results = await Promise.all(dirs.map(scanDirectory));
	const apps = results.flat();

	const seen = new Set<string>();
	const unique = apps.filter((app) => {
		if (seen.has(app.path)) return false;
		seen.add(app.path);
		return true;
	});

	unique.sort((a, b) => a.name.localeCompare(b.name));
	cachedApps = unique;
	return unique;
}

const iconCache = new Map<string, string | null>();

async function getAppIconBase64(appPath: string): Promise<string | null> {
	if (iconCache.has(appPath)) return iconCache.get(appPath)!;

	try {
		// Read CFBundleIconFile from Info.plist
		const plistBase = join(appPath, "Contents", "Info");
		const defaultsProc = Bun.spawn(
			["defaults", "read", plistBase, "CFBundleIconFile"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		let iconName = (await new Response(defaultsProc.stdout).text()).trim();
		if (!iconName) {
			// Try CFBundleIconName (modern apps with asset catalogs)
			const defaultsProc2 = Bun.spawn(
				["defaults", "read", plistBase, "CFBundleIconName"],
				{
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			iconName = (await new Response(defaultsProc2.stdout).text()).trim();
			if (!iconName) {
				iconCache.set(appPath, null);
				return null;
			}
		}

		if (!iconName.endsWith(".icns")) iconName += ".icns";
		const icnsPath = join(appPath, "Contents", "Resources", iconName);

		// Check file exists
		const file = Bun.file(icnsPath);
		if (!(await file.exists())) {
			iconCache.set(appPath, null);
			return null;
		}

		// Convert to 32x32 PNG using sips
		const tmpFile = `/tmp/ptolemy-icon-${process.pid}-${Date.now()}.png`;
		const sipsProc = Bun.spawn(
			["sips", "-s", "format", "png", "-Z", "32", icnsPath, "--out", tmpFile],
			{ stdout: "pipe", stderr: "pipe" },
		);
		await sipsProc.exited;

		const pngFile = Bun.file(tmpFile);
		if (!(await pngFile.exists())) {
			iconCache.set(appPath, null);
			return null;
		}

		const buffer = await pngFile.arrayBuffer();
		const base64 = Buffer.from(buffer).toString("base64");

		// Cleanup temp file
		unlink(tmpFile).catch(() => {});

		iconCache.set(appPath, base64);
		return base64;
	} catch {
		iconCache.set(appPath, null);
		return null;
	}
}

// Late-bound sender for pushing `claudeSessionsUpdate` to the main window.
// `requestHandlers` is defined below and can't reference `mainRpc` directly
// (that would be a TDZ violation — `mainRpc` is created from these handlers).
// Tests replace this to observe pushes without instantiating the Electrobun
// transport.
let sessionsUpdatePusher: ((args: { sessions: SessionMeta[] }) => void) | null =
	null;

export function setSessionsUpdatePusher(
	fn: ((args: { sessions: SessionMeta[] }) => void) | null,
) {
	sessionsUpdatePusher = fn;
}

// Late-bound pusher for `models-cache-invalidated` events. Same TDZ-avoidance
// pattern as `sessionsUpdatePusher` above.
let modelsInvalidatedPusher: ((authMode: ClaudeAuthMode) => void) | null = null;

export function setModelsInvalidatedPusher(
	fn: ((authMode: ClaudeAuthMode) => void) | null,
) {
	modelsInvalidatedPusher = fn;
}

async function invalidateModelsCache(authMode: ClaudeAuthMode): Promise<void> {
	const { invalidate } = await import("./claude/models-cache");
	invalidate(); // clear ALL modes — stale opposite-mode entries leak otherwise
	modelsInvalidatedPusher?.(authMode);
}

// Request handlers extracted as a top-level const so tests can exercise each
// one directly with mocked module deps, without having to spin up the
// Electrobun RPC transport. The object shape is validated against
// `PtolemyRPCSchema` when it's passed to `defineElectrobunRPC` below.
export const requestHandlers: BunRequestHandlers = {
	listApps: async () => {
		return scanApps();
	},
	openApp: async ({ path }) => {
		try {
			Bun.spawn(["open", "-a", path]);
			return true;
		} catch {
			return false;
		}
	},
	openUrl: async ({ url }) => {
		try {
			Bun.spawn(["open", url]);
			return true;
		} catch {
			return false;
		}
	},
	getAppIcon: async ({ path }) => {
		const icon = await getAppIconBase64(path);
		return { icon };
	},
	resizeWindow: async ({ height, width }) => {
		if (!mainWindowRef) return false;
		const frame = mainWindowRef.getFrame();
		const nextWidth = width ?? 630;
		// Idempotent no-op check first so StrictMode's double-fired effects
		// at startup (and any other duplicate calls) stay silent.
		if (frame.height === height && frame.width === nextWidth) return true;
		// Skip when the native window is hidden. Electrobun's setFrame on a
		// hidden NSWindow can implicitly reorder it back on-screen, which
		// races against orderOut from a recent hotkey-hide and produces a
		// "flicker, reopen on click-outside" loop documented in production.
		if (mainWindowVisibilityChecker && !mainWindowVisibilityChecker()) {
			console.log("[main] resizeWindow skipped (window hidden)");
			return true;
		}
		const newY = frame.y + (frame.height - height) / 2;
		const newX = frame.x + (frame.width - nextWidth) / 2;
		console.log(
			`[main] resizeWindow: ${frame.width}x${frame.height} -> ${nextWidth}x${height}`,
		);
		mainWindowRef.setFrame(newX, newY, nextWidth, height);
		return true;
	},
	loadSettings: async () => {
		return loadSettingsFromDisk();
	},
	saveSettings: async (next) => {
		const current = await loadSettingsFromDisk();
		const ok = await saveSettingsToDisk(next);
		if (ok && current.claude.authMode !== next.claude.authMode) {
			await invalidateModelsCache(next.claude.authMode);
		}
		return ok;
	},
	getProxyStatus: async () => {
		return getProxyStatusFromModule();
	},
	reloadProxyFromSystem: async () => {
		return reloadProxyFromSystemModule();
	},
	saveManualProxy: async (args) => {
		const host = args.host.trim();
		if (!host || /\s|\//.test(host)) {
			return { ok: false, error: "Host inválido" };
		}
		if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
			return { ok: false, error: "Porta deve estar entre 1 e 65535" };
		}
		if (args.protocol !== "http" && args.protocol !== "https") {
			return { ok: false, error: "Protocolo inválido" };
		}
		const username = args.username?.trim() || undefined;
		const ref = {
			service: PROXY_KEYCHAIN_SERVICE,
			account: manualAccountId({
				protocol: args.protocol,
				host,
				port: args.port,
			} as ManualProxySettings),
		};
		// Se senha foi fornecida, grava. Omitir mantém senha anterior.
		let hasPassword: boolean;
		if (args.password !== undefined) {
			if (args.password.length === 0) {
				// Senha explicitamente vazia → apagar entrada anterior.
				await deletePassword(ref);
				hasPassword = false;
			} else {
				const r = await setPassword(ref, args.password);
				if (!r.ok) {
					return { ok: false, error: r.error ?? "Falha no Keychain" };
				}
				hasPassword = true;
			}
		} else {
			const current = await loadSettingsFromDisk();
			hasPassword = current.proxy.manual?.hasPassword ?? false;
		}
		const manual: ManualProxySettings = {
			protocol: args.protocol,
			host,
			port: args.port,
			username,
			hasPassword,
			noProxy: args.noProxy.filter((x) => typeof x === "string"),
		};
		const current = await loadSettingsFromDisk();
		const saved = await saveSettingsToDisk({
			...current,
			proxy: { mode: "manual", manual },
		});
		if (!saved) {
			return { ok: false, error: "Falha ao gravar configurações" };
		}
		await initProxy("manual", manual);
		return { ok: true };
	},
	clearManualProxy: async () => {
		const current = await loadSettingsFromDisk();
		const m = current.proxy.manual;
		if (m) {
			await deletePassword({
				service: PROXY_KEYCHAIN_SERVICE,
				account: manualAccountId(m),
			});
		}
		await saveSettingsToDisk({
			...current,
			proxy: { mode: "auto" },
		});
		await initProxy("auto");
		return true;
	},
	testProxyConnection: async ({ testUrl } = {}) => {
		const url = testUrl ?? "https://api.github.com";
		const started = Date.now();
		try {
			const res = await fetchWithProxy(url, {
				signal: AbortSignal.timeout(10_000),
				headers: { "User-Agent": "Ptolemy-ProxyTest" },
			});
			return {
				ok: res.ok,
				status: res.status,
				latencyMs: Date.now() - started,
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				latencyMs: Date.now() - started,
			};
		}
	},
	githubGetTokenStatus: async () => {
		return getGithubTokenStatus();
	},
	githubSetToken: async ({ token }) => {
		const result = await setGithubToken(token);
		if (result.ok) {
			const current = await loadSettingsFromDisk();
			await saveSettingsToDisk({
				...current,
				github: { ...current.github, hasToken: true },
			});
		}
		return result;
	},
	githubDeleteToken: async () => {
		await deleteGithubToken();
		const current = await loadSettingsFromDisk();
		await saveSettingsToDisk({
			...current,
			github: { ...current.github, hasToken: false },
		});
		return true;
	},
	githubFetchSearch: async ({ subType, query }) => {
		const started = Date.now();
		const label =
			subType.kind === "native"
				? subType.type
				: `custom:${subType.filter.kind}:${subType.filter.name}`;
		try {
			const result = await githubFetchSearch({ subType, query });
			console.log(
				`[github] ${label} "${query}" → ${result.items.length} items ${
					result.cached ? "(cache)" : `(${Date.now() - started}ms)`
				}`,
			);
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[github] ${label} "${query}" failed after ${Date.now() - started}ms: ${message}`,
			);
			if (err instanceof Error && err.stack) {
				console.error(err.stack);
			}
			throw err;
		}
	},
	githubInvalidateCache: async () => {
		invalidateSearchCache();
		return true;
	},
	trackAnalyticsEvent: async ({ event, properties }) => {
		trackEvent(event, properties);
		return true;
	},
	setAnalyticsConsent: async ({ consentGiven }) => {
		setAnalyticsEnabled(consentGiven);
		return true;
	},
	agentListSkills: async ({ agent }) => skillsStore.list(agent),
	agentImportSkill: async ({ url }) => skillsStore.importGithub(url),
	agentSetDefaultSkills: async ({ agent, skillIds }) => {
		await skillsStore.setDefaults(agent, skillIds);
		return true;
	},
	claudeListSessions: async () => claudeListSessions(),
	claudeCreateSession: async ({
		prompt,
		projectId,
		agent,
		skillIds,
		mcpServerIds,
		model,
	}) => {
		const sessionId = await claudeCreateSession(prompt, {
			projectId,
			agent,
			skillIds,
			mcpServerIds,
			model,
		});
		console.log(
			`[claude:rpc] claudeCreateSession: auto-opening chat for sessionId=${sessionId}`,
		);
		openChatCallback?.(sessionId);
		try {
			const sessions = await claudeListSessions();
			sessionsUpdatePusher?.({ sessions });
		} catch (err) {
			console.error("[claude:rpc] claudeCreateSession push failed:", err);
		}
		return { sessionId };
	},
	claudeResumeSession: async ({ sessionId }) => claudeResumeSession(sessionId),
	claudeSendMessage: async ({ message, modelOverride }) => {
		await claudeSendMessage(
			message,
			modelOverride ? { modelOverride } : undefined,
		);
	},
	claudeStopGeneration: async () => claudeStopGeneration(),
	claudeDeleteSession: async ({ sessionId }) => {
		const ok = await claudeDeleteSession(sessionId);
		try {
			const sessions = await claudeListSessions();
			sessionsUpdatePusher?.({ sessions });
		} catch (err) {
			console.error("[claude:rpc] claudeDeleteSession push failed:", err);
		}
		return ok;
	},
	claudeGetSessionMessages: async ({ sessionId }) =>
		claudeGetSessionMessages(sessionId),
	claudeGetAuthStatus: async () => getClaudeAuthStatus(),
	claudeOpenLogin: async () => {
		const result = await openClaudeLogin();
		if (result.ok) {
			await invalidateModelsCache("anthropic");
		}
		return result;
	},
	claudeInstallCli: async () => installClaudeCli(),
	claudeSetBedrock: async (config) => {
		const ok = await setBedrockConfig(config);
		if (ok) {
			await invalidateModelsCache("bedrock");
		}
		return ok;
	},
	claudeGetBedrock: async () => getBedrockConfig(),
	claudeListSupportedModels: async () => {
		const settings = await loadSettingsFromDisk();
		const { authMode } = settings.claude;
		const { getModels } = await import("./claude/models-cache");
		const models = await getModels(authMode);
		return { models, authMode };
	},
	agentGetContextBreakdown: async ({ sessionId }) =>
		getContextBreakdown(sessionId),
	claudeSetSessionModel: async ({ sessionId, model }) => {
		const { setSessionModel } = await import("./claude/session-manager");
		const result = await setSessionModel(sessionId, model);
		if (result.ok) {
			return { ok: true };
		}
		// Narrow the discriminated union for the schema's optional reason field.
		return {
			ok: false,
			reason: result.reason as
				| "session-not-found"
				| "session-busy"
				| "sdk-error",
		};
	},
	claudeOpenChat: async ({ sessionId }) => {
		console.log(
			`[claude:rpc] claudeOpenChat: sessionId=${sessionId} hasCallback=${openChatCallback !== null}`,
		);
		openChatCallback?.(sessionId);
		return true;
	},
	codexGetAuthStatus: async () => getCodexAuthStatus(),
	codexOpenLogin: async () => openCodexLogin(),
	codexInstallCli: async () => installCodexCli(),
	codexListModels: async () => ({
		models: await listCodexModels(readConfiguredCodexModel),
	}),
	agentApproveTool: async ({ permissionId, behavior, modifiedArgs }) => {
		const ok = getPermissionGate().approve(
			permissionId,
			behavior,
			modifiedArgs,
		);
		console.log(
			`[claude:rpc] agentApproveTool: permissionId=${permissionId} behavior=${behavior} ok=${ok}`,
		);
		return ok;
	},
	agentRejectTool: async ({ permissionId, reason }) => {
		const ok = getPermissionGate().reject(permissionId, reason);
		console.log(
			`[claude:rpc] agentRejectTool: permissionId=${permissionId} ok=${ok}`,
		);
		return ok;
	},
	agentListMcpServers: async () => {
		const file = await mcpLoader.load();
		return file.servers;
	},
	agentSaveMcpServers: async ({ servers }) => {
		try {
			await mcpLoader.save({ version: 1, servers });
			console.log(`[claude:rpc] agentSaveMcpServers: count=${servers.length}`);
			return true;
		} catch (err) {
			console.error("[claude:rpc] agentSaveMcpServers failed:", err);
			return false;
		}
	},
};

// Electrobun's `rpc` object maintains ONE transport. When a BrowserWindow is
// created with `rpc`, its BrowserView calls `rpc.setTransport(...)` — so if
// two windows share the same rpc instance, the second window to be created
// silently replaces the transport, and every `rpc.send.*` call after that
// point goes to that second window. In practice this meant that once the
// chat window was opened, pushes intended for the palette (openPreferences,
// claudeSessionsUpdate) were routed to the chat view instead — and after the
// chat closed, the transport pointed at a dead webview and messages were
// dropped entirely. We work around this by creating one rpc instance per
// window and targeting them explicitly. Both share the same request
// handlers; they differ only in the transport Electrobun wires up.
function buildRpc() {
	return defineElectrobunRPC<PtolemyRPCSchema, "bun">("bun", {
		handlers: {
			requests: requestHandlers,
		},
	});
}

export const mainRpc = buildRpc();
export const chatRpc = buildRpc();

// Wire the late-bound sessions pusher so handlers can push claudeSessionsUpdate
// to the palette window. Done after `mainRpc` exists to avoid TDZ.
setSessionsUpdatePusher((args) => mainRpc.send.claudeSessionsUpdate(args));

// Wire the late-bound models invalidation pusher. Sends to both windows so
// the settings panel (mainview) and the chat header (chatview) can refresh.
// Uses BROADCAST_SESSION_ID ("") — a sentinel for events not scoped to a
// session. Subscribers that filter on sessionId must check for it explicitly.
setModelsInvalidatedPusher((authMode) => {
	const event: AgentEvent = { type: "models-cache-invalidated", authMode };
	mainRpc.send.agentEvent({ sessionId: BROADCAST_SESSION_ID, event });
	chatRpc.send.agentEvent({ sessionId: BROADCAST_SESSION_ID, event });
});

// Wire the streaming sender so session-manager can push stream events to the
// chat window specifically. Using chatRpc avoids the transport-swap problem
// that plagues a shared rpc instance.
//
// INVARIANT: openChatCallback must create the chat BrowserWindow
// SYNCHRONOUSLY before yielding, so that chatRpc's transport is wired before
// the streaming loop emits its first chunk. BrowserWindow's constructor does
// this today — it calls createStreams() → setTransport() synchronously
// during `new BrowserWindow(...)`. If that ever changes (e.g. someone
// introduces an `await` before the constructor, or lazy-creates the window),
// early `chatRpc.send.*` calls will throw `missingTransportMethodError` from
// shared/rpc.ts and the streaming loop will die silently. The guard below
// swallows that specific failure so a missed chunk doesn't kill the stream.
function safeSend(label: string, fn: () => void): void {
	try {
		fn();
	} catch (err) {
		console.error(
			`[chat:rpc] ${label} send failed (transport not ready?):`,
			err,
		);
	}
}
claudeSetSender({
	sendEvent: (sessionId, event) =>
		safeSend("agentEvent", () => chatRpc.send.agentEvent({ sessionId, event })),
});
