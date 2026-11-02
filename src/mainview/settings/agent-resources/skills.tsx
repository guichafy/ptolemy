import { useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExtensionSummary } from "@/shared/extensions";
import type { SkillSummary } from "@/shared/skills";
import { errorText } from "../extensions-common";
import { ResourceRow } from "./controls";
import { ResourceDetail, UninstallResource, useResourceDetail } from "./detail";
import { toggleComponent } from "./model";
import type { ResourceWorkspaceProps } from "./workspace";

interface SkillDetail {
	id: string;
	name: string;
	description: string;
	origin: string;
	skill?: SkillSummary;
	pkg?: ExtensionSummary;
	componentId?: string;
	builtinName?: string;
	unavailable?: string;
}
export function SkillsResources({
	agent,
	choices,
	onChange,
	library,
	query,
	capabilities,
	onRefresh,
	onBusyChange,
	archived,
}: ResourceWorkspaceProps & {
	query: string;
	capabilities: import("@/shared/extension-rpc").ExtensionCapability[];
}) {
	const [url, setUrl] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [imported, setImported] = useState<SkillSummary[]>([]);
	const navigation = useResourceDetail<SkillDetail>();
	const label = agent === "claude" ? "Claude" : "Codex";
	const skills = [
		...imported,
		...library.skills.filter((s) => !imported.some((i) => i.id === s.id)),
	];
	const origin = (s: SkillSummary) =>
		library.archiveOnly?.skillIds.includes(s.id)
			? "Arquivada nesta conversa · fora da biblioteca"
			: s.source.kind === "github"
				? "Biblioteca compartilhada · importada do GitHub"
				: s.origin === "system"
					? `Integrada ao ${label}`
					: s.origin === "shared"
						? `Diretório compartilhado de Skills · disponível no ${label}`
						: `Instalada no ${label}`;
	const toggle = (
		field: "skillIds" | "builtinCommandNames",
		id: string,
		checked: boolean,
	) =>
		onChange({
			...choices,
			[field]: checked
				? [...new Set([...choices[field], id])]
				: choices[field].filter((n) => n !== id),
		});
	const visible = (text: string) =>
		text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
	const selectionDisabled = busy || library.loading || !!library.error;
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
	async function importSkill() {
		await run(async () => {
			const skill = await rpc.request.agentImportSkill({ url: url.trim() });
			setImported((p) => [...p.filter((s) => s.id !== skill.id), skill]);
			onChange({
				...choices,
				skillIds: [...new Set([...choices.skillIds, skill.id])],
			});
			setUrl("");
			onRefresh();
		});
	}
	const detail = navigation.detail;
	const checked = detail?.skill
		? choices.skillIds.includes(detail.skill.id)
		: detail?.builtinName
			? choices.builtinCommandNames.includes(detail.builtinName)
			: !!detail?.pkg &&
				choices.extensionSelections.some(
					(s) =>
						s.packageId === detail.pkg!.id &&
						s.revision === detail.pkg!.revision &&
						s.componentIds.includes(detail.componentId!),
				);
	function changeDetail(value: boolean) {
		if (!detail) return;
		if (detail.skill) toggle("skillIds", detail.skill.id, value);
		else if (detail.builtinName)
			toggle("builtinCommandNames", detail.builtinName, value);
		else if (detail.pkg)
			onChange(
				toggleComponent(choices, detail.pkg, detail.componentId!, value),
			);
	}
	const removable =
		!!detail &&
		((detail.skill?.source.kind === "github" &&
			!library.archiveOnly?.skillIds.includes(detail.skill.id)) ||
			(!!detail.pkg &&
				!library.archiveOnly?.packageRevisions.includes(
					`${detail.pkg.id}:${detail.pkg.revision}`,
				)));
	async function uninstall() {
		if (!detail || !removable) return;
		await run(async () => {
			if (detail.skill) {
				await rpc.request.agentRemoveSkill({ id: detail.skill.id });
				setImported((p) => p.filter((s) => s.id !== detail.skill!.id));
				if (!archived?.choices.skillIds.includes(detail.skill.id))
					onChange({
						...choices,
						skillIds: choices.skillIds.filter((id) => id !== detail.skill!.id),
					});
			} else if (detail.pkg) {
				await rpc.request.agentExtensionRemove({ id: detail.pkg.id });
				onChange({
					...choices,
					extensionSelections: choices.extensionSelections.filter(
						(s) =>
							s.packageId !== detail.pkg!.id ||
							archived?.choices.extensionSelections.some(
								(a) => a.packageId === s.packageId && a.revision === s.revision,
							),
					),
				});
			}
			onRefresh();
			navigation.back();
		});
	}
	return (
		<div ref={navigation.ref}>
			{detail ? (
				<ResourceDetail
					name={detail.name}
					backLabel="Voltar à lista de Skills"
					onBack={navigation.back}
					busy={busy}
					actions={
						<>
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									aria-label={`Usar ${detail.name}`}
									checked={checked}
									disabled={
										selectionDisabled || (!checked && !!detail.unavailable)
									}
									onChange={(e) => changeDetail(e.target.checked)}
									className="accent-primary"
								/>
								Habilitar nesta seleção do {label}
							</label>
							{removable && (
								<UninstallResource
									name={detail.pkg?.name ?? detail.name}
									busy={busy}
									onConfirm={() => void uninstall()}
								/>
							)}
						</>
					}
				>
					<p className="text-xs text-muted-foreground">{detail.origin}</p>
					<p className="whitespace-pre-wrap break-words leading-relaxed">
						{detail.description}
					</p>
					{detail.skill?.source.kind === "harness" && (
						<p className="text-xs text-muted-foreground">
							Instalação gerenciada pelo {label}. Ative ou desative a Skill
							nesta seleção. A desinstalação é feita no diretório de origem pelo
							gerenciador do CLI.
						</p>
					)}
					{detail.builtinName && (
						<p className="text-xs text-muted-foreground">
							Recurso integrado ao {label}. A ativação é controlada nesta
							seleção.
						</p>
					)}
					{detail.skill?.localPath && (
						<div className="space-y-1">
							<p className="text-xs font-medium">Origem da instalação</p>
							<p className="break-all text-xs text-muted-foreground">
								{detail.skill.localPath}
							</p>
						</div>
					)}
					{detail.skill?.source.kind === "github" && (
						<p className="break-all text-xs text-muted-foreground">
							{detail.skill.source.url}
						</p>
					)}
					{detail.pkg && (
						<p className="break-words text-xs text-muted-foreground">
							Esta Skill faz parte do pacote {detail.pkg.name}. A desinstalação
							remove o pacote da biblioteca compartilhada.
						</p>
					)}
					{detail.unavailable && (
						<p className="text-xs text-destructive">{detail.unavailable}</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</ResourceDetail>
			) : (
				<>
					<p className="mb-2 text-xs text-muted-foreground">
						A seleção de Skills é independente no {label}. Instalar e
						desinstalar altera a biblioteca compartilhada; marcar uma Skill
						define seu uso nesta seleção.
					</p>
					{skills
						.filter((s) => visible(`${s.name} ${s.description}`))
						.map((s) => (
							<ResourceRow
								key={s.id}
								resourceId={s.id}
								name={s.name}
								description={s.description}
								origin={origin(s)}
								unavailableReason={s.unavailableReason}
								checked={choices.skillIds.includes(s.id)}
								disabled={
									selectionDisabled ||
									(!choices.skillIds.includes(s.id) && !!s.unavailableReason)
								}
								onChange={(checked) => toggle("skillIds", s.id, checked)}
								onDetails={() =>
									navigation.open({
										id: s.id,
										name: s.name,
										description: s.description,
										origin: origin(s),
										skill: s,
										unavailable: s.unavailableReason,
									})
								}
							/>
						))}
					{choices.skillIds
						.filter((id) => !skills.some((s) => s.id === id))
						.map((id) => (
							<ResourceRow
								key={id}
								name={id}
								origin="Indisponível na biblioteca"
								checked
								disabled={busy}
								onChange={() => toggle("skillIds", id, false)}
							/>
						))}
					{library.inventory?.builtins
						.filter(
							(b) =>
								b.kind === "skill" && visible(`${b.name} ${b.description}`),
						)
						.map((b) => (
							<ResourceRow
								key={b.name}
								resourceId={b.id}
								name={`Skill interna ${b.name}`}
								description={`${b.description} ${b.limitation ?? ""}`}
								origin={`Integrada ao ${label}`}
								checked={choices.builtinCommandNames.includes(b.name)}
								disabled={selectionDisabled}
								onChange={(checked) =>
									toggle("builtinCommandNames", b.name, checked)
								}
								onDetails={() =>
									navigation.open({
										id: b.id,
										name: b.name,
										description: `${b.description} ${b.limitation ?? ""}`,
										origin: `Integrada ao ${label}`,
										builtinName: b.name,
									})
								}
							/>
						))}
					{library.inventory?.installed.flatMap((pkg) =>
						pkg.components
							.filter(
								(c) =>
									c.kind === "skill" &&
									visible(`${pkg.name} ${c.name} ${c.description ?? ""}`),
							)
							.map((c) => {
								const cap = capabilities.find(
									(cap) =>
										cap.packageId === pkg.id &&
										cap.componentId === c.id &&
										(!cap.revision || cap.revision === pkg.revision),
								);
								const checked = choices.extensionSelections.some(
									(s) =>
										s.packageId === pkg.id &&
										s.revision === pkg.revision &&
										s.componentIds.includes(c.id),
								);
								const id = `${pkg.id}:${pkg.revision}:${c.id}`;
								const origin = `${library.archiveOnly?.packageRevisions.includes(`${pkg.id}:${pkg.revision}`) ? "Arquivada nesta conversa · " : "Biblioteca compartilhada · "}Plugin ${pkg.name} · ${pkg.revision.slice(0, 8)}`;
								const unavailable =
									!cap || !["native", "adapted"].includes(cap.status)
										? (cap?.reason ?? "Verificando compatibilidade…")
										: undefined;
								return (
									<ResourceRow
										key={id}
										resourceId={id}
										name={`${pkg.name}: ${c.name}`}
										origin={origin}
										description={c.description ?? cap?.reason}
										checked={checked}
										disabled={selectionDisabled || (!checked && !!unavailable)}
										onChange={(checked) =>
											onChange(toggleComponent(choices, pkg, c.id, checked))
										}
										onDetails={() =>
											navigation.open({
												id,
												name: c.name,
												description: c.description ?? cap?.reason ?? "",
												origin,
												pkg,
												componentId: c.id,
												unavailable,
											})
										}
									/>
								);
							}),
					)}
					{!skills.length &&
						!library.inventory?.builtins.some((b) => b.kind === "skill") &&
						!library.inventory?.installed.some((p) =>
							p.components.some((c) => c.kind === "skill"),
						) &&
						!library.loading && (
							<p className="py-5 text-sm text-muted-foreground">
								Nenhuma Skill disponível. Explore o marketplace ou importe do
								GitHub.
							</p>
						)}
					<form
						className="mt-5 space-y-2 border-t pt-4"
						onSubmit={(e) => {
							e.preventDefault();
							void importSkill();
						}}
					>
						<label htmlFor="resource-skill-url" className="text-sm font-medium">
							URL da Skill no GitHub
						</label>
						<div className="flex gap-2">
							<Input
								id="resource-skill-url"
								type="url"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="https://github.com/autor/repo/tree/main/skill"
								disabled={busy}
							/>
							<Button
								type="submit"
								variant="outline"
								disabled={busy || !url.trim()}
							>
								Importar Skill
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							A importação instala na biblioteca compartilhada e seleciona a
							Skill somente no {label}.
						</p>
					</form>
					{error && (
						<p role="alert" className="mt-2 text-sm text-destructive">
							{error}
						</p>
					)}
				</>
			)}
		</div>
	);
}
