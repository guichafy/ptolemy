import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { initRendererAnalytics, shutdownRendererAnalytics } from "./analytics";
import { AgentComposer } from "./components/agent-composer";
import { CalculatorResult } from "./components/calculator-result";
import { ModeBar } from "./components/mode-bar";
import { ResultItem } from "./components/result-item";
import { SearchInput } from "./components/search-input";
import {
	SearchTypeCombobox,
	type SearchTypeComboboxHandle,
} from "./components/search-type-combobox";
import { useWindowShown } from "./hooks/use-window-shown";
import {
	agentForProviderId,
	sessionsForAgent,
	sessionToResult,
} from "./providers/agent-sessions";
import { GitHubProvider, useGitHub } from "./providers/github-context";
import {
	ProviderContextProvider,
	useProvider,
} from "./providers/provider-context";
import { rpc, setClaudeSessionsUpdateHandler } from "./providers/rpc";
import type { SearchResult } from "./providers/types";
import { SettingsProvider, useSettings } from "./settings/settings-context";
import { SettingsDialog } from "./settings/settings-dialog";

const COLLAPSED_HEIGHT = 120;
const EXPANDED_HEIGHT = 440;
const SETTINGS_HEIGHT = 760;
const SETTINGS_WIDTH = 1080;
const DEFAULT_WIDTH = 630;

