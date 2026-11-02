import { useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SkillSummary } from "@/shared/skills";
import { errorText } from "../extensions-common";
import { ResourceRow } from "./controls";
import { toggleComponent } from "./model";
import type { ResourceWorkspaceProps } from "./workspace";
export function SkillsResources({
	choices,
	onChange,
	library,
	query,
	capabilities,
	onRefresh,
	onBusyChange,
}: ResourceWorkspaceProps & {
	query: string;
	capabilities: import("@/shared/extension-rpc").ExtensionCapability[];
}) {
	const [url, setUrl] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [imported, setImported] = useState<SkillSummary[]>([]);
	const skills = [
		...imported,
		...library.skills.filter((s) => !imported.some((i) => i.id === s.id)),
	];
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
	async function importSkill() {
		setBusy(true);
		onBusyChange?.(true);
		setError(null);
		try {
			const skill = await rpc.request.agentImportSkill({ url: url.trim() });
			setImported((p) => [...p.filter((s) => s.id !== skill.id), skill]);
			onChange({
				...choices,
				skillIds: [...new Set([...choices.skillIds, skill.id])],
			});
			setUrl("");
			onRefresh();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
			onBusyChange?.(false);
		}
	}
	const selectionDisabled = busy || library.loading || !!library.error;
	return (
		<div>
			{skills
				.filter((s) => visible(`${s.name} ${s.description}`))
				.map((s) => (
					<ResourceRow
						key={s.id}
						name={s.name}
						description={s.description}
						unavailableReason={s.unavailableReason}
						origin={
							library.archiveOnly?.skillIds.includes(s.id)
								? "Arquivada nesta conversa · fora da biblioteca"
								: s.source.kind === "github"
									? "Importada do GitHub"
									: s.origin === "system"
										? "Integrada ao sistema"
										: "Instalada localmente"
						}
						checked={choices.skillIds.includes(s.id)}
						disabled={
							selectionDisabled ||
							(!choices.skillIds.includes(s.id) && !!s.unavailableReason)
						}
						onChange={(checked) => toggle("skillIds", s.id, checked)}
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
					(b) => b.kind === "skill" && visible(`${b.name} ${b.description}`),
				)
				.map((b) => (
					<ResourceRow
						key={b.name}
						name={`Skill interna ${b.name}`}
						description={`${b.description} ${b.limitation ?? ""}`}
						origin="Integrada ao Claude"
						checked={choices.builtinCommandNames.includes(b.name)}
						disabled={selectionDisabled}
						onChange={(checked) =>
							toggle("builtinCommandNames", b.name, checked)
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
						return (
							<ResourceRow
								key={`${pkg.id}:${pkg.revision}:${c.id}`}
								name={`${pkg.name}: ${c.name}`}
								origin={`${library.archiveOnly?.packageRevisions.includes(`${pkg.id}:${pkg.revision}`) ? "Arquivada nesta conversa · " : ""}Plugin ${pkg.name} · ${pkg.revision.slice(0, 8)}`}
								description={c.description ?? cap?.reason}
								checked={checked}
								disabled={
									selectionDisabled ||
									(!checked &&
										(!cap || !["native", "adapted"].includes(cap.status)))
								}
								onChange={(checked) =>
									onChange(toggleComponent(choices, pkg, c.id, checked))
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
					A importação adiciona a Skill à biblioteca compartilhada.
				</p>
			</form>
			{error && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
