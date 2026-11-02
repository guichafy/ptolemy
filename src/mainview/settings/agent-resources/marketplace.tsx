import { useEffect, useRef, useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionSource, ExtensionSummary } from "@/shared/extensions";
import { componentKindLabel, errorText } from "../extensions-common";
import { type ResourcePage, resourceLabels } from "./model";
export function ResourceMarketplace({
	agent,
	page,
	onRefresh,
	onBusyChange,
}: {
	agent: AgentKind;
	page: ResourcePage;
	onRefresh: () => void;
	onBusyChange?: (busy: boolean) => void;
}) {
	const [sources, setSources] = useState<ExtensionSource[]>([]);
	const [source, setSource] = useState("");
	const [items, setItems] = useState<ExtensionSummary[]>([]);
	const [detail, setDetail] = useState<ExtensionSummary | null>(null);
	const [url, setUrl] = useState("");
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [attempt, setAttempt] = useState(0);
	const sequence = useRef(0);
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
				setSource((old) =>
					r.some((s) => s.id === old)
						? old
						: (r.find((s) =>
								page === "skills"
									? s.name === "anthropics/skills"
									: s.name === "anthropics/claude-plugins-official",
							)?.id ??
							r[0]?.id ??
							""),
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
	}, [page, attempt]);
	useEffect(() => {
		void attempt;
		if (!source) return;
		let cancelled = false;
		sequence.current++;
		setLoading(true);
		setError(null);
		setItems([]);
		setDetail(null);
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
		const request = ++sequence.current;
		setDetail(null);
		setMessage("");
		await run(async () => {
			const r = await rpc.request.agentExtensionInspect({
				sourceId: source,
				itemId: pkg.id,
				agent,
			});
			if (sequence.current === request) setDetail(r.summary);
		});
	}
	const matches = (pkg: ExtensionSummary) =>
		page === "plugins"
			? pkg.components.some((c) => c.kind !== "other")
			: pkg.components.some(
					(c) => c.kind === (page === "skills" ? "skill" : "mcp"),
				);
	return (
		<div>
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
				/>
				{page === "skills" && (
					<Button
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
				{detail ? (
					<div className="space-y-3">
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => setDetail(null)}
						>
							Voltar ao catálogo
						</Button>
						<h4 className="break-words text-base font-medium">{detail.name}</h4>
						<p className="break-words text-sm text-muted-foreground">
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
								className="text-xs text-muted-foreground"
								key={`${d.code}:${d.message}`}
							>
								{d.message}
							</p>
						))}
						<Button
							size="sm"
							disabled={busy || !matches(detail)}
							onClick={() =>
								void run(async () => {
									const result = await rpc.request.agentExtensionInstall({
										sourceId: source,
										itemId: detail.id,
									});
									setMessage(
										`${result.name} instalado na biblioteca. Ative os componentes na aba de instalados.`,
									);
									onRefresh();
								})
							}
						>
							Instalar na biblioteca
						</Button>
						<p className="text-xs text-muted-foreground">
							A instalação é compartilhada pelos agentes. A ativação é
							configurada separadamente.
						</p>
					</div>
				) : (
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
								<button
									type="button"
									key={p.id}
									disabled={busy}
									onClick={() => void inspect(p)}
									className="block w-full py-3 text-left"
								>
									<span className="block break-words text-sm font-medium">
										{p.name}
									</span>
									<span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
										{p.description ||
											"Verificar os componentes disponíveis neste pacote"}
									</span>
								</button>
							))}
						{!loading && !items.length && !error && (
							<p className="py-4 text-sm text-muted-foreground">
								Nenhum pacote nesta fonte.
							</p>
						)}
					</div>
				)}
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
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() =>
							void run(async () => {
								await rpc.request.agentExtensionRemoveSource({ id: source });
								setSource("");
								setAttempt((a) => a + 1);
							})
						}
					>
						Remover fonte compartilhada
					</Button>
				)}
				{message && (
					<p role="status" className="text-sm text-muted-foreground">
						{message}
					</p>
				)}
				{error && (
					<div role="alert" className="text-sm text-destructive">
						{error}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setAttempt((a) => a + 1)}
						>
							Tentar novamente
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
