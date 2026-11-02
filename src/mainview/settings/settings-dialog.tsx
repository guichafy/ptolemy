import {
	Blocks,
	BookOpen,
	Network,
	Plug,
	Settings2,
	SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/shared/agent-protocol";
import {
	findPluginMeta,
	hasPluginConfig,
	PLUGIN_REGISTRY,
} from "../providers/registry";
import type { SettingsSection } from "../providers/rpc";
import type { ResourcePage } from "./agent-resources/model";
import { AgentResourcePreferences } from "./agent-resources/preferences";
import { GeneralSection } from "./general-section";
import { NetworkSection } from "./network-section";
import { PluginsSection } from "./plugins-section";
import { useSettings } from "./settings-context";

type Section = SettingsSection;

interface PluginSubItem {
	id: string;
	label: string;
	icon: typeof Settings2;
}

const NAV_ITEMS: { id: Section; label: string; icon: typeof Settings2 }[] = [
	{ id: "plugins", label: "Plugins do aplicativo", icon: SlidersHorizontal },
	{ id: "network", label: "Rede", icon: Network },
	{ id: "general", label: "Geral", icon: Settings2 },
];

function PluginConfigSection({ pluginId }: { pluginId: string }) {
	const ConfigComponent = PLUGIN_REGISTRY[pluginId]?.configComponent;

	if (!ConfigComponent) return null;

	return <ConfigComponent />;
}

function NavButton({
	active,
	onClick,
	icon: Icon,
	label,
	indent,
	ariaLabel,
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Settings2;
	label: string;
	indent?: boolean;
	ariaLabel?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
				indent && "ml-5 w-[calc(100%-1.25rem)]",
				active
					? "bg-accent/80 text-accent-foreground font-medium"
					: "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
			)}
		>
			<Icon className={cn("shrink-0", indent ? "h-3.5 w-3.5" : "h-4 w-4")} />
			<span className="truncate">{label}</span>
		</button>
	);
}

export function SettingsDialog() {
	const { isOpen, closeDialog, initialSection, enabledOrder } = useSettings();
	const [section, setSection] = useState<Section>("plugins");

	useEffect(() => {
		if (isOpen && initialSection) {
			setSection(initialSection);
		}
	}, [isOpen, initialSection]);

	const pluginSubItems = useMemo(
		() =>
			enabledOrder
				.filter(hasPluginConfig)
				.map((id) => {
					const meta = findPluginMeta(id);
					return meta ? { id, label: meta.label, icon: meta.icon } : null;
				})
				.filter((x): x is PluginSubItem => x !== null),
		[enabledOrder],
	);

	const resolvedSection =
		section === "extensions"
			? "agent:claude:plugins"
			: section.startsWith("plugin:") &&
					!hasPluginConfig(section.replace("plugin:", ""))
				? "plugins"
				: section;

	const agentResource = /^agent:(claude|codex):(skills|plugins|mcp)$/.exec(
		resolvedSection,
	);
	const resourceAgent = agentResource?.[1] as AgentKind | undefined;
	const resourcePage = agentResource?.[2] as ResourcePage | undefined;
	const selectedAgent = /^(?:agent|plugin):(claude|codex)(?::|$)/.exec(
		resolvedSection,
	)?.[1];
	const content =
		agentResource && resourceAgent && resourcePage ? (
			<AgentResourcePreferences
				key={resourceAgent}
				agent={resourceAgent}
				page={resourcePage}
			/>
		) : resolvedSection === "plugins" ? (
			<PluginsSection onNavigateToPlugin={(id) => setSection(`plugin:${id}`)} />
		) : resolvedSection === "general" ? (
			<GeneralSection />
		) : resolvedSection === "network" ? (
			<NetworkSection />
		) : resolvedSection.startsWith("plugin:") ? (
			<PluginConfigSection pluginId={resolvedSection.replace("plugin:", "")} />
		) : resolvedSection.startsWith("agent:") ? (
			<PluginConfigSection pluginId={selectedAgent ?? "claude"} />
		) : (
			<PluginsSection />
		);
	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) closeDialog();
			}}
		>
			<DialogContent className="flex h-[min(720px,calc(100vh-32px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]">
				<DialogTitle className="sr-only">Preferências</DialogTitle>
				<div className="flex min-h-0 flex-1">
					<aside className="flex w-[196px] shrink-0 flex-col border-r border-border/40 bg-muted/10 px-3 pb-3 pt-4">
						<span className="mb-3 px-2.5 text-xs font-medium text-muted-foreground">
							Preferências
						</span>
						<nav
							aria-label="Seções de Preferências"
							className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
						>
							{NAV_ITEMS.map((item) => (
								<div key={item.id}>
									<NavButton
										active={resolvedSection === item.id}
										onClick={() => setSection(item.id)}
										icon={item.icon}
										label={item.label}
									/>
									{item.id === "plugins" &&
										pluginSubItems.map((sub) => (
											<div key={sub.id}>
												<NavButton
													active={resolvedSection === `plugin:${sub.id}`}
													onClick={() => setSection(`plugin:${sub.id}`)}
													icon={sub.icon}
													label={sub.label}
													indent
												/>
												{selectedAgent === sub.id &&
													(
														["general", "skills", "plugins", "mcp"] as const
													).map((page) => {
														const label =
															page === "general"
																? "Geral"
																: page === "skills"
																	? "Skills"
																	: page === "plugins"
																		? "Plugins"
																		: "MCP";
														const target = `agent:${sub.id}:${page}` as Section;
														return (
															<div key={page} className="pl-4">
																<NavButton
																	active={
																		resolvedSection === target ||
																		(page === "general" &&
																			resolvedSection === `plugin:${sub.id}`)
																	}
																	onClick={() => setSection(target)}
																	icon={
																		page === "skills"
																			? BookOpen
																			: page === "plugins"
																				? Blocks
																				: page === "mcp"
																					? Plug
																					: Settings2
																	}
																	label={label}
																	ariaLabel={`${label} do ${sub.id === "claude" ? "Claude" : "Codex"}`}
																	indent
																/>
															</div>
														);
													})}
											</div>
										))}
								</div>
							))}
						</nav>
					</aside>
					{agentResource ? (
						<main className="@container flex min-h-0 min-w-0 flex-1 flex-col p-5">
							{content}
						</main>
					) : (
						<ScrollArea className="min-w-0 flex-1">
							<main className="@container min-w-0 p-5">{content}</main>
						</ScrollArea>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
