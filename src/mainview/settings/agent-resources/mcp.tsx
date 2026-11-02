import { useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import type { McpEditableServer } from "@/shared/mcp";
import { errorText } from "../extensions-common";
import { McpEditor } from "../extensions-mcp-editor";
import { ResourceRow } from "./controls";
import { toggleComponent } from "./model";
import type { ResourceWorkspaceProps } from "./workspace";
export function McpResources({
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
	const [editor, setEditor] = useState<{
		draft: McpEditableServer;
		saved: boolean;
		binding?: { packageId: string; revision: string; componentId: string };
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function run(action: () => Promise<unknown>) {
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
	if (editor)
		return (
			<div>
				<Button
					variant="ghost"
					size="sm"
					className="mb-3"
					disabled={busy}
					onClick={() => {
						setEditor(null);
						onRefresh();
					}}
				>
					Voltar aos servidores
				</Button>
				<McpEditor
					onBusyChange={(value) => {
						setBusy(value);
						onBusyChange?.(value);
					}}
					initial={editor.draft}
					isSaved={editor.saved}
					binding={editor.binding}
					onSaved={onRefresh}
					onCancel={() => {
						setEditor(null);
						onRefresh();
					}}
				/>
			</div>
		);
	const packageMcp =
		library.inventory?.installed.flatMap((p) =>
			p.components.filter((c) => c.kind === "mcp").map((c) => ({ pkg: p, c })),
		) ?? [];
	return (
		<div>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">
					Conectar uma conta não ativa o servidor na conversa.
				</p>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() =>
						setEditor({
							saved: false,
							draft: {
								id: crypto.randomUUID(),
								name: "",
								transport: "stdio",
								command: "",
								args: [],
								defaults: { claude: false, codex: false },
							},
						})
					}
				>
					Novo servidor
				</Button>
			</div>
			{agent === "codex" && (
				<p className="mb-3 text-xs text-muted-foreground">
					Os servidores selecionados podem chamar ferramentas sem confirmação a
					cada chamada, dentro das permissões do Codex.
				</p>
			)}
			{library.servers
				.filter(
					(s) =>
						!s.packageId &&
						s.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
				)
				.map((s) => (
					<ResourceRow
						key={s.id}
						name={s.name}
						origin={`${library.archiveOnly?.serverIds.includes(s.id) ? "Arquivado nesta conversa · " : ""}${s.transport} · ${s.connection.state}`}
						description={s.authentication?.reason}
						checked={choices.mcpServerIds.includes(s.id)}
						disabled={
							busy ||
							library.loading ||
							(!choices.mcpServerIds.includes(s.id) &&
								s.authentication?.ready === false)
						}
						onChange={(checked) =>
							onChange({
								...choices,
								mcpServerIds: checked
									? [...choices.mcpServerIds, s.id]
									: choices.mcpServerIds.filter((id) => id !== s.id),
							})
						}
					>
						{!library.archiveOnly?.serverIds.includes(s.id) && (
							<div className="mt-2 flex gap-2 pl-7">
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() =>
										void run(async () =>
											setEditor({
												saved: true,
												draft: await rpc.request.agentMcpGetEditable({
													id: s.id,
												}),
											}),
										)
									}
								>
									Configurar {s.name}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											await rpc.request.agentMcpRemove({ id: s.id });
											onRefresh();
										})
									}
								>
									Remover da biblioteca
								</Button>
							</div>
						)}
					</ResourceRow>
				))}
			{packageMcp
				.filter(({ pkg, c }) =>
					`${pkg.name} ${c.name}`
						.toLocaleLowerCase()
						.includes(query.toLocaleLowerCase()),
				)
				.map(({ pkg, c }) => {
					const checked = choices.extensionSelections.some(
						(s) =>
							s.packageId === pkg.id &&
							s.revision === pkg.revision &&
							s.componentIds.includes(c.id),
					);
					const cap = capabilities.find(
						(cap) =>
							cap.packageId === pkg.id &&
							cap.componentId === c.id &&
							(!cap.revision || cap.revision === pkg.revision),
					);
					return (
						<ResourceRow
							key={`${pkg.id}:${pkg.revision}:${c.id}`}
							name={`${pkg.name}: ${c.name}`}
							origin={`${library.archiveOnly?.packageRevisions.includes(`${pkg.id}:${pkg.revision}`) ? "Arquivado nesta conversa · " : ""}Plugin ${pkg.name}`}
							description={cap?.reason}
							checked={checked}
							disabled={
								busy ||
								library.loading ||
								(!checked &&
									(!cap || !["native", "adapted"].includes(cap.status)))
							}
							onChange={(value) =>
								onChange(toggleComponent(choices, pkg, c.id, value))
							}
						>
							{!library.archiveOnly?.packageRevisions.includes(
								`${pkg.id}:${pkg.revision}`,
							) && (
								<Button
									className="mt-2 ml-7"
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											const binding = {
												packageId: pkg.id,
												revision: pkg.revision,
												componentId: c.id,
											};
											const draft =
												await rpc.request.agentMcpBindingDraft(binding);
											setEditor({
												saved: library.servers.some((s) => s.id === draft.id),
												draft,
												binding,
											});
										})
									}
								>
									Configurar MCP do plugin
								</Button>
							)}
						</ResourceRow>
					);
				})}
			{choices.mcpServerIds
				.filter((id) => !library.servers.some((s) => s.id === id))
				.map((id) => (
					<ResourceRow
						key={id}
						name={id}
						origin="Indisponível na biblioteca"
						checked
						onChange={() =>
							onChange({
								...choices,
								mcpServerIds: choices.mcpServerIds.filter((s) => s !== id),
							})
						}
					/>
				))}
			{!library.servers.length && !packageMcp.length && !library.loading && (
				<p className="py-5 text-sm text-muted-foreground">
					Nenhum servidor configurado. Adicione um servidor local ou HTTP.
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
