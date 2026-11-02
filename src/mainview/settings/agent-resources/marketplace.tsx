import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionSource, ExtensionSummary } from "@/shared/extensions";
import { componentKindLabel, errorText } from "../extensions-common";
import { ResourceDetail, UninstallResource, useResourceDetail } from "./detail";
import { type ResourcePage, resourceLabels } from "./model";
export function ResourceMarketplace({
	agent,
	page,
	onRefresh,
	onBusyChange,
	installed = [],
	onRemoved,
	onShowInstalled,
}: {
	agent: AgentKind;
	page: ResourcePage;
	onRefresh: () => void;
	onBusyChange?: (busy: boolean) => void;
	installed?: ExtensionSummary[];
	onRemoved?: (id: string) => void;
	onShowInstalled?: () => void;
}) {
	const [sources, setSources] = useState<ExtensionSource[]>([]);
	const [source, setSource] = useState("");
	const [items, setItems] = useState<ExtensionSummary[]>([]);
	const navigation = useResourceDetail<ExtensionSummary>();
	const { detail } = navigation;
	const [url, setUrl] = useState("");
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [inspecting, setInspecting] = useState<string | null>(null);
	const [inspectionFailure, setInspectionFailure] = useState<{
		id: string;
		message: string;
	} | null>(null);
	const inspectionFeedbackId = useId();
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [attempt, setAttempt] = useState(0);
	const sequence = useRef(0);
	const fingerprint = JSON.stringify(installed.map((p) => [p.id, p.revision]));
	const [change, setChange] = useState<{
		id: string;
		revision: string | null;
		baseline: string;
	} | null>(null);
	const installedRevision =
		change?.id === detail?.id && change?.baseline === fingerprint
			? change.revision
			: installed.find((p) => p.id === detail?.id)?.revision;
	const backLabel = `Voltar à lista de ${resourceLabels[page]}`;
	useEffect(() => {
		void attempt;
		let cancelled = false;
		setError(null);
		setLoading(true);
		rpc.request
			.agentExtensionSources()
			.then((r) => {
				if (cancelled) return;
				setSources(r);
				const preferred =
					page === "skills"
						? "anthropics/skills"
						: agent === "codex"
							? "openai/plugins"
							: "anthropics/claude-plugins-official";
				setSource((old) =>
					r.some((s) => s.id === old)
						? old
						: (r.find((s) => s.name === preferred)?.id ?? r[0]?.id ?? ""),
				);
				if (!r.length) setLoading(false);
			})
			.catch((e) => {
				if (!cancelled) {
					setError(errorText(e));
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [agent, page, attempt]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset uses only refs and a stable setter; catalog resets on source/retry, not detail changes.
	useEffect(() => {
		void attempt;
		if (!source) return;
		let cancelled = false;
		sequence.current++;
		setLoading(true);
		setError(null);
		setItems([]);
		setInspecting(null);
		setInspectionFailure(null);
		// Source changes discard details; component is scoped by harness and page.
		navigation.reset();
		rpc.request
			.agentExtensionBrowse({ sourceId: source })
			.then((r) => {
				if (!cancelled) setItems(r);
			})
			.catch((e) => {
				if (!cancelled) setError(errorText(e));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [source, attempt]);
	async function run(action: () => Promise<void>) {
		setBusy(true);
		onBusyChange?.(true);
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
			onBusyChange?.(false);
		}
	}
	async function inspect(pkg: ExtensionSummary) {
		if (busy) return;
		const current = ++sequence.current;
		setMessage("");
		setInspecting(pkg.id);
		setInspectionFailure(null);
		await run(async () => {
			try {
				const r = await rpc.request.agentExtensionInspect({
					sourceId: source,
					itemId: pkg.id,
					agent,
				});
				if (sequence.current === current) navigation.open(r.summary);
			} catch (e) {
				if (sequence.current === current)
					setInspectionFailure({ id: pkg.id, message: errorText(e) });
			} finally {
				if (sequence.current === current) setInspecting(null);
			}
		});
	}
	const matches = (pkg: ExtensionSummary) =>
		page === "plugins"
			? pkg.components.some((c) => c.kind !== "other")
			: pkg.components.some(
					(c) => c.kind === (page === "skills" ? "skill" : "mcp"),
				);
	const installLabel = `${installedRevision ? "Atualizar" : "Instalar"} ${page === "skills" ? "Skill" : "pacote"}`;
	async function install() {
		if (!detail) return;
		await run(async () => {
			const result = await rpc.request.agentExtensionInstall({
				sourceId: source,
				itemId: detail.id,
			});
			setChange({
				id: result.id,
				revision: result.revision,
				baseline: fingerprint,
			});
			setMessage(
				`${result.name} instalado. Habilite os componentes na aba de instalados para usá-los no ${agent === "codex" ? "Codex" : "Claude"}.`,
			);
			onRefresh();
		});
	}
	async function uninstall() {
		if (!detail) return;
		await run(async () => {
			await rpc.request.agentExtensionRemove({ id: detail.id });
			setChange({ id: detail.id, revision: null, baseline: fingerprint });
			setMessage(`${detail.name} desinstalado da biblioteca compartilhada.`);
			onRemoved?.(detail.id);
			onRefresh();
		});
	}
	return (
		<div ref={navigation.ref}>
			{detail ? (
				<ResourceDetail
					name={detail.name}
					backLabel={backLabel}
					onBack={navigation.back}
					busy={busy}
					actions={
						<>
							{installedRevision === detail.revision ? (
								<div className="flex flex-wrap items-center gap-2">
									<p className="text-xs font-medium">
										Instalada na biblioteca compartilhada
									</p>
									{onShowInstalled && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={onShowInstalled}
										>
											Ver {resourceLabels[page]} instalados
										</Button>
									)}
								</div>
							) : (
								<Button
									type="button"
									size="sm"
									disabled={busy || !matches(detail)}
									onClick={() => void install()}
								>
									{installLabel}
								</Button>
							)}
							{!!installedRevision && (
								<UninstallResource
									key={detail.id}
									name={detail.name}
									busy={busy}
									onConfirm={() => void uninstall()}
								/>
							)}
							<p className="text-xs text-muted-foreground">
								A biblioteca é compartilhada. A ativação e os padrões são
								independentes para Claude e Codex.
							</p>
						</>
					}
				>
					<p className="whitespace-pre-wrap break-words">
						{detail.description}
					</p>
					<p className="break-all text-xs text-muted-foreground">
						{detail.url}
					</p>
					{detail.components
						.filter(
							(c) =>
								page === "plugins" ||
								c.kind === (page === "skills" ? "skill" : "mcp"),
						)
						.map((c) => (
							<div key={c.id} className="border-b py-2 text-sm">
								{c.name}
								<span className="ml-2 text-xs text-muted-foreground">
									{componentKindLabel[c.kind]}
								</span>
							</div>
						))}
					{!matches(detail) && (
						<p className="text-sm text-muted-foreground">
							Este pacote não contém {resourceLabels[page]} para esta página.
						</p>
					)}
					{detail.diagnostics.map((d) => (
						<p
							key={`${d.code}:${d.message}`}
							className="text-xs text-muted-foreground"
						>
							{d.message}
						</p>
					))}
					{message && (
						<p role="status" className="text-sm text-muted-foreground">
							{message}
						</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</ResourceDetail>
			) : (
				<>
					<h3 className="mb-3 text-sm font-medium">
						Marketplace de {resourceLabels[page]}
					</h3>
					<div className="space-y-3">
						<label className="block text-xs text-muted-foreground">
							Repositório
							<select
								aria-label={`Fonte de ${resourceLabels[page]}`}
								className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
								value={source}
								disabled={busy}
								onChange={(e) => {
									sequence.current++;
									setSource(e.target.value);
								}}
							>
								{sources.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</select>
						</label>
						<Input
							aria-label={`Buscar no marketplace de ${resourceLabels[page]}`}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={`Buscar ${resourceLabels[page]}`}
							disabled={busy}
						/>
						{page === "skills" && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() =>
									void rpc.request.openUrl({ url: "https://skills.sh" })
								}
							>
								Descobrir no skills.sh
							</Button>
						)}
						{loading && (
							<p role="status" className="text-sm text-muted-foreground">
								Carregando catálogo…
							</p>
						)}
						<div className="divide-y">
							{items
								.filter(
									(p) =>
										`${p.name} ${p.description}`
											.toLocaleLowerCase()
											.includes(query.toLocaleLowerCase()) &&
										(!p.components.length || matches(p)),
								)
								.map((p) => (
									<div key={p.id}>
										<button
											type="button"
											data-resource-id={p.id}
											aria-busy={inspecting === p.id}
											aria-describedby={
												inspecting === p.id || inspectionFailure?.id === p.id
													? inspectionFeedbackId
													: undefined
											}
											disabled={busy}
											onClick={() => void inspect(p)}
											className="block w-full py-3 text-left disabled:cursor-wait"
										>
											<span className="flex items-center gap-2 break-words text-sm font-medium">
												{inspecting === p.id && (
													<Loader2
														aria-hidden="true"
														className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
													/>
												)}
												{p.name}
											</span>
											{installed.some((i) => i.id === p.id) && (
												<span className="text-xs text-muted-foreground">
													Instalado na biblioteca
												</span>
											)}
											<span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
												{p.description ||
													"Verificar os componentes disponíveis neste pacote"}
											</span>
										</button>
										{inspecting === p.id && (
											<p
												id={inspectionFeedbackId}
												role="status"
												className="space-y-1 pb-3 text-xs text-muted-foreground"
											>
												<span className="block font-medium text-foreground">
													Carregando detalhes de {p.name}…
												</span>
												<span className="block">
													A primeira consulta pode demorar um pouco mais.
												</span>
											</p>
										)}
										{inspectionFailure?.id === p.id && (
											<div
												id={inspectionFeedbackId}
												role="alert"
												className="space-y-2 pb-3 text-sm text-destructive"
											>
												<p>{inspectionFailure.message}</p>
												<Button
													type="button"
													variant="outline"
													size="sm"
													disabled={busy}
													onClick={() => void inspect(p)}
												>
													Tentar novamente
												</Button>
											</div>
										)}
									</div>
								))}
							{!loading && !items.length && !error && (
								<p className="py-4 text-sm text-muted-foreground">
									Nenhum pacote nesta fonte.
								</p>
							)}
						</div>
						<form
							className="mt-4 space-y-2 border-t pt-4"
							onSubmit={(e) => {
								e.preventDefault();
								void run(async () => {
									const added = await rpc.request.agentExtensionAddSource({
										url: url.trim(),
									});
									setSources((old) => [
										...old.filter((s) => s.id !== added.id),
										added,
									]);
									setSource(added.id);
									setUrl("");
								});
							}}
						>
							<label
								htmlFor={`marketplace-url-${page}`}
								className="text-sm font-medium"
							>
								Adicionar repositório GitHub
							</label>
							<div className="flex gap-2">
								<Input
									id={`marketplace-url-${page}`}
									type="url"
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="https://github.com/autor/repositorio"
									disabled={busy}
								/>
								<Button
									type="submit"
									variant="outline"
									size="sm"
									disabled={busy || !url.trim()}
								>
									Adicionar fonte
								</Button>
							</div>
						</form>
						{source && !sources.find((s) => s.id === source)?.builtin && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await rpc.request.agentExtensionRemoveSource({
											id: source,
										});
										setSource("");
										setAttempt((a) => a + 1);
									})
								}
							>
								Remover fonte compartilhada
							</Button>
						)}
						{error && (
							<div role="alert" className="text-sm text-destructive">
								{error}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setAttempt((a) => a + 1)}
								>
									Tentar novamente
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
