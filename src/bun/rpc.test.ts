import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all module deps of rpc.ts so we can import it and test handlers
// without spinning up the Electrobun transport. The handlers object is
// exported as `requestHandlers`.

const loadSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
const getGithubTokenStatusMock = vi.fn();
const setGithubTokenMock = vi.fn();
const deleteGithubTokenMock = vi.fn();
const githubFetchSearchMock = vi.fn();
const invalidateSearchCacheMock = vi.fn();
const trackEventMock = vi.fn();
const setAnalyticsEnabledMock = vi.fn();
const claudeListSessionsMock = vi.fn();
const claudeCreateSessionMock = vi.fn();
const claudeResumeSessionMock = vi.fn();
const claudeSendMessageMock = vi.fn();
const claudeStopGenerationMock = vi.fn();
const claudeDeleteSessionMock = vi.fn();
const claudeGetSessionMessagesMock = vi.fn();
const getClaudeAuthStatusMock = vi.fn();
const openClaudeLoginMock = vi.fn();
const installClaudeCliMock = vi.fn();
const setBedrockConfigMock = vi.fn();
const getBedrockConfigMock = vi.fn();
const claudeSetSenderMock = vi.fn();
const getPermissionGateMock = vi.fn();
const mcpLoaderMock = { load: vi.fn(), save: vi.fn() };
const fetchWithProxyMock = vi.fn();
const getProxyStatusFromModuleMock = vi.fn();
const reloadProxyFromSystemModuleMock = vi.fn();
const initProxyMock = vi.fn();
const manualAccountIdMock = vi.fn(
	(m: { protocol: string; host: string; port: number }) =>
		`${m.protocol}://${m.host}:${m.port}`,
);
const setPasswordMock = vi.fn();
const deletePasswordMock = vi.fn();

vi.mock("./settings", () => ({
	loadSettings: loadSettingsMock,
	saveSettings: saveSettingsMock,
}));
vi.mock("./github-token", () => ({
	getStatus: getGithubTokenStatusMock,
	setToken: setGithubTokenMock,
	deleteToken: deleteGithubTokenMock,
}));
vi.mock("./github/github-fetch", () => ({
	githubFetchSearch: githubFetchSearchMock,
}));
vi.mock("./github/search-cache", () => ({
	invalidateAll: invalidateSearchCacheMock,
}));
vi.mock("./analytics", () => ({
	trackEvent: trackEventMock,
	setAnalyticsEnabled: setAnalyticsEnabledMock,
}));
vi.mock("./claude/session-manager", () => ({
	listSessions: claudeListSessionsMock,
	createSession: claudeCreateSessionMock,
	resumeSession: claudeResumeSessionMock,
	sendMessage: claudeSendMessageMock,
	stopGeneration: claudeStopGenerationMock,
	deleteSession: claudeDeleteSessionMock,
	getSessionMessages: claudeGetSessionMessagesMock,
	setSender: claudeSetSenderMock,
	getPermissionGate: getPermissionGateMock,
	getSessionCommands: vi.fn(),
	getSessionResources: vi.fn(),
}));
vi.mock("./claude/auth", () => ({
	getClaudeAuthStatus: getClaudeAuthStatusMock,
	openClaudeLogin: openClaudeLoginMock,
	installClaudeCli: installClaudeCliMock,
	setBedrockConfig: setBedrockConfigMock,
	getBedrockConfig: getBedrockConfigMock,
}));
vi.mock("./claude/mcp-loader", () => ({
	mcpLoader: mcpLoaderMock,
}));
vi.mock("./net/proxy", () => ({
	fetchWithProxy: fetchWithProxyMock,
	getProxyStatus: getProxyStatusFromModuleMock,
	reloadFromSystem: reloadProxyFromSystemModuleMock,
	initProxy: initProxyMock,
	manualAccountId: manualAccountIdMock,
	PROXY_KEYCHAIN_SERVICE: "com.ptolomeu.app.proxy",
}));
vi.mock("./keychain", () => ({
	setPassword: setPasswordMock,
	deletePassword: deletePasswordMock,
}));

