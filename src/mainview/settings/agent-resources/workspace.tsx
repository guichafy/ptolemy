import "./resources.css";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/shared/agent-protocol";
import type {
	ExtensionChoices,
	SessionResourceConfiguration,
} from "@/shared/extension-rpc";
import { ResourceMarketplace } from "./marketplace";
import { McpResources } from "./mcp";
import {
	type ResourceLibrary,
	type ResourcePage,
	resourceLabels,
	sessionCapabilities,
} from "./model";
import { PluginsResources } from "./plugins";
import { SkillsResources } from "./skills";
import { usePackageReview } from "./use-resource-library";
export interface ResourceWorkspaceProps {
	agent: AgentKind;
	page: ResourcePage;
	choices: ExtensionChoices;
	onChange: (choices: ExtensionChoices) => void;
	library: ResourceLibrary;
	onRefresh: () => void;
	onBusyChange?: (busy: boolean) => void;
	archived?: SessionResourceConfiguration;
}
export function ResourceWorkspace(props: ResourceWorkspaceProps) {
	const { agent, page, library, onRefresh, onBusyChange } = props;
	const [tab, setTab] = useState<"installed" | "marketplace">("installed");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const review = usePackageReview(
		agent,
		library.inventory?.installed ?? [],
		props.choices.extensionSelections,
	);
	const label = resourceLabels[page];
	const busyChange = (value: boolean) => {
		setBusy(value);
		onBusyChange?.(value);
	};
	const capabilities = sessionCapabilities(
		props.choices,
		review.capabilities,
		props.archived,
	);

	const childProps = {
		...props,
		onBusyChange: busyChange,
		query,
		capabilities,
	};
	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label={`${label} do ${agent === "claude" ? "Claude" : "Codex"}`}
		>
			<div
				role="tablist"
				aria-label={`Biblioteca de ${label}`}
				className="resource-tabs mb-3 flex shrink-0 gap-1 border-b pb-2"
			>
				{(["installed", "marketplace"] as const).map((t) => (
					<button
						type="button"
						role="tab"
						aria-selected={tab === t}
						key={t}
						disabled={busy}
						onClick={() => setTab(t)}
						className={cn(
							"rounded-lg px-3 py-1.5 text-sm",
							tab === t
								? "bg-accent font-medium text-accent-foreground"
								: "text-muted-foreground hover:bg-accent/50",
						)}
					>
						{t === "installed"
							? page === "mcp"
								? "Servidores configurados"
								: "Instalados"
							: `Marketplace de ${label}`}
					</button>
				))}
			</div>
			{tab === "installed" && (
				<Input
					aria-label={`Buscar ${label}`}
					placeholder={`Buscar ${label}`}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="mb-3 shrink-0"
				/>
			)}
			<div
				className="resource-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2"
				data-resource-scroll
			>
				{tab === "marketplace" ? (
					<ResourceMarketplace
						key={page}
						agent={agent}
						page={page}
						onRefresh={onRefresh}
						onBusyChange={busyChange}
					/>
				) : (
					<>
						{library.loading && (
							<p role="status" className="py-2 text-sm text-muted-foreground">
								Carregando recursos…
							</p>
						)}
						{library.error && (
							<div role="alert" className="mb-3 text-sm text-destructive">
								{library.error}
								<Button size="sm" variant="ghost" onClick={onRefresh}>
									Tentar novamente
								</Button>
							</div>
						)}
						{review.error && (
							<p role="alert" className="mb-3 text-sm text-destructive">
								{review.error}
							</p>
						)}
						{page === "skills" ? (
							<SkillsResources {...childProps} />
						) : page === "plugins" ? (
							<PluginsResources {...childProps} />
						) : (
							<McpResources {...childProps} />
						)}
					</>
				)}
			</div>
		</section>
	);
}
