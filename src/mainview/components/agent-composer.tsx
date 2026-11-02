import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	PromptInput,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	CommandSuggestions,
	commandKeyDown,
} from "@/components/claude/command-suggestions";
import { ModelPicker } from "@/components/claude/model-picker";
import type { AgentKind, ProtocolModelInfo } from "@/shared/agent-protocol";
import type {
	ExtensionCapability,
	ExtensionChoices,
	ExtensionCommandSummary,
	ExtensionInventory,
} from "@/shared/extension-rpc";
import type { McpServerSummary } from "@/shared/mcp";
import type { SkillSummary } from "@/shared/skills";
import { useWindowShown } from "../hooks/use-window-shown";
import { rpc } from "../providers/rpc";
import { useSettings } from "../settings/settings-context";
import { ExtensionPicker, type ExtensionReviewState } from "./extension-picker";
import { type SkillOption, SkillPicker } from "./skill-picker";

interface AgentComposerProps {
	agent: AgentKind;
	value: string;
	onChange: (value: string) => void;
	onCreated: () => void;
}

export function AgentComposer({
	agent,
	value,
	onChange,
	onCreated,
}: AgentComposerProps) {
	const { settings, codexSettings, isOpen, openDialog } = useSettings();
	const wasSettingsOpen = useRef(isOpen);
	const defaultSignature = useRef("");
	const [modelOverride, setModelOverride] = useState<string | null>(null);
	const model =
		modelOverride ??
		(agent === "codex" ? codexSettings.model : settings?.claude.model);
	const [models, setModels] = useState<ProtocolModelInfo[]>([]);
	const [modelError, setModelError] = useState<string | null>(null);
	const [modelAttempt, setModelAttempt] = useState(0);
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [libraryReview, setLibraryReview] = useState<ExtensionReviewState>({
		capabilities: [],
		loading: true,
		error: null,
	});
	const [inventory, setInventory] = useState<ExtensionInventory | null>(null);
	const [servers, setServers] = useState<McpServerSummary[]>([]);
	const [extra, setExtra] = useState<Omit<ExtensionChoices, "skillIds">>({
		extensionSelections: [],
		builtinCommandNames: [],
		mcpServerIds: [],
	});
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const [selectionCapabilities, setSelectionCapabilities] = useState<
		ExtensionCapability[]
	>([]);
	const [checking, setChecking] = useState(false);
	const [commands, setCommands] = useState<ExtensionCommandSummary[]>([]);
	const [commandIndex, setCommandIndex] = useState(0);
	const [dismissCommands, setDismissCommands] = useState(false);
	const commandMatches =
		dismissCommands || !/^\/[^\s]*$/.test(value)
			? []
			: commands.filter((c) => `/${c.name}`.startsWith(value));
	const extraSkills: SkillOption[] = [
		...(inventory?.builtins
			.filter((b) => b.kind === "skill")
			.map((b) => ({
				id: `builtin:${b.name}`,
				name: `Skill interna ${b.name}`,
				description: `${b.description} ${b.limitation ?? ""}`,
				origin: "Integrada ao Claude",
				checked: extra.builtinCommandNames.includes(b.name),
				onToggle: (checked: boolean) =>
					setExtra((previous) => ({
						...previous,
						builtinCommandNames: checked
							? [...new Set([...previous.builtinCommandNames, b.name])]
							: previous.builtinCommandNames.filter((n) => n !== b.name),
					})),
			})) ?? []),
		...(inventory?.installed.flatMap((pkg) =>
			pkg.components
				.filter(
					(c) =>
						c.kind === "skill" &&
						libraryReview.capabilities.some(
							(cap) => cap.packageId === pkg.id && cap.componentId === c.id,
						),
				)
				.map((c) => {
					const cap = libraryReview.capabilities.find(
						(cap) => cap.packageId === pkg.id && cap.componentId === c.id,
					)!;
					return {
						id: `${pkg.id}:${pkg.revision}:${c.id}`,
						name: `${pkg.name}: ${c.name}`,
						description: c.description ?? cap.reason,
						origin: `Pacote ${pkg.name} · revisão ${pkg.revision.slice(0, 12)}`,
						checked: extra.extensionSelections.some(
							(s) =>
								s.packageId === pkg.id &&
								s.revision === pkg.revision &&
								s.componentIds.includes(c.id),
						),
						unavailableReason: ["native", "adapted"].includes(cap.status)
							? undefined
							: cap.reason,
						onToggle: (checked: boolean) =>
							setExtra((previous) => {
								const current = previous.extensionSelections.find(
									(s) => s.packageId === pkg.id && s.revision === pkg.revision,
								) ?? {
									packageId: pkg.id,
									revision: pkg.revision,
									componentIds: [],
								};
								return {
									...previous,
									extensionSelections: [
										...previous.extensionSelections.filter(
											(s) => s.packageId !== pkg.id,
										),
										{
											...current,
											componentIds: checked
												? [...new Set([...current.componentIds, c.id])]
												: current.componentIds.filter((id) => id !== c.id),
										},
									],
								};
							}),
					};
				}),
		) ?? []),
	];

	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [configuring, setConfiguring] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);
	const inFlight = useRef(false);
	const mounted = useRef(true);
	const catalogRequest = useRef(0);
	const selectionInitialized = useRef<AgentKind | null>(null);
	const label = agent === "claude" ? "Claude" : "Codex";
	const resolvedId = models.find((item) => item.value === model)?.resolvesTo;
	const resolvedLabel =
		models.find((item) => item.value === resolvedId)?.displayName ?? resolvedId;
	// biome-ignore lint/correctness/useExhaustiveDependencies: modelAttempt restarts discovery only after an explicit retry.
	useEffect(() => {
		let cancelled = false;
		setModelError(null);
		const load = async () => {
			try {
				const result =
					agent === "codex"
						? await rpc.request.codexListModels()
						: await rpc.request.claudeListSupportedModels();
				if (!cancelled) setModels(result.models);
			} catch (err) {
				if (!cancelled)
					setModelError(
						err instanceof Error
							? err.message
							: "Não foi possível carregar os modelos.",
					);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [agent, modelAttempt]);
	const loadCatalog = useCallback(
		async (preserveSelection = false) => {
			const requestId = ++catalogRequest.current;
			setLoading(true);
			setCatalogError(null);
			try {
				const [catalog, library, mcp] = await Promise.all([
					rpc.request.agentListSkills({ agent }),
					rpc.request.agentExtensionInventory({ agent }),
					rpc.request.agentMcpList(),
				]);
				if (!mounted.current || requestId !== catalogRequest.current) return;
				setSkills(catalog);
				setInventory(library);
				setServers(mcp);
				const signature = JSON.stringify({
					agent,
					extensions: library.defaults ?? null,
					skills: library.skillDefaults ?? null,
					mcp: mcp
						.filter((s) => s.defaults[agent] && !s.packageId)
						.map((s) => s.id),
				});
				const wasInitialized = selectionInitialized.current === agent;
				selectionInitialized.current = agent;
				const applyDefaults =
					!preserveSelection || signature !== defaultSignature.current;
				defaultSignature.current = signature;
				if (applyDefaults) {
					setExtra((previous) => ({
						extensionSelections: library.defaults?.selections ?? [],
						builtinCommandNames:
							library.defaults?.builtinCommandNames ??
							(preserveSelection && wasInitialized
								? previous.builtinCommandNames
								: library.builtins.map((b) => b.name)),
						mcpServerIds: mcp
							.filter((s) => s.defaults[agent] && !s.packageId)
							.map((s) => s.id),
					}));
					setSelected(
						catalog
							.filter(
								(skill) =>
									!skill.unavailableReason && skill.defaultFor.includes(agent),
							)
							.map((skill) => skill.id),
					);
				}
			} catch (err) {
				if (mounted.current && requestId === catalogRequest.current)
					setCatalogError(
						err instanceof Error
							? err.message
							: "Não foi possível carregar as Skills.",
					);
			} finally {
				if (mounted.current && requestId === catalogRequest.current)
					setLoading(false);
			}
		},
		[agent],
	);
	useEffect(() => {
		mounted.current = true;
		void loadCatalog();
		return () => {
			mounted.current = false;
		};
	}, [loadCatalog]);
	useEffect(() => {
		if (wasSettingsOpen.current && !isOpen) void loadCatalog(true);
		wasSettingsOpen.current = isOpen;
	}, [isOpen, loadCatalog]);

	useEffect(() => {
		if (loading || catalogError || !inventory) return;
		let cancelled = false;
		const stale = extra.extensionSelections.some(
			(selection) =>
				!inventory.installed.some(
					(pkg) =>
						pkg.id === selection.packageId &&
						pkg.revision === selection.revision,
				),
		);
		const unavailableMcp = extra.mcpServerIds.find(
			(id) =>
				!servers.some(
					(s) =>
						s.id === id && !s.packageId && s.authentication?.ready !== false,
				),
		);
		if (unavailableMcp) {
			setSelectionError(
				servers.find((s) => s.id === unavailableMcp)?.authentication?.reason ??
					"Servidor MCP indisponível. Revise em Extensões → MCP.",
			);
			setChecking(false);
			setSelectionCapabilities([]);
			return;
		}
		if (stale) {
			setSelectionError(
				"Extensão removida ou atualizada. Remova a seleção antiga e selecione a revisão instalada; autorize seus hooks novamente.",
			);
			setChecking(false);
			setSelectionCapabilities([]);
			return;
		}
		setChecking(true);
		setSelectionCapabilities([]);
		setSelectionError(null);
		Promise.all([
			rpc.request.agentExtensionCapabilities({
				agent,
				selections: extra.extensionSelections,
			}),
			rpc.request.agentExtensionCommands({
				agent,
				selections: extra.extensionSelections,
			}),
		])
			.then(([caps, cmds]) => {
				if (cancelled) return;
				setSelectionCapabilities(caps);
				const unavailable = caps.find((c) =>
					["incompatible", "requires-configuration"].includes(c.status),
				);
				if (unavailable) setSelectionError(unavailable.reason);
				setCommands([
					...cmds,
					...(inventory?.builtins
						.filter((b) => extra.builtinCommandNames.includes(b.name))
						.map((b) => ({ name: b.name, description: b.description })) ?? []),
				]);
			})
			.catch((err) => {
				if (!cancelled)
					setSelectionError(
						err instanceof Error ? err.message : "Falha ao validar extensões.",
					);
			})
			.finally(() => {
				if (!cancelled) setChecking(false);
			});
		return () => {
			cancelled = true;
		};
	}, [agent, extra, inventory, loading, catalogError, servers]);

	useWindowShown(() => {
		textarea.current?.focus();
	});
	async function submit() {
		if (
			inFlight.current ||
			loading ||
			configuring ||
			checking ||
			selectionError ||
			catalogError ||
			!value.trim()
		)
			return;
		inFlight.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await rpc.request.claudeCreateSession({
				agent,
				prompt: value.trim(),
				skillIds: selected,
				...extra,
				...(model && { model }),
			});
			if (mounted.current) onCreated();
		} catch (err) {
			if (mounted.current)
				setError(
					err instanceof Error
						? err.message
						: "Não foi possível iniciar a conversa.",
				);
		} finally {
			inFlight.current = false;
			if (mounted.current) setSubmitting(false);
		}
	}
	return (
		<fieldset
			aria-label={`Nova conversa com ${label}`}
			data-agent-composer
			className="min-w-0 border-b px-4 py-3"
		>
			<PromptInput
				onSubmit={() => void submit()}
				className="rounded-xl border-border/70 bg-background/60 p-2.5 shadow-none"
			>
				<PromptInputTextarea
					data-palette-prompt
					ref={textarea}
					autoFocus={!document.activeElement?.closest('[role="tablist"]')}
					rows={2}
					maxHeight={128}
					aria-label={`Mensagem para ${label}`}
					placeholder={`O que vamos fazer com ${label}?`}
					value={value}
					disabled={submitting}
					onChange={(event) => {
						onChange(event.target.value);
						setDismissCommands(false);
						setCommandIndex(0);
					}}
					onKeyDown={(event) => {
						if (
							commandKeyDown(
								event,
								commandMatches,
								commandIndex,
								setCommandIndex,
								(name) => {
									onChange(`/${name} `);
									setDismissCommands(false);
								},
								() => setDismissCommands(true),
							)
						)
							return;
						if (
							event.nativeEvent.isComposing ||
							event.nativeEvent.keyCode === 229
						) {
							if (event.key === "Enter") event.preventDefault();
						}
					}}
					className="min-h-16 px-2 py-1.5 text-[15px]"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
				/>
				<CommandSuggestions
					commands={commandMatches}
					index={commandIndex}
					onSelect={(name) => {
						onChange(`/${name} `);
						textarea.current?.focus();
					}}
				/>
				{(selected.length > 0 || extraSkills.some((s) => s.checked)) && (
					<div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto px-2">
						{extraSkills
							.filter((s) => s.checked)
							.map((option) => (
								<button
									key={option.id}
									type="button"
									disabled={submitting}
									aria-label={`Remover ${option.name}`}
									onClick={() => option.onToggle(false)}
									className="flex max-w-full min-w-0 items-center gap-1 break-words rounded-md bg-primary/10 px-2 py-1 text-left text-[11px] text-primary"
								>
									{option.name}
									<X className="h-3 w-3 shrink-0" />
								</button>
							))}
						{selected.map((id) => {
							const skill = skills.find((item) => item.id === id);
							return (
								<button
									key={id}
									type="button"
									disabled={submitting}
									aria-label={`Remover ${skill?.name ?? id}`}
									onClick={() =>
										setSelected((ids) => ids.filter((value) => value !== id))
									}
									className="flex max-w-full min-w-0 items-center gap-1 break-words rounded-md bg-primary/10 px-2 py-1 text-left text-[11px] text-primary"
								>
									{skill?.name}
									<X className="h-3 w-3 shrink-0" />
								</button>
							);
						})}
					</div>
				)}
				<PromptInputFooter className="justify-between p-0">
					<PromptInputTools>
						<ModelPicker
							variant="turn-override"
							value={model ?? null}
							models={models}
							onChange={setModelOverride}
							disabled={submitting}
							resolvedLabel={resolvedLabel}
							emptyLabel={modelError ? (model ?? "Modelo padrão") : undefined}
						/>
						<SkillPicker
							extraSkills={extraSkills}
							extraLoading={!catalogError && (loading || libraryReview.loading)}
							extraError={catalogError ?? libraryReview.error}
							onSaveDefaults={async () => {
								await rpc.request.agentExtensionSetDefaults({
									agent,
									skillIds: selected,
									...extra,
								});
							}}
							onManage={() => openDialog("extensions")}
							agent={agent}
							skills={skills}
							selected={selected}
							onSelect={setSelected}
							onBusyChange={setConfiguring}
							onImported={(skill) => {
								setSkills((items) => [...items, skill]);
								setSelected((ids) => [...ids, skill.id]);
							}}
							disabled={submitting}
							selectionDisabled={loading || !!catalogError}
						/>
						<ExtensionPicker
							onReviewChange={setLibraryReview}
							agent={agent}
							inventory={inventory}
							effectiveCapabilities={selectionCapabilities}
							servers={servers}
							choices={{ skillIds: selected, ...extra }}
							onChange={({ skillIds, ...rest }) => {
								setSelected(skillIds);
								setExtra(rest);
							}}
							disabled={loading || submitting || !!catalogError}
							onBusyChange={setConfiguring}
						/>
					</PromptInputTools>
					<div className="flex items-center gap-3">
						<span className="text-[10px] text-muted-foreground">
							⇧↵ nova linha
						</span>
						<PromptInputSubmit
							aria-label="Iniciar conversa"
							disabled={
								loading ||
								submitting ||
								configuring ||
								checking ||
								!!selectionError ||
								!!catalogError ||
								!value.trim()
							}
						/>
					</div>
				</PromptInputFooter>
			</PromptInput>
			{modelError && (
				<div role="alert" className="mt-2 text-xs text-destructive">
					{modelError}
					<button
						type="button"
						className="ml-2 underline"
						aria-label="Tentar carregar modelos novamente"
						onClick={() => setModelAttempt((attempt) => attempt + 1)}
					>
						Tentar novamente
					</button>
				</div>
			)}
			{(error || catalogError || selectionError) && (
				<div role="alert" className="mt-2 text-xs text-destructive">
					{error || catalogError || selectionError}
					{catalogError && (
						<button
							type="button"
							className="ml-2 underline"
							onClick={() => void loadCatalog()}
						>
							Tentar novamente
						</button>
					)}
				</div>
			)}
		</fieldset>
	);
}
