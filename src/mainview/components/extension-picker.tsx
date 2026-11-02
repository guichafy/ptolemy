import { Blocks } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { navigateOptions } from "@/lib/keyboard-navigation";
import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionCapability,
	ExtensionChoices,
	ExtensionInventory,
} from "@/shared/extension-rpc";
import type { ExtensionSelection } from "@/shared/extensions";
import type { McpServerSummary } from "@/shared/mcp";
import { rpc } from "../providers/rpc";
import {
	componentKindLabel,
	ExtensionError,
	errorText,
} from "../settings/extensions-common";
import { useSettings } from "../settings/settings-context";
export interface ExtensionReviewState {
	capabilities: ExtensionCapability[];
	loading: boolean;
	error: string | null;
}
export function ExtensionPicker({
	agent,
	inventory,
	servers,
	choices,
	onChange,
	disabled,
	onBusyChange,
	effectiveCapabilities,
	onReviewChange,
}: {
	agent: AgentKind;
	inventory: ExtensionInventory | null;
	servers: McpServerSummary[];
	choices: ExtensionChoices;
	onChange: (value: ExtensionChoices) => void;
	disabled: boolean;
	onBusyChange: (busy: boolean) => void;
	effectiveCapabilities?: ExtensionCapability[];
	onReviewChange?: (state: ExtensionReviewState) => void;
}) {
	const { openDialog } = useSettings();
	const [caps, setCaps] = useState<ExtensionCapability[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		void attempt; // explicit retry
		if (!inventory) return;
		let cancelled = false;
		setLoading(true);
		onReviewChange?.({ capabilities: [], loading: true, error: null });
		setError(null);
		Promise.all(
			inventory.installed.map((pkg) =>
				rpc.request.agentExtensionReview({
					agent,
					packageId: pkg.id,
					revision: pkg.revision,
					trustedHookDigest: choices.extensionSelections.find(
						(s) => s.packageId === pkg.id && s.revision === pkg.revision,
					)?.trustedHookDigest,
				}),
			),
		)
			.then((r) => {
				if (!cancelled) {
					setCaps(r.flat());
					onReviewChange?.({
						capabilities: r.flat(),
						loading: false,
						error: null,
					});
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setError(errorText(err));
					onReviewChange?.({
						capabilities: [],
						loading: false,
						error: errorText(err),
					});
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [inventory, agent, choices.extensionSelections, attempt, onReviewChange]);
	function update(patch: Partial<ExtensionChoices>) {
		setSaved(false);
		onChange({ ...choices, ...patch });
	}
	function component(
		packageId: string,
		revision: string,
		id: string,
		checked: boolean,
	) {
		const current = choices.extensionSelections.find(
			(s) => s.packageId === packageId && s.revision === revision,
		) ?? { packageId, revision, componentIds: [] };
		const next = {
			...current,
			componentIds: checked
				? [...current.componentIds, id]
				: current.componentIds.filter((c) => c !== id),
		};
		update({
			extensionSelections: [
				...choices.extensionSelections.filter((s) => s.packageId !== packageId),
				next,
			],
		});
	}
	async function save() {
		if (busy) return;
		setBusy(true);
		onBusyChange(true);
		setError(null);
		try {
			await rpc.request.agentExtensionSetDefaults({ agent, ...choices });
			if (mounted.current) setSaved(true);
		} catch (err) {
			if (mounted.current) setError(errorText(err));
		} finally {
			if (mounted.current) {
				setBusy(false);
				onBusyChange(false);
			}
		}
	}
	const count =
		choices.builtinCommandNames.filter((n) =>
			inventory?.builtins.some((b) => b.name === n && b.kind === "command"),
		).length +
		choices.mcpServerIds.filter((id) =>
			servers.some((s) => s.id === id && !s.packageId),
		).length +
		choices.extensionSelections.reduce(
			(n, s) =>
				n +
				s.componentIds.filter(
					(id) =>
						inventory?.installed.some(
							(p) => p.id === s.packageId && p.revision === s.revision,
						) &&
						(effectiveCapabilities ?? caps).some(
							(c) =>
								c.packageId === s.packageId &&
								c.componentId === id &&
								inventory?.installed
									.find((p) => p.id === s.packageId)
									?.components.find((item) => item.id === id)?.kind !==
									"skill" &&
								["native", "adapted"].includes(c.status),
						),
				).length,
			0,
		);
	const toggle = (list: string[], id: string, checked: boolean) =>
		checked ? [...list, id] : list.filter((x) => x !== id);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={disabled}
					aria-label={`Configurar extensões (${count})`}
					className="h-8 gap-1.5 text-xs text-muted-foreground"
				>
					<Blocks className="h-3.5 w-3.5" />
					Extensões{" "}
					{count > 0 && (
						<span className="rounded bg-primary/15 px-1.5 text-primary">
							{count}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[420px] max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] flex flex-col overflow-hidden p-0"
				onKeyDown={navigateOptions}
			>
				<div className="min-h-0 overflow-y-auto p-3 space-y-3">
					<h2 className="text-sm font-medium">Extensões da conversa</h2>
					<p className="text-xs text-muted-foreground">
						A seleção fica fixa ao iniciar. Padrões se aplicam somente a novas
						conversas com {agent === "claude" ? "Claude" : "Codex"}.
					</p>
					{agent === "codex" && (
						<p className="text-xs text-muted-foreground">
							Codex pode executar ferramentas dos servidores MCP selecionados
							sem confirmação a cada chamada.
						</p>
					)}
					{loading && (
						<p role="status" className="text-xs">
							Consultando compatibilidade…
						</p>
					)}
					<fieldset disabled={busy || disabled} className="space-y-3">
						<div className="space-y-2">
							<h3 className="text-xs font-semibold">Recursos internos</h3>
							{choices.builtinCommandNames
								.filter(
									(name) => !inventory?.builtins.some((b) => b.name === name),
								)
								.map((name) => (
									<p key={name} className="text-xs text-destructive">
										Comando interno /{name} indisponível.
										<Button
											size="sm"
											variant="ghost"
											onClick={() =>
												update({
													builtinCommandNames:
														choices.builtinCommandNames.filter(
															(x) => x !== name,
														),
												})
											}
										>
											Remover comando indisponível
										</Button>
									</p>
								))}

							{inventory?.builtins
								.filter((b) => b.kind === "command")
								.map((b) => (
									<label
										key={b.name}
										className="flex items-start gap-2 text-xs"
									>
										<input
											type="checkbox"
											className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
											aria-label={`Usar comando interno ${b.name}`}
											checked={choices.builtinCommandNames.includes(b.name)}
											onChange={(e) =>
												update({
													builtinCommandNames: toggle(
														choices.builtinCommandNames,
														b.name,
														e.target.checked,
													),
												})
											}
										/>
										<span className="min-w-0 break-words">
											<span className="font-medium">/{b.name}</span> (
											{b.kind === "skill" ? "Skill interna" : "Comando interno"}
											)
											<span className="block text-muted-foreground">
												{b.description}
											</span>
											<span className="block text-[11px] text-muted-foreground">
												{b.limitation}
											</span>
										</span>
									</label>
								))}
							{!inventory?.builtins.some((b) => b.kind === "command") && (
								<p className="text-xs text-muted-foreground">
									Sem comandos internos selecionáveis.{" "}
									{inventory?.commandLimitation}
								</p>
							)}
						</div>
						{inventory?.installed.map((pkg) => {
							const selected = choices.extensionSelections.find(
								(s) => s.packageId === pkg.id && s.revision === pkg.revision,
							);
							const trust = selected?.trustedHookDigest === pkg.revision;
							return (
								<div key={pkg.id} className="space-y-2 border-t pt-3">
									<h3 className="break-words text-xs font-semibold">
										{pkg.name}
									</h3>
									{pkg.components.some((c) => c.kind === "skill") && (
										<p className="text-[11px] text-muted-foreground">
											Selecione as Skills deste pacote no menu Skills.
										</p>
									)}
									<p className="text-[10px] text-muted-foreground">
										Revisão {pkg.revision.slice(0, 12)}
									</p>
									{pkg.components
										.filter((c) => c.kind !== "skill")
										.filter((c) =>
											caps.some(
												(cap) =>
													cap.packageId === pkg.id && cap.componentId === c.id,
											),
										)
										.map((c) => {
											const cap = caps.find(
												(cap) =>
													cap.packageId === pkg.id && cap.componentId === c.id,
											)!;
											const checked =
												selected?.componentIds.includes(c.id) ?? false;
											return (
												<label
													key={c.id}
													className="flex items-start gap-2 text-xs"
												>
													<input
														type="checkbox"
														className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
														aria-label={`Usar ${pkg.name}: ${c.name}`}
														checked={checked}
														disabled={
															!checked &&
															(loading ||
																[
																	"requires-configuration",
																	"incompatible",
																].includes(cap.status))
														}
														onChange={(e) =>
															component(
																pkg.id,
																pkg.revision,
																c.id,
																e.target.checked,
															)
														}
													/>
													<span className="min-w-0 break-words">
														{c.name} ({componentKindLabel[c.kind]})
														<span className="block text-[11px] text-muted-foreground">
															{cap.reason}
														</span>
													</span>
												</label>
											);
										})}
									{pkg.components.some((c) => c.kind === "hook") && (
										<label className="flex items-start gap-2 text-xs">
											<input
												type="checkbox"
												className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
												checked={trust}
												onChange={(e) => {
													const next: ExtensionSelection = {
														packageId: pkg.id,
														revision: pkg.revision,
														componentIds: (selected?.componentIds ?? []).filter(
															(id) =>
																pkg.components.find((c) => c.id === id)
																	?.kind !== "hook",
														),
														...(e.target.checked
															? { trustedHookDigest: pkg.revision }
															: {}),
													};
													update({
														extensionSelections: [
															...choices.extensionSelections.filter(
																(s) => s.packageId !== pkg.id,
															),
															next,
														],
													});
												}}
											/>
											Autorizar hooks desta revisão para executar comandos com
											escrita restrita ao projeto.
										</label>
									)}
								</div>
							);
						})}
						{choices.extensionSelections
							.filter(
								(s) =>
									!inventory?.installed.some(
										(p) => p.id === s.packageId && p.revision === s.revision,
									),
							)
							.map((s) => (
								<div key={s.packageId} className="text-xs text-destructive">
									Extensão padrão removida ou atualizada; autorize a nova
									revisão antes de ativar hooks.
									<Button
										size="sm"
										variant="ghost"
										onClick={() =>
											update({
												extensionSelections: choices.extensionSelections.filter(
													(x) => x !== s,
												),
											})
										}
									>
										Remover seleção antiga
									</Button>
								</div>
							))}
						<div className="space-y-2 border-t pt-3">
							<h3 className="text-xs font-semibold">Servidores MCP</h3>
							{choices.mcpServerIds
								.filter((id) => !servers.some((s) => s.id === id))
								.map((id) => (
									<p key={id} className="text-xs text-destructive">
										Servidor MCP removido ou indisponível.
										<Button
											size="sm"
											variant="ghost"
											onClick={() =>
												update({
													mcpServerIds: choices.mcpServerIds.filter(
														(x) => x !== id,
													),
												})
											}
										>
											Remover servidor indisponível
										</Button>
									</p>
								))}

							{servers.map((s) => (
								<label key={s.id} className="flex items-start gap-2 text-xs">
									<input
										type="checkbox"
										className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
										checked={choices.mcpServerIds.includes(s.id)}
										disabled={
											!!s.packageId && !choices.mcpServerIds.includes(s.id)
										}
										onChange={(e) =>
											update({
												mcpServerIds: toggle(
													choices.mcpServerIds,
													s.id,
													e.target.checked,
												),
											})
										}
									/>
									<span className="min-w-0 break-words">
										{s.name}
										<span className="block text-[11px] text-muted-foreground">
											{s.packageId
												? "Ative pelo componente da extensão para preservar seu contexto."
												: `Configurado · ${s.connection.state === "connected" ? "OAuth conectado" : "conexão não testada"}`}
										</span>
									</span>
								</label>
							))}
							{!servers.length && (
								<p className="text-xs text-muted-foreground">
									Nenhum servidor configurado.
								</p>
							)}
						</div>
					</fieldset>
				</div>
				<div className="shrink-0 border-t bg-popover p-3">
					<ExtensionError
						error={error}
						retry={() => setAttempt((a) => a + 1)}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy || loading || !!error}
							onClick={() => void save()}
						>
							Salvar seleção como padrão
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => openDialog("extensions")}
						>
							Gerenciar biblioteca
						</Button>
						{saved && (
							<p role="status" className="text-xs">
								Padrão salvo
							</p>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
