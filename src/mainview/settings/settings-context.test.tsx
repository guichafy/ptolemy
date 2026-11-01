import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSettings = vi.fn();
const saveSettings = vi.fn();
const saveManualProxyRpc = vi.fn();
const clearManualProxyRpc = vi.fn();
const testProxyConnection = vi.fn();
const setAnalyticsConsent = vi.fn();
let openPreferencesHandler:
	| ((args?: { section?: string | null }) => void)
	| null = null;

vi.mock("../providers/rpc", () => ({
	rpc: {
		request: {
			loadSettings,
			saveSettings,
			saveManualProxy: saveManualProxyRpc,
			clearManualProxy: clearManualProxyRpc,
			testProxyConnection,
			setAnalyticsConsent,
		},
	},
	setOpenPreferencesHandler: (handler: typeof openPreferencesHandler) => {
		openPreferencesHandler = handler;
	},
}));

vi.mock("../providers/registry", () => ({
	KNOWN_PLUGIN_IDS: ["apps", "github", "calc", "web", "claude", "codex"],
	DEFAULT_ENABLED_ORDER: ["apps", "github", "calc", "web", "claude"],
}));

const { SettingsProvider, useSettings } = await import("./settings-context");

function defaultRemoteSettings() {
	return {
		version: 1,
		plugins: { enabledOrder: ["github", "calc"] },
		github: { customFilters: [], hasToken: false },
		analytics: { consentGiven: false, anonymousId: "anon-1" },
		claude: {
			authMode: "anthropic" as const,
			model: "claude-sonnet-4-6",
			permissionMode: "acceptEdits" as const,
		},
		proxy: { mode: "auto" as const },
	};
}

function wrapper({ children }: { children: React.ReactNode }) {
	return <SettingsProvider>{children}</SettingsProvider>;
}

