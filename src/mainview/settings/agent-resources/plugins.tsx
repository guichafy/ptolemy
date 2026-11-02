import { useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import type { ExtensionSummary } from "@/shared/extensions";
import { componentKindLabel, errorText } from "../extensions-common";
import { ResourceRow } from "./controls";
import { toggleComponent } from "./model";
import type { ResourceWorkspaceProps } from "./workspace";
export function PluginsResources({
	agent,
	library,
	choices,
	onChange,
	onRefresh,
	onBusyChange,
	query,
	capabilities,
}: ResourceWorkspaceProps & {
	query: string;
	capabilities: import("@/shared/extension-rpc").ExtensionCapability[];
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		onBusyChange?.(true);
		setError(null);
		try {
			await action();
			onRefresh();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
			onBusyChange?.(false);
		}
	}
	function trust(pkg: ExtensionSummary, checked: boolean) {
		const old = choices.extensionSelections.find(
			(s) => s.packageId === pkg.id && s.revision === pkg.revision,
		) ?? { packageId: pkg.id, revision: pkg.revision, componentIds: [] };
		const next = {
			...old,
			trustedHookDigest: checked ? pkg.revision : undefined,
			componentIds: checked
				? old.componentIds
				: old.componentIds.filter(
						(id) => pkg.components.find((c) => c.id === id)?.kind !== "hook",
					),
		};
		onChange({
			...choices,
			extensionSelections: [
				...choices.extensionSelections.filter((s) => s.packageId !== pkg.id),
				next,
			],
		});
	}
	const disabled = busy || library.loading || !!library.error;
	return (
		<div>
			{library.inventory?.installed
				.filter((p) =>
					`${p.name} ${p.description}`
						.toLocaleLowerCase()
						.includes(query.toLocaleLowerCase()),
				)
				.map((pkg) => {
					const selected = choices.extensionSelections.find(
						(s) => s.packageId === pkg.id && s.revision === pkg.revision,
					);
					return (
						<details
							key={`${pkg.id}:${pkg.revision}`}
							className="resource-package border-b py-3"
							open={undefined}
						>
							<summary className="cursor-pointer text-sm font-medium">
								{pkg.name}
								<span className="ml-2 text-xs font-normal text-muted-foreground">
									{selected?.componentIds.length ?? 0} componentes ·{" "}
									{pkg.revision.slice(0, 8)}
								</span>
							</summary>
							<div className="mt-3 space-y-2 pl-2">
								<p className="break-words text-xs text-muted-foreground">
									{pkg.description}
								</p>
								<p className="break-all text-xs text-muted-foreground">
									{pkg.url}
								</p>
								{pkg.diagnostics?.map((d) => (
									<p
										key={`${d.code}:${d.message}`}
										className="text-xs text-muted-foreground"
									>
										{d.message}
									</p>
								))}
								{pkg.components.some((c) => c.kind === "hook") && (
									<label className="flex items-start gap-2 py-2 text-xs">
										<input
											type="checkbox"
											className="mt-0.5 accent-primary"
											aria-label={`Autorizar hooks de ${pkg.name}`}
											checked={selected?.trustedHookDigest === pkg.revision}
											disabled={disabled}
											onChange={(e) => trust(pkg, e.target.checked)}
										/>
										<span>
											Autorizar os hooks da revisão {pkg.revision.slice(0, 12)}.
											Eles podem executar comandos com escrita restrita ao
											projeto.
										</span>
									</label>
								)}
								{pkg.components.map((c) => {
									const cap = capabilities.find(
										(cap) =>
											cap.packageId === pkg.id &&
											cap.componentId === c.id &&
											(!cap.revision || cap.revision === pkg.revision),
									);
									const checked =
										selected?.componentIds.includes(c.id) ?? false;
									return (
										<ResourceRow
											key={c.id}
											name={`${pkg.name}: ${c.name}`}
											origin={componentKindLabel[c.kind]}
											description={`${c.description ?? ""} ${cap?.reason ?? "Verificando compatibilidade…"}`}
											checked={checked}
											disabled={
												disabled ||
												(!checked &&
													(!cap || !["native", "adapted"].includes(cap.status)))
											}
											onChange={(value) =>
												onChange(toggleComponent(choices, pkg, c.id, value))
											}
										/>
									);
								})}
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() =>
										void run(() =>
											rpc.request.agentExtensionRemove({ id: pkg.id }),
										)
									}
								>
									Remover da biblioteca compartilhada
								</Button>
								<p className="text-xs text-muted-foreground">
									A remoção afeta a biblioteca dos dois agentes. Conversas
									existentes mantêm seus snapshots.
								</p>
							</div>
						</details>
					);
				})}
			{choices.extensionSelections
				.filter(
					(s) =>
						!library.inventory?.installed.some(
							(p) => p.id === s.packageId && p.revision === s.revision,
						),
				)
				.map((s) => (
					<div key={s.packageId} className="resource-row">
						<p className="break-all text-sm">Seleção antiga: {s.packageId}</p>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								onChange({
									...choices,
									extensionSelections: choices.extensionSelections.filter(
										(x) => x.packageId !== s.packageId,
									),
								})
							}
						>
							Remover seleção indisponível
						</Button>
					</div>
				))}
			{choices.builtinCommandNames
				.filter(
					(name) => !library.inventory?.builtins.some((b) => b.name === name),
				)
				.map((name) => (
					<ResourceRow
						key={`missing:${name}`}
						name={`comando interno ${name}`}
						origin="Indisponível no runtime atual"
						checked
						onChange={() =>
							onChange({
								...choices,
								builtinCommandNames: choices.builtinCommandNames.filter(
									(n) => n !== name,
								),
							})
						}
					/>
				))}
			{library.inventory?.builtins.some((b) => b.kind === "command") && (
				<h3 className="mt-5 text-sm font-medium">Comandos integrados</h3>
			)}
			{library.inventory?.builtins
				.filter((b) => b.kind === "command")
				.map((b) => (
					<ResourceRow
						key={b.name}
						name={`comando interno ${b.name}`}
						description={`${b.description} ${b.limitation ?? ""}`}
						checked={choices.builtinCommandNames.includes(b.name)}
						disabled={disabled}
						onChange={(checked) =>
							onChange({
								...choices,
								builtinCommandNames: checked
									? [...choices.builtinCommandNames, b.name]
									: choices.builtinCommandNames.filter((n) => n !== b.name),
							})
						}
					/>
				))}
			<h3 className="mt-5 text-sm font-medium">
				Plugins locais do {agent === "claude" ? "Claude" : "Codex"}
			</h3>
			{library.inventory?.nativePlugins.map((p) => (
				<div key={p.id} className="resource-row">
					<p className="break-words text-sm font-medium">{p.name}</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{p.enabled ? "Ativo no CLI" : "Instalado no CLI"}
						{p.managed ? " · Obrigatório por política" : ""}
					</p>
					{p.importLimitation && (
						<p className="text-xs text-muted-foreground">
							{p.importLimitation}
						</p>
					)}
					<Button
						className="mt-2"
						size="sm"
						variant="outline"
						disabled={busy || !p.canImport}
						onClick={() =>
							void run(() =>
								rpc.request.agentExtensionImportNative({ agent, id: p.id }),
							)
						}
					>
						Importar pacote local
					</Button>
				</div>
			))}
			{!library.inventory?.installed.length &&
				!library.inventory?.nativePlugins.length &&
				!library.loading && (
					<p className="py-4 text-sm text-muted-foreground">
						Nenhum plugin disponível. Explore o marketplace para adicionar.
					</p>
				)}
			{error && (
				<p role="alert" className="mt-3 text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
