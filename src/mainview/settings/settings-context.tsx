import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { DEFAULT_ENABLED_ORDER, KNOWN_PLUGIN_IDS } from "../providers/registry";
import {
	type AnalyticsSettings,
	type ClaudeSettings,
	type CodexSettings,
	type CustomFilter,
	type ManualProxyProtocol,
	type ProxyMode,
	type ProxySettings,
	rpc,
	type Settings,
	type SettingsSection,
	setOpenPreferencesHandler,
} from "../providers/rpc";

export interface ManualProxyDraft {
	protocol: ManualProxyProtocol;
	host: string;
	port: number;
	username: string;
	/** string vazia = não alterar senha; usado quando hasPassword já é true. */
	password: string;
	noProxy: string;
}

export interface TestProxyResult {
	ok: boolean;
	status?: number;
	latencyMs: number;
	error?: string;
}

interface SettingsContextValue {
	settings: Settings | null;
	enabledOrder: string[];
	updateEnabledOrder: (next: string[]) => void;
	customFilters: CustomFilter[];
	updateCustomFilters: (next: CustomFilter[]) => void;
	analyticsSettings: AnalyticsSettings;
	updateAnalyticsConsent: (consentGiven: boolean) => void;
	proxySettings: ProxySettings;
	updateProxyMode: (mode: ProxyMode) => void;
	codexSettings: CodexSettings;
	updateCodexSettings: (patch: Partial<CodexSettings>) => void;
	saveManualProxy: (
		draft: ManualProxyDraft & { changePassword: boolean },
	) => Promise<{ ok: boolean; error?: string }>;
	clearManualProxy: () => Promise<void>;
	testProxyConnection: () => Promise<TestProxyResult>;
	isOpen: boolean;
	initialSection: SettingsSection | null;
	openDialog: (section?: SettingsSection) => void;
	closeDialog: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const SAVE_DEBOUNCE_MS = 150;
const MIN_ACTIVE = 1;
const MAX_ACTIVE = 5;

const DEFAULT_GITHUB = {
	customFilters: [] as CustomFilter[],
	hasToken: false,
};

const DEFAULT_ANALYTICS: AnalyticsSettings = {
	consentGiven: false,
	anonymousId: "",
};

const DEFAULT_CLAUDE: ClaudeSettings = {
	authMode: "anthropic",
	model: "claude-sonnet-4-6",
	permissionMode: "acceptEdits",
};

const DEFAULT_CODEX: CodexSettings = {
	model: "default",
	sandboxMode: "workspace-write",
	reasoningEffort: "",
};

const DEFAULT_PROXY: ProxySettings = {
	mode: "auto",
};

function sanitizeOrder(order: string[]): string[] {
	const seen = new Set<string>();
	const clean: string[] = [];
	for (const id of order) {
		if (!KNOWN_PLUGIN_IDS.includes(id)) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		clean.push(id);
	}
	if (clean.length < MIN_ACTIVE) {
		for (const fallback of KNOWN_PLUGIN_IDS) {
			if (clean.length >= MIN_ACTIVE) break;
			if (!seen.has(fallback)) {
				clean.push(fallback);
				seen.add(fallback);
			}
		}
	}
	return clean.slice(0, MAX_ACTIVE);
}

function normalizeSettings(loaded: Settings): Settings {
	return {
		...loaded,
		plugins: {
			...loaded.plugins,
			enabledOrder: sanitizeOrder(loaded.plugins.enabledOrder),
		},
		github: loaded.github ?? DEFAULT_GITHUB,
		analytics: loaded.analytics ?? DEFAULT_ANALYTICS,
		claude: loaded.claude ?? DEFAULT_CLAUDE,
		codex: loaded.codex ?? DEFAULT_CODEX,
		proxy: loaded.proxy ?? DEFAULT_PROXY,
	};
}

function fallbackSettings(
	order: string[] = [...DEFAULT_ENABLED_ORDER],
): Settings {
	return {
		version: 1,
		plugins: { enabledOrder: order },
		github: DEFAULT_GITHUB,
		analytics: DEFAULT_ANALYTICS,
		claude: DEFAULT_CLAUDE,
		codex: DEFAULT_CODEX,
		proxy: DEFAULT_PROXY,
	};
}

export function SettingsProvider({ children }: { children: ReactNode }) {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [initialSection, setInitialSection] = useState<SettingsSection | null>(
		null,
	);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		let cancelled = false;
		rpc.request
			.loadSettings()
			.then((loaded) => {
				if (!cancelled) setSettings(normalizeSettings(loaded));
			})
			.catch(() => {
				if (!cancelled) {
					setSettings(fallbackSettings());
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setOpenPreferencesHandler((args) => {
			setInitialSection(args?.section ?? null);
			setIsOpen(true);
		});
		return () => setOpenPreferencesHandler(null);
	}, []);

	const scheduleSave = useCallback((next: Settings) => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			rpc.request.saveSettings(next).catch(() => {});
		}, SAVE_DEBOUNCE_MS);
	}, []);

	const updateEnabledOrder = useCallback(
		(next: string[]) => {
			const clean = sanitizeOrder(next);
			setSettings((prev) => {
				const base = prev ?? fallbackSettings(clean);
				const updated: Settings = {
					...base,
					plugins: { ...base.plugins, enabledOrder: clean },
				};
				scheduleSave(updated);
				return updated;
			});
		},
		[scheduleSave],
	);

	const updateCustomFilters = useCallback(
		(next: CustomFilter[]) => {
			setSettings((prev) => {
				const base = prev ?? fallbackSettings();
				const updated: Settings = {
					...base,
					github: { ...base.github, customFilters: next },
				};
				scheduleSave(updated);
				return updated;
			});
		},
		[scheduleSave],
	);

	const updateAnalyticsConsent = useCallback(
		(consentGiven: boolean) => {
			setSettings((prev) => {
				const base = prev ?? fallbackSettings();
				const updated: Settings = {
					...base,
					analytics: { ...base.analytics, consentGiven },
				};
				scheduleSave(updated);
				rpc.request.setAnalyticsConsent({ consentGiven }).catch(() => {});
				return updated;
			});
		},
		[scheduleSave],
	);

	const updateCodexSettings = useCallback(
		(patch: Partial<CodexSettings>) => {
			setSettings((prev) => {
				const base = prev ?? fallbackSettings();
				const updated: Settings = {
					...base,
					codex: { ...(base.codex ?? DEFAULT_CODEX), ...patch },
				};
				scheduleSave(updated);
				return updated;
			});
		},
		[scheduleSave],
	);

	const updateProxyMode = useCallback(
		(mode: ProxyMode) => {
			setSettings((prev) => {
				const base = prev ?? fallbackSettings();
				const updated: Settings = {
					...base,
					proxy: { ...base.proxy, mode },
				};
				scheduleSave(updated);
				return updated;
			});
		},
		[scheduleSave],
	);

	const saveManualProxy = useCallback(
		async (draft: ManualProxyDraft & { changePassword: boolean }) => {
			const noProxy = draft.noProxy
				.split(/\r?\n|,/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			const result = await rpc.request.saveManualProxy({
				protocol: draft.protocol,
				host: draft.host.trim(),
				port: draft.port,
				username: draft.username.trim() || undefined,
				// Apenas envia password quando o usuário explicitamente quer alterar.
				password: draft.changePassword ? draft.password : undefined,
				noProxy,
			});
			if (result.ok) {
				try {
					const loaded = await rpc.request.loadSettings();
					setSettings(loaded);
				} catch {
					/* mantém estado atual — UI reflete tentativa */
				}
			}
			return result;
		},
		[],
	);

	const clearManualProxy = useCallback(async () => {
		await rpc.request.clearManualProxy();
		try {
			const loaded = await rpc.request.loadSettings();
			setSettings(loaded);
		} catch {
			/* noop */
		}
	}, []);

	const testProxyConnection =
		useCallback(async (): Promise<TestProxyResult> => {
			try {
				return await rpc.request.testProxyConnection({});
			} catch (err) {
				return {
					ok: false,
					latencyMs: 0,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}, []);

	const openDialog = useCallback((section?: SettingsSection) => {
		setInitialSection(section ?? null);
		setIsOpen(true);
	}, []);
	const closeDialog = useCallback(() => {
		setIsOpen(false);
		setInitialSection(null);
	}, []);

	const enabledOrder = settings?.plugins.enabledOrder ?? [];
	const customFilters = settings?.github.customFilters ?? [];
	const analyticsSettings = settings?.analytics ?? DEFAULT_ANALYTICS;
	const proxySettings = settings?.proxy ?? DEFAULT_PROXY;
	const codexSettings = settings?.codex ?? DEFAULT_CODEX;

	return (
		<SettingsContext.Provider
			value={{
				settings,
				enabledOrder,
				updateEnabledOrder,
				customFilters,
				updateCustomFilters,
				analyticsSettings,
				updateAnalyticsConsent,
				proxySettings,
				updateProxyMode,
				codexSettings,
				updateCodexSettings,
				saveManualProxy,
				clearManualProxy,
				testProxyConnection,
				isOpen,
				initialSection,
				openDialog,
				closeDialog,
			}}
		>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings() {
	const ctx = useContext(SettingsContext);
	if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
	return ctx;
}