describe("SettingsProvider", () => {
	beforeEach(() => {
		loadSettings.mockReset();
		saveSettings.mockReset().mockResolvedValue(true);
		saveManualProxyRpc.mockReset().mockResolvedValue({ ok: true });
		clearManualProxyRpc.mockReset().mockResolvedValue(true);
		testProxyConnection.mockReset();
		setAnalyticsConsent.mockReset().mockResolvedValue(true);
		openPreferencesHandler = null;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("loads settings on mount and exposes enabledOrder", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());

		const { result } = renderHook(() => useSettings(), { wrapper });

		await waitFor(() => {
			expect(result.current.enabledOrder).toEqual(["github", "calc"]);
		});
		expect(result.current.settings).not.toBeNull();
	});

	it("falls back to defaults when loadSettings rejects", async () => {
		loadSettings.mockRejectedValue(new Error("fs broken"));

		const { result } = renderHook(() => useSettings(), { wrapper });

		await waitFor(() => {
			expect(result.current.settings).not.toBeNull();
		});
		expect(result.current.enabledOrder).toEqual([
			"apps",
			"github",
			"calc",
			"web",
			"claude",
		]);
	});

	it("sanitizes unknown plugin ids and duplicates out of enabledOrder", async () => {
		loadSettings.mockResolvedValue({
			...defaultRemoteSettings(),
			plugins: {
				enabledOrder: ["github", "github", "does-not-exist", "calc"],
			},
		});

		const { result } = renderHook(() => useSettings(), { wrapper });

		await waitFor(() => {
			expect(result.current.enabledOrder).toEqual(["github", "calc"]);
		});
	});

	it("debounces saveSettings on updateEnabledOrder", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());

		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		vi.useFakeTimers({ shouldAdvanceTime: true });
		act(() => {
			result.current.updateEnabledOrder(["calc", "github"]);
		});
		expect(saveSettings).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(160);
		});

		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(saveSettings.mock.calls[0][0].plugins.enabledOrder).toEqual([
			"calc",
			"github",
		]);
	});

	it("coalesces rapid updates into a single save call", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());

		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		vi.useFakeTimers({ shouldAdvanceTime: true });
		act(() => {
			result.current.updateEnabledOrder(["github"]);
			result.current.updateEnabledOrder(["calc", "github"]);
			result.current.updateEnabledOrder(["apps", "github"]);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(160);
		});

		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(saveSettings.mock.calls[0][0].plugins.enabledOrder).toEqual([
			"apps",
			"github",
		]);
	});

	it("updateCustomFilters persists new filters", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		vi.useFakeTimers({ shouldAdvanceTime: true });
		act(() => {
			result.current.updateCustomFilters([
				{
					id: "f1",
					kind: "search",
					name: "Ptolemy issues",
					baseType: "issues",
					qualifiers: "repo:guichafy/ptolemy",
				},
			]);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(160);
		});

		expect(result.current.customFilters).toHaveLength(1);
		expect(saveSettings.mock.calls[0][0].github.customFilters[0].id).toBe("f1");
	});

	it("updateAnalyticsConsent also calls setAnalyticsConsent RPC", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		vi.useFakeTimers({ shouldAdvanceTime: true });
		act(() => {
			result.current.updateAnalyticsConsent(true);
		});

		expect(setAnalyticsConsent).toHaveBeenCalledWith({ consentGiven: true });

		await act(async () => {
			await vi.advanceTimersByTimeAsync(160);
		});
		expect(saveSettings.mock.calls[0][0].analytics.consentGiven).toBe(true);
	});

	it("saveManualProxy forwards trimmed host and parsed noProxy list, then reloads settings", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		loadSettings.mockResolvedValue({
			...defaultRemoteSettings(),
			proxy: {
				mode: "manual",
				manual: {
					protocol: "http",
					host: "proxy.local",
					port: 8080,
					hasPassword: false,
					noProxy: ["localhost", "127.0.0.1"],
				},
			},
		});

		await act(async () => {
			await result.current.saveManualProxy({
				protocol: "http",
				host: "  proxy.local  ",
				port: 8080,
				username: " user ",
				password: "secret",
				noProxy: "localhost\n127.0.0.1,  ,",
				changePassword: true,
			});
		});

		expect(saveManualProxyRpc).toHaveBeenCalledWith({
			protocol: "http",
			host: "proxy.local",
			port: 8080,
			username: "user",
			password: "secret",
			noProxy: ["localhost", "127.0.0.1"],
		});
		expect(result.current.proxySettings.mode).toBe("manual");
	});

	it("saveManualProxy omits password when changePassword is false", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		await act(async () => {
			await result.current.saveManualProxy({
				protocol: "http",
				host: "proxy.local",
				port: 8080,
				username: "",
				password: "will-be-ignored",
				noProxy: "",
				changePassword: false,
			});
		});

		expect(saveManualProxyRpc.mock.calls[0][0].password).toBeUndefined();
	});

	it("testProxyConnection returns error shape when RPC throws", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		testProxyConnection.mockRejectedValue(new Error("boom"));

		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		let probe: Awaited<ReturnType<typeof result.current.testProxyConnection>>;
		await act(async () => {
			probe = await result.current.testProxyConnection();
		});

		expect(probe!.ok).toBe(false);
		expect(probe!.error).toBe("boom");
	});

	it("openDialog / closeDialog toggle isOpen", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		expect(result.current.isOpen).toBe(false);

		act(() => result.current.openDialog("plugins"));
		expect(result.current.isOpen).toBe(true);
		expect(result.current.initialSection).toBe("plugins");

		act(() => result.current.closeDialog());
		expect(result.current.isOpen).toBe(false);
		expect(result.current.initialSection).toBeNull();
	});

	it("openPreferences message from main process opens dialog", async () => {
		loadSettings.mockResolvedValue(defaultRemoteSettings());
		const { result } = renderHook(() => useSettings(), { wrapper });
		await waitFor(() => expect(result.current.settings).not.toBeNull());

		act(() => {
			openPreferencesHandler?.({ section: "network" });
		});

		expect(result.current.isOpen).toBe(true);
		expect(result.current.initialSection).toBe("network");
	});
});
