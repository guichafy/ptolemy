import { Blocks, BookOpen, Plug, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
	type ResourceLibrary,
	type ResourcePage,
	resourceCounts,
	resourceLabels,
	sessionCapabilities,
	withArchived,
} from "@/mainview/settings/agent-resources/model";
import {
	type PackageReviewState,
	usePackageReview,
} from "@/mainview/settings/agent-resources/use-resource-library";
import { ResourceWorkspace } from "@/mainview/settings/agent-resources/workspace";
import { errorText } from "@/mainview/settings/extensions-common";
import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionChoices,
	SessionResourceConfiguration,
} from "@/shared/extension-rpc";

const pages = ["skills", "plugins", "mcp"] as const;
const icons = { skills: BookOpen, plugins: Blocks, mcp: Plug };
export interface ConversationConfigurationProps {
	agent: AgentKind;
	scopeKey?: string;
	configurationReady?: boolean;
	library: ResourceLibrary;
	choices: ExtensionChoices;
	onApply: (choices: ExtensionChoices) => void | Promise<void>;
	onRefresh: () => void;
	archived?: SessionResourceConfiguration;
	blocked?: string | null;
	disabled?: boolean;
	onOpenChange?: (open: boolean) => void;
	review?: PackageReviewState;
}
export function ConversationConfiguration(
	props: ConversationConfigurationProps,
) {
	return (
		<ScopedConversationConfiguration
			key={props.scopeKey ?? props.agent}
			{...props}
		/>
	);
}
function ScopedConversationConfiguration(
	props: ConversationConfigurationProps,
) {
	const {
		agent,
		choices,
		onApply,
		onRefresh,
		archived,
		blocked,
		disabled,
		onOpenChange,
	} = props;
	const library = withArchived(props.library, archived);
	const localReview = usePackageReview(
		agent,
		library.inventory?.installed ?? [],
		choices.extensionSelections,
		!props.review,
	);
	const review = props.review ?? localReview;
	const capabilities = sessionCapabilities(
		choices,
		review.capabilities,
		archived,
	);

	const counts = resourceCounts(library, choices, capabilities);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [summary, setSummary] = useState(false);
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState<ResourcePage>("skills");
	const [draft, setDraft] = useState(choices);
	const selectionReady = props.configurationReady ?? !props.library.loading;
	const [draftInitialized, setDraftInitialized] = useState(false);
	useEffect(() => {
		if (open && !draftInitialized && selectionReady) {
			setDraft(structuredClone(choices));
			setDraftInitialized(true);
		}
	}, [open, draftInitialized, selectionReady, choices]);
	const [busy, setBusy] = useState(false);
	const [libraryBusy, setLibraryBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	function changeOpen(value: boolean) {
		if (busy || libraryBusy) return;
		setOpen(value);
		onOpenChange?.(value);
	}
	function configure(target: ResourcePage) {
		setSummary(false);
		setPage(target);
		setDraft(structuredClone(choices));
		setDraftInitialized(selectionReady);
		setError(null);
		setMessage(null);
		setOpen(true);
		onOpenChange?.(true);
	}
	useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
	async function apply() {
		if (
			!draftInitialized ||
			busy ||
			libraryBusy ||
			blocked ||
			library.loading ||
			library.error
		)
			return;
		setBusy(true);
		setError(null);
		try {
			const missingSkill = draft.skillIds.find(
				(id) =>
					!library.skills.some((s) => s.id === id && !s.unavailableReason),
			);
			if (missingSkill)
				throw Error("Remova a Skill indisponível antes de aplicar a seleção.");
			const missingServer = draft.mcpServerIds.find(
				(id) =>
					!library.servers.some(
						(s) =>
							s.id === id && !s.packageId && s.authentication?.ready !== false,
					),
			);
			if (missingServer)
				throw Error(
					"Conecte ou remova o servidor MCP indisponível antes de aplicar.",
				);
			const fresh = draft.extensionSelections.length
				? await rpc.request.agentExtensionCapabilities({
						agent,
						selections: draft.extensionSelections,
					})
				: [];
			const unavailable = sessionCapabilities(draft, fresh, archived).find(
				(c) => ["incompatible", "requires-configuration"].includes(c.status),
			);
			if (unavailable) throw Error(unavailable.reason);
			await onApply(structuredClone(draft));
			setOpen(false);
			onOpenChange?.(false);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}
	async function saveDefaults() {
		if (!draftInitialized) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await rpc.request.agentExtensionSetDefaults({ agent, ...draft });
			setMessage("Padrão salvo para novas conversas.");
			onRefresh();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}
	const canSaveDefaults =
		draft.skillIds.every((id) =>
			props.library.skills.some((s) => s.id === id && !s.unavailableReason),
		) &&
		draft.extensionSelections.every((s) =>
			props.library.inventory?.installed.some(
				(p) => p.id === s.packageId && p.revision === s.revision,
			),
		) &&
		draft.mcpServerIds.every((id) =>
			props.library.servers.some((s) => s.id === id && !s.packageId),
		);
	return (
		<>
			<Popover open={summary} onOpenChange={setSummary}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						ref={triggerRef}
						aria-label="Configurar recursos da conversa"
						disabled={disabled}
						className="h-8 shrink-0 gap-1.5 text-xs text-muted-foreground"
					>
						<Settings2 className="h-4 w-4" />
						<span>Configurar</span>
						{counts.skills + counts.plugins + counts.mcp > 0 && (
							<span className="rounded-md bg-accent px-1.5 tabular-nums">
								{counts.skills + counts.plugins + counts.mcp}
							</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="w-[280px] max-w-[calc(100vw-24px)] p-3"
					data-resource-summary
				>
					<p className="mb-2 text-sm font-medium">
						Recursos da conversa
						<span className="ml-2 text-xs font-normal text-muted-foreground">
							{agent === "claude" ? "Claude" : "Codex"}
						</span>
					</p>
					{pages.map((p) => {
						const Icon = icons[p];
						return (
							<button
								type="button"
								key={p}
								onClick={() => configure(p)}
								aria-label={`Configurar ${resourceLabels[p]} da conversa (${counts[p]})`}
								className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent"
							>
								<Icon className="h-4 w-4 text-muted-foreground" />
								<span>{resourceLabels[p]}</span>
								<span className="ml-auto tabular-nums text-muted-foreground">
									{counts[p]}
								</span>
							</button>
						);
					})}
					{(library.error || review.error || blocked) && (
						<p className="my-2 text-xs text-muted-foreground">
							Há recursos que precisam de revisão.
						</p>
					)}
					<Button
						variant="outline"
						size="sm"
						className="mt-2 w-full"
						onClick={() => configure("skills")}
					>
						Configurar conversa
					</Button>
				</PopoverContent>
			</Popover>
			<Dialog open={open} onOpenChange={changeOpen}>
				<DialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						triggerRef.current?.focus();
					}}
					onSubmit={(event) => event.stopPropagation()}
					showCloseButton={!(busy || libraryBusy)}
					onEscapeKeyDown={(e) => {
						if (busy || libraryBusy) e.preventDefault();
					}}
					onInteractOutside={(e) => {
						if (busy || libraryBusy) e.preventDefault();
					}}
					className="flex h-[min(680px,calc(100vh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]"
				>
					<header className="shrink-0 border-b px-5 py-4 pr-12">
						<DialogTitle>Configuração da conversa</DialogTitle>
						<DialogDescription className="mt-1">
							{agent === "claude" ? "Claude" : "Codex"} ·{" "}
							{archived
								? "As mudanças passam a valer nas próximas mensagens."
								: "Escolha os recursos para iniciar a conversa."}
						</DialogDescription>
					</header>
					<div className="flex min-h-0 flex-1">
						<nav
							aria-label="Recursos da conversa"
							className="w-[136px] shrink-0 space-y-1 border-r bg-muted/10 p-3"
						>
							{pages.map((p) => {
								const Icon = icons[p];
								return (
									<button
										type="button"
										key={p}
										disabled={busy || libraryBusy}
										onClick={() => setPage(p)}
										aria-current={page === p ? "page" : undefined}
										className={cn(
											"flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
											page === p
												? "bg-accent font-medium text-accent-foreground"
												: "text-muted-foreground hover:bg-accent/50",
										)}
									>
										<Icon className="h-4 w-4 shrink-0" />
										{resourceLabels[p]}
									</button>
								);
							})}
						</nav>
						<div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
							<ResourceWorkspace
								key={page}
								agent={agent}
								page={page}
								library={library}
								choices={draft}
								onChange={(value) => {
									if (!draftInitialized) return;
									setDraft(value);
									setMessage(null);
								}}
								onRefresh={onRefresh}
								onBusyChange={setLibraryBusy}
								archived={archived}
							/>
						</div>
					</div>
					<footer className="shrink-0 border-t px-5 py-3">
						{archived?.legacy && (
							<p className="mb-2 text-xs text-muted-foreground">
								Conversa antiga: a aplicação salva uma seleção explícita de
								recursos.
							</p>
						)}
						{blocked && (
							<p className="mb-2 text-xs text-muted-foreground">{blocked}</p>
						)}
						{error && (
							<p role="alert" className="mb-2 text-sm text-destructive">
								{error}
							</p>
						)}
						{message && (
							<p role="status" className="mb-2 text-xs text-muted-foreground">
								{message}
							</p>
						)}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Button
								size="sm"
								variant="ghost"
								disabled={
									!draftInitialized ||
									busy ||
									libraryBusy ||
									library.loading ||
									!!library.error ||
									!canSaveDefaults
								}
								onClick={() => void saveDefaults()}
							>
								Usar seleção como padrão
							</Button>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									disabled={busy || libraryBusy}
									onClick={() => changeOpen(false)}
								>
									Cancelar
								</Button>
								<Button
									size="sm"
									disabled={
										!draftInitialized ||
										busy ||
										libraryBusy ||
										library.loading ||
										!!library.error ||
										!!blocked
									}
									onClick={() => void apply()}
								>
									Aplicar
								</Button>
							</div>
						</div>
					</footer>
				</DialogContent>
			</Dialog>
		</>
	);
}
