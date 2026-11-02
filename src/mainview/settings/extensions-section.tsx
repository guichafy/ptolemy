import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionCapability,
	ExtensionInventory,
} from "@/shared/extension-rpc";
import type {
	ExtensionSelection,
	ExtensionSource,
	ExtensionSummary,
} from "@/shared/extensions";
import type { McpEditableServer, McpServerSummary } from "@/shared/mcp";
import { rpc } from "../providers/rpc";
import {
	componentKindLabel,
	ExtensionError,
	errorText,
} from "./extensions-common";
import { McpEditor } from "./extensions-mcp-editor";

const tabs = ["Instaladas", "Marketplace", "MCP"] as const;
export function ExtensionsSection() {
	const [tab, setTab] = useState<(typeof tabs)[number]>("Instaladas");
	const [agent, setAgent] = useState<AgentKind>("claude");
	const [attempt, setAttempt] = useState(0);
	const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
	const [sources, setSources] = useState<ExtensionSource[]>([]);
	const [source, setSource] = useState("");
	const [items, setItems] = useState<ExtensionSummary[]>([]);
	const [servers, setServers] = useState<McpServerSummary[]>([]);
	const [inventory, setInventory] = useState<ExtensionInventory | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nativeError, setNativeError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [url, setUrl] = useState("");
	const [detail, setDetail] = useState<ExtensionSummary | null>(null);
	const [caps, setCaps] = useState<ExtensionCapability[]>([]);
	const [selections, setSelections] = useState<ExtensionSelection[]>([]);
	const [trusted, setTrusted] = useState(false);
	const [enabled, setEnabled] = useState<string[]>([]);
	const [message, setMessage] = useState("");
	const [editor, setEditor] = useState<{
		draft: McpEditableServer;
		isSaved?: boolean;
		binding?: { packageId: string; revision: string; componentId: string };
	} | null>(null);
	const sequence = useRef(0);
	const mounted = useRef(true);
	const refresh = () => setAttempt((a) => a + 1);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			sequence.current++;
		};
	}, []);
	useEffect(() => {
		void attempt; // explicit reload
		const request = ++sequence.current;
		let cancelled = false;
		setLoading(true);
		setError(null);
		setDetail(null);
		if (tab !== "MCP") setEditor(null);
		setMessage("");
		setInventory(null);
		setNativeError(null);
		const load = async () => {
			try {
				if (tab === "MCP") {
					const r = await rpc.request.agentMcpList();
					if (!cancelled) setServers(r);
				} else if (tab === "Marketplace") {
					const r = await rpc.request.agentExtensionSources();
					if (!cancelled) {
						setSources(r);
						setSource((s) =>
							r.some((x) => x.id === s) ? s : (r[0]?.id ?? ""),
						);
					}
				} else {
					const r = await rpc.request.agentExtensionInstalled();
					if (!cancelled) setInstalled(r);
					try {
						const i = await rpc.request.agentExtensionInventory({ agent });
						if (!cancelled) {
							setInventory(i);
							setSelections(i.defaults?.selections ?? []);
						}
					} catch (err) {
						if (!cancelled) setNativeError(errorText(err));
					}
				}
			} catch (err) {
				if (!cancelled && sequence.current === request)
					setError(errorText(err));
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [tab, agent, attempt]);
	useEffect(() => {
		void attempt; // explicit reload
		if (tab !== "Marketplace" || !source) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		setItems([]);
		setDetail(null);
		sequence.current++;
		rpc.request
			.agentExtensionBrowse({ sourceId: source })
			.then((r) => {
				if (!cancelled) setItems(r);
			})
			.catch((err) => {
				if (!cancelled) setError(errorText(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [source, tab, attempt]);
	async function run(fn: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (err) {
			if (mounted.current) setError(errorText(err));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	async function inspect(pkg: ExtensionSummary) {
		const request = ++sequence.current;
		setDetail(null);
		setCaps([]);
		setMessage("");
		setError(null);
		await run(async () => {
			const review =
				tab === "Marketplace"
					? await rpc.request.agentExtensionInspect({
							sourceId: source,
							itemId: pkg.id,
							agent,
						})
					: {
							summary: pkg,
							capabilities: await rpc.request.agentExtensionReview({
								agent,
								packageId: pkg.id,
								revision: pkg.revision,
							}),
						};
			if (sequence.current !== request) return;
			setDetail(review.summary);
			setCaps(review.capabilities);
			const saved = selections.find(
				(s) => s.packageId === pkg.id && s.revision === pkg.revision,
			);
			setEnabled(saved?.componentIds ?? []);
			setTrusted(saved?.trustedHookDigest === pkg.revision);
		});
	}
	const updateCapabilities = useCallback(
		async (pkg: ExtensionSummary, trust: boolean) => {
			const request = ++sequence.current;
			try {
				const result = await rpc.request.agentExtensionReview({
					agent,
					packageId: pkg.id,
					revision: pkg.revision,
					...(trust ? { trustedHookDigest: pkg.revision } : {}),
				});
				if (mounted.current && request === sequence.current) setCaps(result);
			} catch (err) {
				if (mounted.current && request === sequence.current)
					setError(errorText(err));
			}
		},
		[agent],
	);
	async function saveSelection() {
		if (!detail) return;
		await run(async () => {
			const next = [
				...selections.filter((s) => s.packageId !== detail.id),
				...(enabled.length
					? [
							{
								packageId: detail.id,
								revision: detail.revision,
								componentIds: enabled,
								...(trusted ? { trustedHookDigest: detail.revision } : {}),
							},
						]
					: []),
			];
			const [skills, mcp] = await Promise.all([
				rpc.request.agentListSkills({ agent }),
				rpc.request.agentMcpList(),
			]);
			await rpc.request.agentExtensionSetDefaults({
				agent,
				skillIds: skills
					.filter((s) => s.defaultFor.includes(agent))
					.map((s) => s.id),
				mcpServerIds: mcp
					.filter((s) => s.defaults[agent] && !s.packageId)
					.map((s) => s.id),
				builtinCommandNames:
					inventory?.defaults?.builtinCommandNames ??
					inventory?.builtins.map((b) => b.name) ??
					[],
				extensionSelections: next,
			});
			setSelections(next);
			setMessage("Padrão salvo para novas conversas.");
		});
	}
	const visible = (tab === "Marketplace" ? items : installed).filter((p) =>
		`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
	);
	return (
		<section className="min-w-0 space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold">Extensões</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						Recursos dos agentes. A seleção é fixada ao iniciar cada conversa.
					</p>
				</div>
				<label className="text-xs">
					Agente{" "}
					<select
						disabled={busy}
						aria-label="Agente das extensões"
						value={agent}
						onChange={(e) => setAgent(e.target.value as AgentKind)}
						className="ml-2 rounded-md border bg-background p-1.5"
					>
						<option value="claude">Claude</option>
						<option value="codex">Codex</option>
					</select>
				</label>
			</div>
			<div
				role="tablist"
				aria-label="Biblioteca de extensões"
				className="flex border-b"
			>
				{tabs.map((name, index) => (
					<button
						type="button"
						role="tab"
						disabled={busy}
						key={name}
						id={`extension-tab-${name}`}
						aria-controls="extension-panel"
						aria-selected={tab === name}
						tabIndex={tab === name ? 0 : -1}
						className={`px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-primary ${tab === name ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
						onClick={() => setTab(name)}
						onKeyDown={(e) => {
							if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
								e.preventDefault();
								const next =
									e.key === "Home"
										? 0
										: e.key === "End"
											? 2
											: (index + (e.key === "ArrowRight" ? 1 : 2)) % 3;
								setTab(tabs[next]);
								document.getElementById(`extension-tab-${tabs[next]}`)?.focus();
							}
						}}
					>
						{name}
					</button>
				))}
			</div>
			<div
				role="tabpanel"
				id="extension-panel"
				aria-labelledby={`extension-tab-${tab}`}
				className="min-w-0 space-y-3"
			>
				<ExtensionError error={error} retry={refresh} />
				{message && (
					<p role="status" className="text-xs text-primary">
						{message}
					</p>
				)}
				{loading && (
					<p role="status" className="text-xs text-muted-foreground">
						Carregando…
					</p>
				)}
				{tab === "Marketplace" && (
					<>
						<p className="text-xs text-muted-foreground">
							Adicione um repositório público do GitHub, inspecione o pacote e
							instale seus componentes. Descubra Skills em{" "}
							<button
								type="button"
								className="underline"
								onClick={() =>
									void rpc.request.openUrl({ url: "https://skills.sh" })
								}
							>
								skills.sh
							</button>
							.
						</p>
						<div className="flex flex-wrap gap-2">
							<Input
								aria-label="URL da fonte GitHub"
								placeholder="https://github.com/autor/repositório"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								className="min-w-0 flex-1"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										if (url.trim())
											void run(async () => {
												await rpc.request.agentExtensionAddSource({
													url: url.trim(),
												});
												setUrl("");
												refresh();
											});
									}
								}}
							/>
							<Button
								size="sm"
								variant="outline"
								disabled={busy || !url.trim()}
								onClick={() =>
									void run(async () => {
										await rpc.request.agentExtensionAddSource({
											url: url.trim(),
										});
										setUrl("");
										refresh();
									})
								}
							>
								Adicionar fonte
							</Button>
						</div>
						<div className="flex min-w-0 gap-2">
							<select
								disabled={busy}
								aria-label="Fonte do marketplace"
								value={source}
								onChange={(e) => setSource(e.target.value)}
								className="min-w-0 flex-1 rounded-md border bg-background p-2 text-xs"
							>
								{sources.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</select>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy || !source}
								onClick={() =>
									void run(async () => {
										await rpc.request.agentExtensionRemoveSource({
											id: source,
										});
										refresh();
									})
								}
							>
								Remover fonte
							</Button>
						</div>
					</>
				)}
				{tab === "MCP" ? (
					<>
						{!editor && (
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									setEditor({
										draft: {
											id: crypto.randomUUID(),
											name: "",
											defaults: { claude: false, codex: false },
											transport: "stdio",
											command: "",
											args: [],
										},
									})
								}
							>
								Novo servidor
							</Button>
						)}
						{editor ? (
							<McpEditor
								key={editor.draft.id}
								initial={editor.draft}
								isSaved={editor.isSaved}
								binding={editor.binding}
								onSaved={() => {
									void rpc.request
										.agentMcpList()
										.then(setServers)
										.catch((e) => setError(errorText(e)));
								}}
								onCancel={() => setEditor(null)}
							/>
						) : (
							<div className="divide-y">
								{servers.map((s) => (
									<div
										key={s.id}
										className="flex min-w-0 items-start justify-between gap-2 py-3"
									>
										<button
											type="button"
											className="min-w-0 text-left text-xs hover:underline"
											disabled={busy}
											onClick={() =>
												void run(async () =>
													setEditor({
														isSaved: true,
														draft: await rpc.request.agentMcpGetEditable({
															id: s.id,
														}),
													}),
												)
											}
										>
											<span className="block break-words font-medium">
												{s.name}
											</span>
											<span className="text-muted-foreground">
												{s.transport} · {s.connection.state}
												{s.packageId
													? " · Selecione pelo componente da extensão"
													: ""}
											</span>
										</button>
										<Button
											size="sm"
											variant="ghost"
											disabled={busy}
											onClick={() =>
												void run(async () => {
													await rpc.request.agentMcpRemove({ id: s.id });
													refresh();
												})
											}
										>
											Remover
										</Button>
									</div>
								))}
								{!loading && !servers.length && !error && (
									<p className="py-3 text-xs text-muted-foreground">
										Nenhum servidor configurado. Adicione um servidor local ou
										HTTP.
									</p>
								)}
							</div>
						)}
					</>
				) : (
					<>
						<Input
							aria-label="Buscar extensões"
							placeholder="Buscar por nome ou descrição"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
						<div className="grid min-w-0 gap-4 @min-[620px]:grid-cols-[minmax(160px,0.8fr)_minmax(0,1.2fr)]">
							<div className="min-w-0 divide-y">
								{visible.map((pkg) => (
									<div
										key={pkg.id}
										className="flex min-w-0 items-start gap-1 py-3"
									>
										<button
											type="button"
											aria-label={`Inspecionar ${pkg.name}`}
											aria-pressed={detail?.id === pkg.id}
											className="min-w-0 flex-1 text-left text-xs hover:text-primary"
											disabled={busy}
											onClick={() => void inspect(pkg)}
										>
											<span className="block break-words font-medium">
												{pkg.name}
											</span>
											<span className="mt-1 line-clamp-2 block text-muted-foreground">
												{pkg.description ||
													"Inspecione os componentes e a compatibilidade."}
											</span>
										</button>
										{tab === "Instaladas" && (
											<Button
												size="sm"
												variant="ghost"
												disabled={busy}
												aria-label={`Remover ${pkg.name}`}
												onClick={() =>
													void run(async () => {
														await rpc.request.agentExtensionRemove({
															id: pkg.id,
														});
														refresh();
													})
												}
											>
												Remover
											</Button>
										)}
									</div>
								))}
								{!loading && !visible.length && !error && (
									<p className="py-3 text-xs text-muted-foreground">
										{query
											? "Nenhuma extensão encontrada."
											: tab === "Instaladas"
												? "Nenhuma extensão instalada. Explore o marketplace ou importe um plugin local."
												: "Nenhum pacote nesta fonte."}
									</p>
								)}
								{tab === "Instaladas" && (
									<div className="space-y-2 pt-4">
										<h3 className="text-xs font-semibold">
											Plugins locais do{" "}
											{agent === "claude" ? "Claude" : "Codex"}
										</h3>
										<ExtensionError error={nativeError} retry={refresh} />
										{inventory?.nativePlugins.map((p) => (
											<div key={p.id} className="space-y-1 py-2">
												<p className="break-words text-xs font-medium">
													{p.name}
												</p>
												<p className="text-[11px] text-muted-foreground">
													{p.enabled ? "Ativo no CLI" : "Instalado no CLI"}
													{p.managed ? " · Obrigatório por política" : ""}
												</p>
												{p.importLimitation && (
													<p className="text-xs text-muted-foreground">
														{p.importLimitation}
													</p>
												)}
												<Button
													size="sm"
													variant="outline"
													disabled={busy || !p.canImport}
													onClick={() =>
														void run(async () => {
															const result =
																await rpc.request.agentExtensionImportNative({
																	agent,
																	id: p.id,
																});
															setInstalled((old) => [
																...old.filter((x) => x.id !== result.id),
																result,
															]);
															setMessage(
																"Plugin local importado. Inspecione e selecione seus componentes.",
															);
														})
													}
												>
													Importar pacote local
												</Button>
											</div>
										))}
										{inventory && !inventory.nativePlugins.length && (
											<p className="text-xs text-muted-foreground">
												Nenhum plugin local encontrado.
											</p>
										)}
									</div>
								)}
							</div>
							{detail && (
								<div className="min-w-0 space-y-3 border-t pt-3">
									<h3 className="break-words text-sm font-semibold">
										{detail.name}
									</h3>
									<p className="break-all text-[11px] text-muted-foreground">
										Fonte: {detail.url}
										<br />
										Revisão: {detail.revision}
									</p>
									{tab === "Marketplace" ? (
										<Button
											size="sm"
											disabled={busy}
											onClick={() =>
												void run(async () => {
													const result =
														await rpc.request.agentExtensionInstall({
															sourceId: source,
															itemId: detail.id,
														});
													setDetail(result);
													setTrusted(false);
													setEnabled([]);
													setMessage(
														`Instalado: ${result.name}. Selecione componentes na aba Instaladas.`,
													);
												})
											}
										>
											Instalar pacote
										</Button>
									) : (
										<p className="text-xs text-muted-foreground">
											Escolha os componentes para novas conversas com{" "}
											{agent === "claude" ? "Claude" : "Codex"}. Conversas
											existentes mantêm sua seleção.
										</p>
									)}
									{detail.diagnostics.map((d) => (
										<p
											key={`${d.code}-${d.path ?? ""}-${d.message}`}
											className="break-words text-xs text-muted-foreground"
										>
											{d.message}
										</p>
									))}
									{detail.components
										.filter((c) => caps.some((cap) => cap.componentId === c.id))
										.map((c) => {
											const cap = caps.find((cap) => cap.componentId === c.id)!;
											return (
												<div key={c.id} className="space-y-1 border-t py-2">
													<label className="flex items-start gap-2 text-xs">
														<input
															type="checkbox"
															className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
															aria-label={`Ativar ${c.name}`}
															checked={enabled.includes(c.id)}
															disabled={
																tab === "Marketplace" ||
																busy ||
																cap.status === "incompatible" ||
																(cap.status === "requires-configuration" &&
																	!enabled.includes(c.id))
															}
															onChange={(e) => {
																setEnabled((ids) =>
																	e.target.checked
																		? [...ids, c.id]
																		: ids.filter((id) => id !== c.id),
																);
																setMessage("");
															}}
														/>
														<span className="min-w-0 break-words">
															<span className="font-medium">{c.name}</span>{" "}
															<span className="text-muted-foreground">
																({componentKindLabel[c.kind]})
															</span>
															<span className="mt-1 block text-muted-foreground">
																{cap.reason}
															</span>
														</span>
													</label>
													{c.kind === "mcp" && tab === "Instaladas" && (
														<Button
															size="sm"
															variant="outline"
															disabled={busy}
															onClick={() =>
																void run(async () => {
																	const binding = {
																		packageId: detail.id,
																		revision: detail.revision,
																		componentId: c.id,
																	};
																	const draft =
																		await rpc.request.agentMcpBindingDraft(
																			binding,
																		);
																	setEditor({ draft, binding });
																	setTab("MCP");
																})
															}
														>
															Configurar MCP
														</Button>
													)}
													{c.diagnostics.map((d) => (
														<p
															key={`${d.code}-${d.path ?? ""}-${d.message}`}
															className="text-xs text-muted-foreground"
														>
															{d.message}
														</p>
													))}
												</div>
											);
										})}
									{tab === "Instaladas" && (
										<>
											{detail.components.some((c) => c.kind === "hook") && (
												<label className="flex items-start gap-2 text-xs">
													<input
														type="checkbox"
														className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
														checked={trusted}
														disabled={busy}
														onChange={(e) => {
															setTrusted(e.target.checked);
															setEnabled((ids) =>
																ids.filter(
																	(id) =>
																		detail.components.find((c) => c.id === id)
																			?.kind !== "hook",
																),
															);
															void updateCapabilities(detail, e.target.checked);
														}}
													/>
													Autorizar execução dos hooks desta revisão (
													{detail.revision.slice(0, 12)}). O pacote pode
													executar comandos com escrita restrita ao projeto.
												</label>
											)}
											<Button
												size="sm"
												disabled={busy || !inventory}
												onClick={() => void saveSelection()}
											>
												Usar componentes como padrão
											</Button>
										</>
									)}
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</section>
	);
}