// Stub Electrobun — defineElectrobunRPC returns a fake rpc instance so
// importing rpc.ts doesn't crash on `mainRpc.send.claudeSessionsUpdate`.
const fakeSend = {
	claudeSessionsUpdate: vi.fn(),
	agentEvent: vi.fn(),
	openPreferences: vi.fn(),
	claudeOpenSession: vi.fn(),
};
vi.mock("electrobun/bun", () => ({
	defineElectrobunRPC: () => ({ send: fakeSend }),
}));

const { requestHandlers, setSessionsUpdatePusher } = await import("./rpc");

describe("rpc.requestHandlers", () => {
	beforeEach(() => {
		for (const fn of [
			loadSettingsMock,
			saveSettingsMock,
			getGithubTokenStatusMock,
			setGithubTokenMock,
			deleteGithubTokenMock,
			githubFetchSearchMock,
			invalidateSearchCacheMock,
			trackEventMock,
			setAnalyticsEnabledMock,
			claudeListSessionsMock,
			claudeCreateSessionMock,
			claudeDeleteSessionMock,
			getPermissionGateMock,
			fetchWithProxyMock,
			initProxyMock,
			setPasswordMock,
			deletePasswordMock,
			mcpLoaderMock.load,
			mcpLoaderMock.save,
		]) {
			fn.mockReset();
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("every schema handler is implemented (smoke)", () => {
		it("requestHandlers is a non-empty object", () => {
			expect(typeof requestHandlers).toBe("object");
			expect(Object.keys(requestHandlers).length).toBeGreaterThan(20);
		});

		it.each([
			"listApps",
			"openApp",
			"openUrl",
			"getAppIcon",
			"resizeWindow",
			"loadSettings",
			"saveSettings",
			"getProxyStatus",
			"reloadProxyFromSystem",
			"saveManualProxy",
			"clearManualProxy",
			"testProxyConnection",
			"githubGetTokenStatus",
			"githubSetToken",
			"githubDeleteToken",
			"githubFetchSearch",
			"githubInvalidateCache",
			"trackAnalyticsEvent",
			"setAnalyticsConsent",
			"claudeListSessions",
			"claudeCreateSession",
			"claudeResumeSession",
			"claudeSendMessage",
			"claudeStopGeneration",
			"claudeDeleteSession",
			"claudeGetSessionMessages",
			"claudeGetAuthStatus",
			"claudeOpenLogin",
			"claudeInstallCli",
			"claudeSetBedrock",
			"claudeGetBedrock",
			"claudeOpenChat",
			"agentApproveTool",
			"agentRejectTool",
			"agentMcpList",
			"agentMcpSave",
		])("%s handler is a function", (name) => {
			const handler = (requestHandlers as unknown as Record<string, unknown>)[
				name
			];
			expect(typeof handler).toBe("function");
		});
	});

	describe("saveManualProxy validation", () => {
		it("rejects host with spaces", async () => {
			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "bad host",
				port: 8080,
				noProxy: [],
			});
			expect(r).toEqual({ ok: false, error: "Host inválido" });
		});

		it("rejects empty host (after trim)", async () => {
			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "   ",
				port: 8080,
				noProxy: [],
			});
			expect(r).toEqual({ ok: false, error: "Host inválido" });
		});

		it("rejects host with slashes", async () => {
			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy/bad",
				port: 8080,
				noProxy: [],
			});
			expect(r).toEqual({ ok: false, error: "Host inválido" });
		});

		it("rejects non-integer port", async () => {
			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy",
				port: 8080.5,
				noProxy: [],
			});
			expect(r.ok).toBe(false);
			expect(r.error).toMatch(/Porta/);
		});

		it("rejects port out of range (0, 65536)", async () => {
			const low = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy",
				port: 0,
				noProxy: [],
			});
			const high = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy",
				port: 70000,
				noProxy: [],
			});
			expect(low.ok).toBe(false);
			expect(high.ok).toBe(false);
		});

		it("rejects invalid protocol", async () => {
			const r = await requestHandlers.saveManualProxy({
				protocol: "ftp" as unknown as "http",
				host: "proxy",
				port: 8080,
				noProxy: [],
			});
			expect(r).toEqual({ ok: false, error: "Protocolo inválido" });
		});

		it("accepts valid input, writes password to Keychain, saves settings, inits proxy", async () => {
			setPasswordMock.mockResolvedValue({ ok: true });
			loadSettingsMock.mockResolvedValue({
				version: 1,
				plugins: { enabledOrder: ["github"] },
				github: { customFilters: [], hasToken: false },
				analytics: { consentGiven: false, anonymousId: "a" },
				claude: {
					authMode: "anthropic",
					model: "x",
					permissionMode: "acceptEdits",
				},
				proxy: { mode: "auto" },
			});
			saveSettingsMock.mockResolvedValue(true);
			initProxyMock.mockResolvedValue(undefined);

			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "  proxy.local  ",
				port: 8080,
				username: " me ",
				password: "s3cret",
				noProxy: ["localhost", 42 as unknown as string, "example.com"],
			});

			expect(r).toEqual({ ok: true });
			expect(setPasswordMock).toHaveBeenCalledWith(
				expect.objectContaining({ service: "com.ptolomeu.app.proxy" }),
				"s3cret",
			);
			// numeric noProxy entry was filtered out
			expect(saveSettingsMock.mock.calls[0][0].proxy.manual.noProxy).toEqual([
				"localhost",
				"example.com",
			]);
			// host was trimmed
			expect(saveSettingsMock.mock.calls[0][0].proxy.manual.host).toBe(
				"proxy.local",
			);
			expect(initProxyMock).toHaveBeenCalledWith(
				"manual",
				expect.objectContaining({ host: "proxy.local", hasPassword: true }),
			);
		});

		it("empty password deletes Keychain entry and persists hasPassword=false", async () => {
			deletePasswordMock.mockResolvedValue({ ok: true });
			loadSettingsMock.mockResolvedValue({
				version: 1,
				plugins: { enabledOrder: ["github"] },
				github: { customFilters: [], hasToken: false },
				analytics: { consentGiven: false, anonymousId: "a" },
				claude: {
					authMode: "anthropic",
					model: "x",
					permissionMode: "acceptEdits",
				},
				proxy: { mode: "auto" },
			});
			saveSettingsMock.mockResolvedValue(true);

			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy.local",
				port: 8080,
				password: "",
				noProxy: [],
			});

			expect(r.ok).toBe(true);
			expect(deletePasswordMock).toHaveBeenCalled();
			expect(setPasswordMock).not.toHaveBeenCalled();
			expect(saveSettingsMock.mock.calls[0][0].proxy.manual.hasPassword).toBe(
				false,
			);
		});

		it("omitted password preserves previous hasPassword from settings", async () => {
			loadSettingsMock.mockResolvedValue({
				version: 1,
				plugins: { enabledOrder: ["github"] },
				github: { customFilters: [], hasToken: false },
				analytics: { consentGiven: false, anonymousId: "a" },
				claude: {
					authMode: "anthropic",
					model: "x",
					permissionMode: "acceptEdits",
				},
				proxy: {
					mode: "manual",
					manual: {
						protocol: "http" as const,
						host: "old",
						port: 1,
						hasPassword: true,
						noProxy: [],
					},
				},
			});
			saveSettingsMock.mockResolvedValue(true);

			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy.local",
				port: 8080,
				noProxy: [],
			});

			expect(r.ok).toBe(true);
			expect(setPasswordMock).not.toHaveBeenCalled();
			expect(deletePasswordMock).not.toHaveBeenCalled();
			expect(saveSettingsMock.mock.calls[0][0].proxy.manual.hasPassword).toBe(
				true,
			);
		});

		it("propagates Keychain error as validation error", async () => {
			setPasswordMock.mockResolvedValue({ ok: false, error: "No access" });

			const r = await requestHandlers.saveManualProxy({
				protocol: "http",
				host: "proxy.local",
				port: 8080,
				password: "s3cret",
				noProxy: [],
			});

			expect(r).toEqual({ ok: false, error: "No access" });
			expect(saveSettingsMock).not.toHaveBeenCalled();
		});
	});

	describe("githubSetToken + deleteToken", () => {
		it("setToken on success flips hasToken=true in settings", async () => {
			setGithubTokenMock.mockResolvedValue({ ok: true, login: "guichafy" });
			loadSettingsMock.mockResolvedValue({
				version: 1,
				plugins: { enabledOrder: ["github"] },
				github: { customFilters: [], hasToken: false },
				analytics: { consentGiven: false, anonymousId: "a" },
				claude: {
					authMode: "anthropic",
					model: "x",
					permissionMode: "acceptEdits",
				},
				proxy: { mode: "auto" },
			});
			saveSettingsMock.mockResolvedValue(true);

			const r = await requestHandlers.githubSetToken({ token: "ghp_xxx" });
			expect(r.ok).toBe(true);
			expect(saveSettingsMock.mock.calls[0][0].github.hasToken).toBe(true);
		});

		it("setToken on failure leaves settings untouched", async () => {
			setGithubTokenMock.mockResolvedValue({ ok: false, error: "bad" });
			const r = await requestHandlers.githubSetToken({ token: "bogus" });
			expect(r.ok).toBe(false);
			expect(saveSettingsMock).not.toHaveBeenCalled();
		});

		it("deleteToken flips hasToken=false", async () => {
			deleteGithubTokenMock.mockResolvedValue(true);
			loadSettingsMock.mockResolvedValue({
				version: 1,
				plugins: { enabledOrder: ["github"] },
				github: { customFilters: [], hasToken: true },
				analytics: { consentGiven: false, anonymousId: "a" },
				claude: {
					authMode: "anthropic",
					model: "x",
					permissionMode: "acceptEdits",
				},
				proxy: { mode: "auto" },
			});
			saveSettingsMock.mockResolvedValue(true);

			const r = await requestHandlers.githubDeleteToken();
			expect(r).toBe(true);
			expect(saveSettingsMock.mock.calls[0][0].github.hasToken).toBe(false);
		});
	});

	describe("claudeCreateSession pushes updated session list", () => {
		it("calls sessionsUpdatePusher with the reloaded sessions", async () => {
			claudeCreateSessionMock.mockResolvedValue("new-sid");
			claudeListSessionsMock.mockResolvedValue([
				{ id: "new-sid", title: "hi" },
			]);
			const pusher = vi.fn();
			setSessionsUpdatePusher(pusher);

			const r = await requestHandlers.claudeCreateSession({ prompt: "hello" });

			expect(r).toEqual({ sessionId: "new-sid" });
			expect(pusher).toHaveBeenCalledWith({
				sessions: [{ id: "new-sid", title: "hi" }],
			});
		});

		it("swallows push errors without failing the create call", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			claudeCreateSessionMock.mockResolvedValue("sid-2");
			claudeListSessionsMock.mockRejectedValue(new Error("network"));
			setSessionsUpdatePusher(vi.fn());

			const r = await requestHandlers.claudeCreateSession({ prompt: "x" });
			expect(r).toEqual({ sessionId: "sid-2" });
		});
	});

	it("retires plaintext MCP RPC methods", () => {
		expect("agentSaveMcpServers" in requestHandlers).toBe(false);
		expect("agentListMcpServers" in requestHandlers).toBe(false);
	});

	describe("githubFetchSearch", () => {
		it("passes through results and logs cached vs elapsed", async () => {
			vi.spyOn(console, "log").mockImplementation(() => {});
			githubFetchSearchMock.mockResolvedValue({ items: [], cached: true });
			const r = await requestHandlers.githubFetchSearch({
				subType: { kind: "native", type: "repos" },
				query: "react",
			});
			expect(r.cached).toBe(true);
		});

		it("rethrows backend errors", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			githubFetchSearchMock.mockRejectedValue(new Error("rate limit"));
			await expect(
				requestHandlers.githubFetchSearch({
					subType: { kind: "native", type: "repos" },
					query: "q",
				}),
			).rejects.toThrow("rate limit");
		});
	});

	describe("testProxyConnection", () => {
		it("returns ok=true for 2xx response", async () => {
			fetchWithProxyMock.mockResolvedValue({ ok: true, status: 200 });
			const r = await requestHandlers.testProxyConnection({});
			expect(r.ok).toBe(true);
			expect(r.status).toBe(200);
		});

		it("captures fetch errors into the response", async () => {
			fetchWithProxyMock.mockRejectedValue(new Error("timeout"));
			const r = await requestHandlers.testProxyConnection({});
			expect(r.ok).toBe(false);
			expect(r.error).toBe("timeout");
		});
	});
});