function PaletteContent() {
	const { activeProvider, cycleNext, cyclePrev } = useProvider();
	const agent = agentForProviderId(activeProvider.id);
	const {
		activeSubType,
		setSubType,
		customFilters,
		setLastSearchCached,
		lastSearchCached,
	} = useGitHub();
	const comboboxRef = useRef<SearchTypeComboboxHandle>(null);
	const providerContext = useMemo(
		() =>
			activeProvider.id === "github"
				? { subType: activeSubType, onCacheStatus: setLastSearchCached }
				: undefined,
		[activeProvider.id, activeSubType, setLastSearchCached],
	);
	const { isOpen: isSettingsOpen } = useSettings();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isComboboxOpen, setIsComboboxOpen] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const prevProviderRef = useRef(activeProvider.id);
	const resultsQueryRef = useRef("");

	// Reset state when provider changes
	useEffect(() => {
		if (prevProviderRef.current !== activeProvider.id) {
			setQuery("");
			setResults([]);
			setError(null);
			setSelectedIndex(0);
			setLastSearchCached(null);
			resultsQueryRef.current = "";
			prevProviderRef.current = activeProvider.id;
		}
	}, [activeProvider.id, setLastSearchCached]);

	// Reset cache indicator when the user starts typing a new query
	const handleQueryChange = useCallback(
		(next: string) => {
			setQuery(next);
			setLastSearchCached(null);
		},
		[setLastSearchCached],
	);

	const clearPalette = useCallback(() => {
		setQuery("");
		setResults([]);
		setError(null);
		setSelectedIndex(0);
		resultsQueryRef.current = "";
	}, []);

	const selectResult = useCallback(
		(result: SearchResult) => {
			result.onSelect();
			clearPalette();
		},
		[clearPalette],
	);

	const handleSearch = useCallback(async () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setIsLoading(true);
		setError(null);
		setSelectedIndex(0);

		// For Claude's "recent sessions" view (empty query), the backend can
		// push authoritative data at any moment. A parallel RPC that returns
		// [] — whether legitimately or due to a transient webview/RPC failure —
		// must not clobber a populated list that arrived via push. Use the
		// functional setter to compare against the latest state.
		const preserveOnEmpty = agent !== null;

		try {
			const items = await activeProvider.search(
				agent ? "" : query,
				controller.signal,
				providerContext,
			);
			if (!controller.signal.aborted) {
				setResults((prev) => {
					if (preserveOnEmpty && items.length === 0 && prev.length > 0) {
						return prev;
					}
					return items;
				});
				resultsQueryRef.current = query;
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			if (!controller.signal.aborted) {
				setError(err instanceof Error ? err.message : "Erro desconhecido");
				setResults((prev) => (preserveOnEmpty && prev.length > 0 ? prev : []));
				resultsQueryRef.current = "";
			}
		} finally {
			if (!controller.signal.aborted) {
				setIsLoading(false);
			}
		}
	}, [activeProvider, query, providerContext, agent]);

	// Auto-search for calculator (real-time), apps (on any change), and the
	// agent plugins (Claude / Codex recent sessions)
	useEffect(() => {
		if (
			activeProvider.id === "calc" ||
			activeProvider.id === "apps" ||
			agentForProviderId(activeProvider.id) !== null
		) {
			const timer = setTimeout(
				handleSearch,
				activeProvider.id === "calc"
					? 100
					: activeProvider.id === "apps"
						? 80
						: 300,
			);
			return () => clearTimeout(timer);
		}
	}, [activeProvider.id, handleSearch]);

	// Primary refresh trigger: the backend pushes the Claude session list
	// whenever the main window gains focus (tray click, hotkey, reactivation).
	// Pushing from bun bypasses webview quirks entirely — the mainview
	// webview can be suspended by WebKit after the chat window is shown, and
	// outbound RPCs from this renderer have been seen to be dropped in that
	// state. The backend is always the authoritative source for sessions.
	useEffect(() => {
		setClaudeSessionsUpdateHandler(({ sessions }) => {
			console.log(
				`[mainview] claudeSessionsUpdate: count=${sessions.length} providerId=${activeProvider.id} hasQuery=${query.trim().length > 0}`,
			);
			const agent = agentForProviderId(activeProvider.id);
			if (!agent) return;
			abortRef.current?.abort();
			setResults(sessionsForAgent(sessions, agent).map(sessionToResult));
			setError(null);
			setIsLoading(false);
			setSelectedIndex(0);
			resultsQueryRef.current = "";
		});
		return () => {
			setClaudeSessionsUpdateHandler(null);
		};
	}, [activeProvider.id, query]);

	// Fallback refresh on every window-shown signal. The hook combines the
	// authoritative bun-side push with DOM focus/visibility events; the
	// `claudeSessionsUpdate` push above is still the primary path (it carries
	// the session payload), this is only the no-payload "refresh now" hint.
	useWindowShown(() => {
		if (agentForProviderId(activeProvider.id) !== null) {
			handleSearch();
		}
	});

	const prevSubTypeRef = useRef(activeSubType);
	useEffect(() => {
		if (activeProvider.id !== "github") return;
		const prev = prevSubTypeRef.current;
		prevSubTypeRef.current = activeSubType;
		if (prev === activeSubType) return;
		if (!query.trim()) return;
		handleSearch();
	}, [activeProvider.id, activeSubType, handleSearch, query]);

	// Agent providers (Claude / Codex) show recent sessions even with empty query
	const hasIdleResults =
		agentForProviderId(activeProvider.id) !== null &&
		results.length > 0 &&
		!query.trim();
	const resultsMatchQuery = resultsQueryRef.current === query;
	// Stable signal for window expansion: tracks user intent (typing) rather
	// than the in-flight fetch state, so the native window does not collapse
	// in the gap between keystroke and result arrival.
	const shouldShowResultsArea =
		agent !== null ||
		hasIdleResults ||
		query.trim().length > 0 ||
		isComboboxOpen;
	const hasFreshResults = resultsMatchQuery && results.length > 0;
	const hasAnyResults = results.length > 0;

	// Defer the full-screen "Buscando..." flash so quick searches (calc, apps)
	// never show it. Only flips to true after isLoading stays true past 150ms.
	const [showLoadingState, setShowLoadingState] = useState(false);
	useEffect(() => {
		if (!isLoading) {
			setShowLoadingState(false);
			return;
		}
		const timer = setTimeout(() => setShowLoadingState(true), 150);
		return () => clearTimeout(timer);
	}, [isLoading]);

	// Resize native window only when typing intent or settings/combobox toggle.
	useEffect(() => {
		const height = isSettingsOpen
			? SETTINGS_HEIGHT
			: agent
				? 540
				: shouldShowResultsArea
					? EXPANDED_HEIGHT
					: COLLAPSED_HEIGHT;
		const width = isSettingsOpen ? SETTINGS_WIDTH : DEFAULT_WIDTH;
		rpc.request.resizeWindow({ height, width }).catch(() => {});
	}, [shouldShowResultsArea, isSettingsOpen, agent]);

	function handleKeyDown(e: React.KeyboardEvent) {
		if (
			e.defaultPrevented ||
			e.nativeEvent.isComposing ||
			e.nativeEvent.keyCode === 229
		)
			return;
		const target = e.target;
		// React portals bubble through the owner tree. Popovers/dialogs have
		// their own focus scope and must never trigger palette actions.
		if (!(target instanceof HTMLElement) || !e.currentTarget.contains(target))
			return;
		if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			// Reused search inputs keep focus; newly mounted composers autofocus.
			e.currentTarget
				.querySelector<HTMLElement>(
					"[data-palette-search], [data-palette-prompt]",
				)
				?.focus();
			if (e.shiftKey) cyclePrev();
			else cycleNext();
			return;
		}
		if (activeProvider.id === "github" && e.metaKey) {
			if (e.key === "f" || e.key === "F") {
				e.preventDefault();
				comboboxRef.current?.open();
				return;
			}
			const digit = e.key;
			if (digit >= "0" && digit <= "9") {
				const num = Number(digit);
				if (num >= 1 && num <= 4) {
					e.preventDefault();
					const type = (["repos", "code", "issues", "users"] as const)[num - 1];
					setSubType({ kind: "native", type });
					return;
				}
				const customIdx = num === 0 ? 5 : num - 5;
				if (customIdx >= 0 && customFilters[customIdx]) {
					e.preventDefault();
					setSubType({ kind: "custom", filter: customFilters[customIdx] });
					return;
				}
			}
		}
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		const isSearch = target.matches("[data-palette-search]");
		const isPrompt = target.matches("[data-palette-prompt]");
		const result = target.closest<HTMLElement>("[data-palette-result]");
		if (!isSearch && !isPrompt && !result) return;
		if (e.key === "Escape") {
			clearPalette();
			return;
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			// A multiline draft owns its caret; empty prompts can reach recents.
			if (isPrompt && query.length > 0) return;
			const items = Array.from(
				e.currentTarget.querySelectorAll<HTMLElement>("[data-palette-result]"),
			);
			if (!items.length) return;
			e.preventDefault();
			const current = result ? items.indexOf(result) : -1;
			if (e.key === "ArrowUp" && current === 0) {
				e.currentTarget
					.querySelector<HTMLElement>(
						"[data-palette-search], [data-palette-prompt]",
					)
					?.focus();
			} else {
				const next =
					current < 0
						? e.key === "ArrowDown"
							? 0
							: items.length - 1
						: Math.min(
								current + (e.key === "ArrowDown" ? 1 : -1),
								items.length - 1,
							);
				items[next].focus();
			}
			return;
		}
		// Buttons activate via their native click, and the composer submits its form.
		if (e.key === "Enter" && isSearch) {
			e.preventDefault();
			const resultsAreFresh = resultsQueryRef.current === query;
			if (resultsAreFresh && results[selectedIndex]) {
				selectResult(results[selectedIndex]);
			} else if (activeProvider.id !== "calc" && activeProvider.id !== "apps") {
				handleSearch();
			}
			return;
		}
	}

	const isCalc = activeProvider.id === "calc";
	const calcResult = isCalc && results.length > 0 ? results[0] : null;

	return (
		<div
			role="application"
			className="flex flex-col h-screen overflow-hidden"
			onKeyDown={handleKeyDown}
		>
			<ModeBar />
			<div
				role="tabpanel"
				id={`plugin-panel-${activeProvider.id}`}
				aria-labelledby={`plugin-tab-${activeProvider.id}`}
				className="flex min-h-0 flex-1 flex-col"
			>
				{agent ? (
					<AgentComposer
						key={agent}
						agent={agent}
						value={query}
						onChange={handleQueryChange}
						onCreated={clearPalette}
					/>
				) : (
					<div className="border-b px-4 py-3 flex items-center gap-2">
						{activeProvider.id === "github" && (
							<SearchTypeCombobox
								ref={comboboxRef}
								onOpenChange={setIsComboboxOpen}
							/>
						)}
						<SearchInput
							placeholder={activeProvider.placeholder}
							value={query}
							onChange={handleQueryChange}
						/>
					</div>
				)}

				{isCalc && shouldShowResultsArea ? (
					<div className="flex-1">
						<CalculatorResult
							expression={query}
							result={calcResult?.title ?? null}
							error={
								calcResult?.id === "calc-error"
									? (calcResult.subtitle ?? null)
									: error
							}
						/>
					</div>
				) : shouldShowResultsArea ? (
					<div className="flex-1 flex flex-col overflow-hidden">
						{agent && (
							<p className="px-5 pt-3 pb-1 text-xs text-muted-foreground">
								Sessões recentes
							</p>
						)}
						{hasAnyResults ? (
							<ScrollArea
								className={cn(
									"flex-1 transition-opacity duration-150",
									isLoading && !hasFreshResults && "opacity-70",
								)}
							>
								<div className="p-2">
									{results.map((result, i) => (
										<ResultItem
											key={result.id}
											result={result}
											isSelected={i === selectedIndex}
											onSelect={() => selectResult(result)}
											onFocus={() => setSelectedIndex(i)}
										/>
									))}
								</div>
							</ScrollArea>
						) : showLoadingState ? (
							<div className="flex-1 flex items-center justify-center">
								<p className="text-sm text-muted-foreground animate-pulse">
									Buscando...
								</p>
							</div>
						) : error ? (
							<div className="flex-1 flex items-center justify-center px-4">
								<p className="text-sm text-destructive text-center">{error}</p>
							</div>
						) : !isLoading && resultsMatchQuery ? (
							<div className="flex-1 flex items-center justify-center">
								<p className="text-sm text-muted-foreground">
									{agent
										? "Sua próxima conversa começa acima."
										: "Nenhum resultado encontrado"}
								</p>
							</div>
						) : (
							<div className="flex-1" />
						)}
					</div>
				) : null}

				{shouldShowResultsArea && (
					<div className="flex items-center justify-between px-4 py-1.5 border-t border-border/40">
						<span className="text-[10px] text-muted-foreground/60">
							{agent ? "Skills preparadas antes da conversa" : "↑↓ navegar"}
						</span>
						{activeProvider.id === "github" && lastSearchCached === true && (
							<span className="text-[10px] text-amber-300/80">⚡ cache</span>
						)}
						{activeProvider.id === "github" && lastSearchCached === false && (
							<span className="text-[10px] text-blue-300/70">🌐 rede</span>
						)}
						<span className="text-[10px] text-muted-foreground/60">
							{agent
								? "↵ iniciar · ⇧↵ nova linha"
								: `${isCalc ? "↵ copiar" : "↵ abrir"} · esc fechar`}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

function AnalyticsInitializer() {
	const { analyticsSettings } = useSettings();

	useEffect(() => {
		if (analyticsSettings.consentGiven && analyticsSettings.anonymousId) {
			initRendererAnalytics(analyticsSettings.anonymousId);
		} else {
			shutdownRendererAnalytics();
		}
	}, [analyticsSettings.consentGiven, analyticsSettings.anonymousId]);

	return null;
}

function App() {
	return (
		<SettingsProvider>
			<AnalyticsInitializer />
			<ProviderContextProvider>
				<GitHubProvider>
					<PaletteContent />
					<SettingsDialog />
				</GitHubProvider>
			</ProviderContextProvider>
		</SettingsProvider>
	);
}

export default App;
