import { Blocks, Network, Settings2, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
	findPluginMeta,
	hasPluginConfig,
	PLUGIN_REGISTRY,
} from "../providers/registry";
import type { SettingsSection } from "../providers/rpc";
import { ExtensionsSection } from "./extensions-section";
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
	{ id: "plugins", label: "Plugins", icon: SlidersHorizontal },
	{ id: "extensions", label: "Extensões", icon: Blocks },
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
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Settings2;
	label: string;
	indent?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
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
		section.startsWith("plugin:") &&
		!hasPluginConfig(section.replace("plugin:", ""))
			? "plugins"
			: section;

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) closeDialog();
			}}
		>
			<DialogContent className="flex h-[min(720px,calc(100vh-32px))] sm:max-w-[1040px] flex-col gap-0 overflow-hidden p-0">
				<DialogTitle className="sr-only">Preferências</DialogTitle>
				<div className="flex min-h-0 flex-1">
					<aside className="flex w-[168px] flex-col border-r border-border/40 bg-muted/10 px-3 pb-3 pt-4">
						<span className="mb-3 px-2.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
							Preferências
						</span>
						<nav className="flex flex-col gap-0.5">
							{NAV_ITEMS.map((item) => {
								const isPluginsGroup =
									item.id === "plugins" &&
									resolvedSection.startsWith("plugin:");
								const active = resolvedSection === item.id || isPluginsGroup;
								return (
									<div key={item.id}>
										<NavButton
											active={active && !isPluginsGroup}
											onClick={() => setSection(item.id)}
											icon={item.icon}
											label={item.label}
										/>
										{item.id === "plugins" &&
											pluginSubItems.map((sub) => (
												<NavButton
													key={sub.id}
													active={resolvedSection === `plugin:${sub.id}`}
													onClick={() => setSection(`plugin:${sub.id}`)}
													icon={sub.icon}
													label={sub.label}
													indent
												/>
											))}
									</div>
								);
							})}
						</nav>
						<div className="mt-auto px-2.5 pt-3 text-[10px] text-muted-foreground/50">
							Ptolemy v1.2.0
						</div>
					</aside>
					<ScrollArea className="min-w-0 flex-1">
						<main className="@container min-w-0 p-5">
							{resolvedSection === "plugins" ? (
								<PluginsSection
									onNavigateToPlugin={(id) => setSection(`plugin:${id}`)}
								/>
							) : resolvedSection === "extensions" ? (
								<ExtensionsSection />
							) : resolvedSection === "general" ? (
								<GeneralSection />
							) : resolvedSection === "network" ? (
								<NetworkSection />
							) : resolvedSection.startsWith("plugin:") ? (
								<PluginConfigSection
									pluginId={resolvedSection.replace("plugin:", "")}
								/>
							) : (
								<PluginsSection />
							)}
						</main>
					</ScrollArea>
				</div>
			</DialogContent>
		</Dialog>
	);
}
